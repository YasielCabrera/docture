import { TimeoutError } from "../../core/pipeline/errors.js";
import type { DocumentLoader, LoadContext } from "../../core/contracts/loader.js";
import type { RawDocument } from "../../core/domain/document.js";
import type { LoadedDocument } from "../../core/domain/geometry.js";
import { AzureReadError } from "./error.js";
import { azureReadResult } from "./result.js";

export { AzureReadError } from "./error.js";

export type AzureReadAuthentication = { readonly kind: "key"; readonly key: string } | { readonly kind: "bearer"; readonly token: string };

export interface DocumentLoaderAzureReadOptions {
  readonly endpoint: string;
  readonly auth: AzureReadAuthentication;
  readonly fetch?: typeof fetch;
  /** Finite total deadline, including polling. Default 120000. */
  readonly timeoutMs?: number;
  /** Delay between running/pending responses. Default 1000. */
  readonly pollIntervalMs?: number;
  /** Actual source image DPI, required to turn pixel geometry into points. */
  readonly imageDpi?: number;
}

function finite(value: number, label: string, minimum: number): number {
  if (!Number.isFinite(value) || value < minimum) throw new AzureReadError(`${label} must be finite and at least ${minimum}.`);
  return value;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/**
 * Read PDF and image text with Azure Document Intelligence prebuilt-read REST.
 *
 * @remarks Uses API 2024-11-30 and UTF-16 spans. Inch boxes become points; pixel boxes require imageDpi. Missing geometry remains text-only with diagnostics. No rendering or SDK dependency. Requests use one finite deadline and caller cancellation.
 * @throws LOAD_FAILED for service/contract failures, TIMEOUT for the total deadline. Caller cancellation preserves its reason.
 * @example
 * ```ts
 * import { DocumentLoaderAzureRead } from "docture/loaders/azure-di";
 * const loader = new DocumentLoaderAzureRead({ endpoint: "https://resource.cognitiveservices.azure.com", auth: { kind: "key", key: "your-key" } });
 * ```
 */
export class DocumentLoaderAzureRead implements DocumentLoader {
  readonly name = "azure-read";
  readonly capabilities = { text: true, geometry: true, images: false, mimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/tiff"] } as const;
  readonly #endpoint: URL;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #pollMs: number;

  constructor(private readonly options: DocumentLoaderAzureReadOptions) {
    try { this.#endpoint = new URL(options.endpoint.endsWith("/") ? options.endpoint : `${options.endpoint}/`); }
    catch { throw new AzureReadError("Azure Read endpoint must be an absolute HTTP(S) URL."); }
    if (!["http:", "https:"].includes(this.#endpoint.protocol) || this.#endpoint.username || this.#endpoint.password || this.#endpoint.search || this.#endpoint.hash) throw new AzureReadError("Azure Read endpoint must be an HTTP(S) service root without credentials, query or fragment.");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = finite(options.timeoutMs ?? 120_000, "timeoutMs", 1);
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs > 0xffff_ffff) throw new AzureReadError("timeoutMs must be a positive integer no greater than 4294967295.");
    this.#pollMs = finite(options.pollIntervalMs ?? 1000, "pollIntervalMs", 0);
    if (options.imageDpi !== undefined) finite(options.imageDpi, "imageDpi", Number.MIN_VALUE);
  }

  async load(document: RawDocument, ctx: LoadContext): Promise<LoadedDocument> {
    ctx.signal.throwIfAborted();
    const mimeType = document.mimeType ?? "application/octet-stream";
    if (!this.capabilities.mimeTypes.some((mime) => mime === mimeType)) throw new AzureReadError("Azure Read accepts PDF, PNG, JPEG and TIFF bytes only.");
    const selected = ctx.request?.pages === undefined ? undefined : [...new Set(ctx.request.pages)].sort((a, b) => a - b);
    if (selected !== undefined && (selected.length === 0 || selected.some((page) => !Number.isSafeInteger(page) || page < 1))) throw new AzureReadError("Azure Read pages must be nonempty positive whole original page numbers.");
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = AbortSignal.any([ctx.signal, timeout]);
    const auth = this.options.auth.kind === "key" ? { "Ocp-Apim-Subscription-Key": this.options.auth.key } : { Authorization: `Bearer ${this.options.auth.token}` };
    const headers = new Headers(auth);
    const url = new URL("documentintelligence/documentModels/prebuilt-read:analyze", this.#endpoint);
    url.searchParams.set("api-version", "2024-11-30");
    url.searchParams.set("stringIndexType", "utf16CodeUnit");
    if (selected !== undefined) url.searchParams.set("pages", selected.join(","));
    try {
      const accepted = await this.#fetch(url, { method: "POST", headers: new Headers([...headers, ["Content-Type", mimeType]]), body: new Uint8Array(document.bytes), signal, redirect: "manual" });
      if (accepted.status !== 202) throw new AzureReadError(`Azure Read analyze request failed with HTTP ${accepted.status}.`);
      const location = accepted.headers.get("operation-location");
      if (location === null) throw new AzureReadError("Azure Read omitted Operation-Location.");
      const operation = new URL(location, this.#endpoint);
      if (operation.origin !== this.#endpoint.origin || operation.username || operation.password) throw new AzureReadError("Azure Read returned an untrusted operation location.");
      for (;;) {
        signal.throwIfAborted();
        const response = await this.#fetch(operation, { headers, signal, redirect: "manual" });
        if (!response.ok) throw new AzureReadError(`Azure Read polling failed with HTTP ${response.status}.`);
        const status: unknown = await response.json();
        if (typeof status !== "object" || status === null || !("status" in status)) throw new AzureReadError("Malformed Azure Read operation response.");
        switch (status.status) {
          case "succeeded": {
            if (!("analyzeResult" in status)) throw new AzureReadError("Azure Read omitted its result.");
            signal.throwIfAborted();
            return azureReadResult(status.analyzeResult, this.options.imageDpi, selected);
          }
          case "notStarted": case "running": await delay(this.#pollMs, signal); break;
          case "failed": case "canceled": throw new AzureReadError(`Azure Read operation ${status.status}.`);
          default: throw new AzureReadError("Unknown Azure Read operation status.");
        }
      }
    } catch (cause) {
      ctx.signal.throwIfAborted();
      if (timeout.aborted) throw new TimeoutError("azure-read", this.#timeoutMs);
      if (cause instanceof AzureReadError) throw cause;
      throw new AzureReadError("Azure Read transport or response decoding failed.", { cause });
    }
  }
}
