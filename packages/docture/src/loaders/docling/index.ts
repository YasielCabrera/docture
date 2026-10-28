import type { DocumentLoader, LoadContext, LoaderCapabilities } from "../../core/contracts/loader.js";
import type { RawDocument } from "../../core/domain/document.js";
import type { LoadedDocument } from "../../core/domain/geometry.js";
import type { DoctureDocument } from "../../core/domain/conversion.js";
import { selectPages } from "../../core/pipeline/pages.js";
import { withDeadline } from "../../core/pipeline/deadline.js";
import { sha256Hex } from "../../core/conversion/sha256.js";
import { importDoclingDocument, type DoclingImportOptions, type ImportedDoclingDocument } from "../../import/docling/index.js";
import { canonicalJson, checkedLimits } from "../../import/docling/boundary.js";
import { DoclingServeError, DoclingTransport, positiveInteger, type DoclingTransportOptions } from "./transport.js";

export { DoclingServeError } from "./transport.js";
export type { DoclingServeFailure, DoclingTransportOptions } from "./transport.js";

export interface DoclingConversionOptions {
  readonly doOcr?: boolean;
  readonly forceOcr?: boolean;
  readonly doTableStructure?: boolean;
  readonly tableMode?: "fast" | "accurate";
  readonly ocrLanguages?: readonly string[];
  readonly pageRange?: readonly [number, number];
  readonly allowPartial?: boolean;
  readonly signal?: AbortSignal;
}

export interface DoclingServeOptions extends DoclingTransportOptions {
  readonly jobTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  readonly importOptions?: DoclingImportOptions;
}

export interface DoclingConversion extends ImportedDoclingDocument {
  readonly conversionStatus: "success" | "partial_success";
  readonly taskId?: string;
}

export interface DoclingJobReference {
  readonly service: string;
  readonly taskId: string;
}

export interface DoclingTaskStatus {
  readonly taskId: string;
  readonly status: "pending" | "started" | "success" | "failure";
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkedTaskId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9._-]{1,200}$/iu.test(value)) throw new DoclingServeError("response", "Docling task ID must be a nonempty bounded identifier.");
  return value;
}

function taskStatus(value: unknown, expected?: string): DoclingTaskStatus {
  if (!object(value)) throw new DoclingServeError("response", "Docling task response must be an object.");
  const taskId = checkedTaskId(value.task_id);
  if (expected !== undefined && taskId !== expected) throw new DoclingServeError("response", "Docling returned another task's status.", { taskId: expected });
  const status = value.task_status;
  if (status !== "pending" && status !== "started" && status !== "success" && status !== "failure") throw new DoclingServeError("response", "Unsupported Docling task state.", { taskId });
  return { taskId, status };
}

function checkedOptions(options: DoclingConversionOptions): void {
  for (const name of ["doOcr", "forceOcr", "doTableStructure", "allowPartial"] as const) if (options[name] !== undefined && typeof options[name] !== "boolean") throw new DoclingServeError("configuration", `${name} must be boolean.`);
  if (options.tableMode !== undefined && options.tableMode !== "fast" && options.tableMode !== "accurate") throw new DoclingServeError("configuration", "tableMode must be fast or accurate.");
  if (options.pageRange !== undefined && (options.pageRange.length !== 2 || !Number.isSafeInteger(options.pageRange[0]) || options.pageRange[0] < 1 || !Number.isSafeInteger(options.pageRange[1]) || options.pageRange[1] < options.pageRange[0])) throw new DoclingServeError("configuration", "pageRange must be an inclusive positive [start,end] range.");
  if (options.ocrLanguages !== undefined && (!Array.isArray(options.ocrLanguages) || options.ocrLanguages.length > 50 || options.ocrLanguages.some((language) => typeof language !== "string" || !/^[a-z0-9-]{1,40}$/iu.test(language)))) throw new DoclingServeError("configuration", "ocrLanguages must contain bounded language tags.");
}

const MIME_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/epub+zip"] as const;

/** A fetch-only, bounded subset of docling-serve v1. Construction performs no I/O. */
export class DoclingServeClient {
  readonly #transport: DoclingTransport;
  readonly #options: DoclingServeOptions;
  readonly #jobTimeout: number;
  readonly #pollInterval: number;
  readonly #maxPolls: number;
  constructor(options: DoclingServeOptions) {
    this.#transport = new DoclingTransport(options);
    this.#options = options;
    this.#jobTimeout = positiveInteger(options.jobTimeoutMs ?? 300_000, "jobTimeoutMs");
    this.#pollInterval = positiveInteger(options.pollIntervalMs ?? 250, "pollIntervalMs", 0);
    this.#maxPolls = positiveInteger(options.maxPolls ?? 1200, "maxPolls");
  }

  #multipart(document: RawDocument, options: DoclingConversionOptions): FormData {
    checkedOptions(options);
    if (!(document.bytes instanceof Uint8Array) || document.bytes.length === 0 || document.bytes.length > this.#transport.maxRequestBytes) throw new DoclingServeError("limit", "Docling input must contain bytes within maxRequestBytes.");
    if (!MIME_TYPES.some((type) => type === document.mimeType)) throw new DoclingServeError("configuration", "Docling's initial format matrix is PDF, DOCX, XLSX, PPTX and EPUB; supply the correct MIME type.");
    const name = document.fileName ?? "document";
    if (name.length === 0 || name.length > 1000 || /[\r\n\u0000]/u.test(name)) throw new DoclingServeError("configuration", "Docling filename must be nonempty and contain no control separators.");
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(document.bytes)], { type: document.mimeType }), name);
    form.append("to_formats", "json"); form.append("target_type", "inbody");
    const flags = [["do_ocr", options.doOcr], ["force_ocr", options.forceOcr], ["do_table_structure", options.doTableStructure]] as const;
    for (const [name, value] of flags) if (value !== undefined) form.append(name, String(value));
    if (options.tableMode !== undefined) form.append("table_mode", options.tableMode);
    for (const language of options.ocrLanguages ?? []) form.append("ocr_lang", language);
    for (const page of options.pageRange ?? []) form.append("page_range", String(page));
    return form;
  }

  #conversion(raw: unknown, options: Pick<DoclingConversionOptions, "allowPartial">, taskId?: string): DoclingConversion {
    const task = taskId === undefined ? {} : { taskId };
    if (!object(raw) || !object(raw.document) || !("json_content" in raw.document) || !["success", "partial_success", "skipped", "failure"].includes(String(raw.status))) throw new DoclingServeError("response", "Docling response must contain one in-body document, JSON content and a known conversion status.", task);
    const status = raw.status;
    if (status !== "success" && !(status === "partial_success" && options.allowPartial === true)) throw new DoclingServeError("conversion", `Docling conversion status ${String(status)} was rejected.`, task);
    const imported = importDoclingDocument(raw.document.json_content, this.#options.importOptions);
    const errorJson = raw.errors === undefined ? undefined : JSON.stringify(raw.errors);
    const errorSummary = errorJson === undefined ? "" : ` Service errors: ${errorJson.length <= 4000 ? errorJson : `${errorJson.slice(0, 4000)}... [truncated; complete diagnostics in sourceMetadata.doclingErrors]`}`;
    const partial = status === "partial_success" ? { code: "PARTIAL_CONVERSION", path: "status", message: `Caller explicitly allowed a partial conversion; content may be missing.${errorSummary}` } : undefined;
    const diagnostics = partial === undefined ? imported.diagnostics : [...imported.diagnostics, partial];
    const document: DoctureDocument = partial === undefined ? imported.document : { ...imported.document, warnings: [...imported.document.warnings, { code: "LAYOUT_DEGRADED", message: `${partial.code}: ${partial.message}` }] };
    const provenance = status === "success" ? imported.provenance : { ...imported.provenance, documentDigest: `sha256:${sha256Hex(canonicalJson(document, checkedLimits(this.#options.importOptions?.limits)))}` };
    const conversionStatus = status === "success" ? "success" : "partial_success";
    const metadata = { diagnostics, conversionStatus, ...(taskId === undefined ? {} : { doclingTask: { taskId, service: this.#transport.service } }), ...(raw.errors === undefined ? {} : { doclingErrors: raw.errors }) };
    return { ...imported, document, provenance, diagnostics, source: { ...imported.source, loaded: { ...imported.source.loaded, conversionWarnings: document.warnings, sourceMetadata: { ...imported.source.loaded.sourceMetadata, doclingProvenance: provenance, ...metadata }, meta: { ...imported.source.loaded.meta, ...metadata } } }, conversionStatus, ...task };
  }

  async convert(document: RawDocument, options: DoclingConversionOptions = {}): Promise<DoclingConversion> {
    const raw = await this.#transport.request("v1/convert/file", { body: this.#multipart(document, options), ...(options.signal === undefined ? {} : { signal: options.signal }) });
    return this.#conversion(raw, options);
  }

  async submit(document: RawDocument, options: DoclingConversionOptions = {}): Promise<DoclingJob> {
    const raw = await this.#transport.request("v1/convert/file/async", { body: this.#multipart(document, options), ...(options.signal === undefined ? {} : { signal: options.signal }) });
    let task: DoclingTaskStatus;
    try { task = taskStatus(raw); }
    catch (error) { throw new DoclingServeError("response", "Docling submission may have been accepted but returned no usable task reference; it was not resubmitted.", { outcome: "unknown", cause: error }); }
    return new DoclingJob(this, { service: this.#transport.service, taskId: task.taskId }, options.allowPartial ?? false, task);
  }

  resume(reference: DoclingJobReference, options: { readonly allowPartial?: boolean } = {}): DoclingJob {
    if (!object(reference) || reference.service !== this.#transport.service) throw new DoclingServeError("configuration", "A resumed Docling job must belong to this configured service.");
    return new DoclingJob(this, { service: reference.service, taskId: checkedTaskId(reference.taskId) }, options.allowPartial ?? false);
  }

  async taskStatus(taskId: string, signal?: AbortSignal): Promise<DoclingTaskStatus> {
    const checked = checkedTaskId(taskId);
    return taskStatus(await this.#transport.request(`v1/status/poll/${encodeURIComponent(checked)}`, { taskId: checked, ...(signal === undefined ? {} : { signal }) }), checked);
  }

  async taskResult(taskId: string, options: { readonly allowPartial: boolean; readonly signal?: AbortSignal }): Promise<DoclingConversion> {
    const checked = checkedTaskId(taskId);
    return this.#conversion(await this.#transport.request(`v1/result/${encodeURIComponent(checked)}`, { taskId: checked, ...(options.signal === undefined ? {} : { signal: options.signal }) }), options, checked);
  }

  async waitFor(reference: DoclingJobReference, allowPartial: boolean, initial?: DoclingTaskStatus, signal?: AbortSignal): Promise<DoclingConversion> {
    const caller = signal ?? new AbortController().signal;
    const deadline = withDeadline("Docling job", this.#jobTimeout, caller);
    try {
      let task = initial;
      for (let poll = 0; poll <= this.#maxPolls; poll++) {
        deadline.signal.throwIfAborted();
        if (task?.status === "failure") throw new DoclingServeError("task", `Docling task ${reference.taskId} failed.`, { taskId: reference.taskId });
        if (task?.status === "success") return await this.taskResult(reference.taskId, { allowPartial, signal: deadline.signal });
        if (poll === this.#maxPolls) break;
        if (poll > 0 && this.#pollInterval > 0) await new Promise<void>((resolve, reject) => {
          const aborted = (): void => { clearTimeout(timer); reject(deadline.signal.reason); };
          const timer = setTimeout(() => { deadline.signal.removeEventListener("abort", aborted); resolve(); }, this.#pollInterval);
          deadline.signal.addEventListener("abort", aborted, { once: true });
        });
        task = await this.taskStatus(reference.taskId, deadline.signal);
      }
      throw new DoclingServeError("timeout", "Docling polling limit reached; the server job may still be running. Resume with the task reference.", { taskId: reference.taskId, outcome: "unknown" });
    } catch (error) {
      caller.throwIfAborted();
      if (deadline.expired()) throw new DoclingServeError("timeout", "Docling job deadline elapsed; server cancellation is not implied.", { taskId: reference.taskId, outcome: "unknown", cause: error });
      throw error;
    } finally { deadline.release(); }
  }
}

/** A reusable handle; its reference can be serialized and explicitly resumed. */
export class DoclingJob {
  constructor(readonly client: DoclingServeClient, readonly reference: DoclingJobReference, readonly allowPartial: boolean, readonly initial?: DoclingTaskStatus) {}
  wait(signal?: AbortSignal): Promise<DoclingConversion> { return this.client.waitFor(this.reference, this.allowPartial, this.initial, signal); }
  status(signal?: AbortSignal): Promise<DoclingTaskStatus> { return this.client.taskStatus(this.reference.taskId, signal); }
  result(signal?: AbortSignal): Promise<DoclingConversion> { return this.client.taskResult(this.reference.taskId, { allowPartial: this.allowPartial, ...(signal === undefined ? {} : { signal }) }); }
}

export interface DocumentLoaderDoclingServeOptions extends DoclingServeOptions {
  readonly mode?: "sync" | "async";
  readonly conversion?: Omit<DoclingConversionOptions, "signal">;
}

/** Convert configured Office/EPUB/PDF sources into native text evidence without pretending blocks are lines. */
export class DocumentLoaderDoclingServe implements DocumentLoader<LoaderCapabilities<true, false, false>> {
  readonly name = "docling-serve";
  readonly capabilities: LoaderCapabilities<true, false, false> = { text: true, geometry: false, images: false, mimeTypes: MIME_TYPES, facts: ["NATIVE_EVIDENCE"] };
  readonly #client: DoclingServeClient;
  constructor(readonly options: DocumentLoaderDoclingServeOptions) { this.#client = new DoclingServeClient(options); }
  async load(document: RawDocument, context: LoadContext): Promise<LoadedDocument> {
    context.signal.throwIfAborted();
    const options = { ...this.options.conversion, signal: context.signal };
    const result = this.options.mode === "async" ? await (await this.#client.submit(document, options)).wait(context.signal) : await this.#client.convert(document, options);
    const loaded = { ...result.source.loaded, loader: this.name };
    return context.request?.pages === undefined ? loaded : selectPages(loaded, context.request.pages);
  }
  async dispose(): Promise<void> {}
}
