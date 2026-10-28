import { withDeadline } from "../../core/pipeline/deadline.js";
import { DoctureError, messageOf } from "../../core/pipeline/errors.js";

export type DoclingServeFailure = "configuration" | "transport" | "http" | "redirect" | "response" | "task" | "expired" | "timeout" | "conversion" | "limit";

export class DoclingServeError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "DoclingServeError";
  override readonly code = "LOAD_FAILED" as const;
  readonly outcome: "failed" | "unknown";
  readonly status: number | undefined;
  readonly taskId: string | undefined;
  constructor(readonly reason: DoclingServeFailure, message: string, options: { readonly outcome?: "failed" | "unknown"; readonly status?: number; readonly taskId?: string; readonly cause?: unknown } = {}) {
    super(message, options);
    this.outcome = options.outcome ?? "failed";
    this.status = options.status;
    this.taskId = options.taskId;
  }
  override toJSON() {
    return { ...super.toJSON(), reason: this.reason, outcome: this.outcome, ...(this.status === undefined ? {} : { status: this.status }), ...(this.taskId === undefined ? {} : { taskId: this.taskId }) };
  }
}

export interface DoclingTransportOptions {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly requestTimeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly getRetries?: number;
}

export function positiveInteger(value: number, name: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new DoclingServeError("configuration", `${name} must be a finite integer >= ${minimum}.`);
  return value;
}

function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

export class DoclingTransport {
  readonly service: string;
  readonly maxRequestBytes: number;
  readonly #base: URL;
  readonly #headers: Headers;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeout: number;
  readonly #maxResponseBytes: number;
  readonly #getRetries: number;

  constructor(options: DoclingTransportOptions) {
    let base: URL;
    try { base = new URL(options.baseUrl); }
    catch (error) { throw new DoclingServeError("configuration", "Docling baseUrl must be an absolute HTTP(S) service root.", { cause: error }); }
    if (!["http:", "https:"].includes(base.protocol) || base.username !== "" || base.password !== "" || base.search !== "" || base.hash !== "") throw new DoclingServeError("configuration", "Docling baseUrl requires HTTP(S), with no embedded credentials, query or fragment.");
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    this.#base = base; this.service = base.href;
    this.#headers = new Headers(options.headers);
    if (options.apiKey !== undefined) this.#headers.set("X-Api-Key", options.apiKey);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = positiveInteger(options.requestTimeoutMs ?? 30_000, "requestTimeoutMs");
    this.maxRequestBytes = positiveInteger(options.maxRequestBytes ?? 20_000_000, "maxRequestBytes");
    this.#maxResponseBytes = positiveInteger(options.maxResponseBytes ?? 20_000_000, "maxResponseBytes");
    this.#getRetries = positiveInteger(options.getRetries ?? 2, "getRetries", 0);
    if (this.#getRetries > 10) throw new DoclingServeError("configuration", "getRetries must be at most 10.");
  }

  async request(path: string, request: { readonly body?: FormData; readonly signal?: AbortSignal; readonly taskId?: string } = {}): Promise<unknown> {
    const caller = request.signal ?? new AbortController().signal;
    caller.throwIfAborted();
    const deadline = withDeadline("Docling HTTP request", this.#timeout, caller);
    const method = request.body === undefined ? "GET" : "POST";
    const outcome = method === "POST" ? "unknown" : "failed";
    const task = request.taskId === undefined ? {} : { taskId: request.taskId };
    try {
      let url = new URL(path, this.#base);
      let retries = 0; let redirects = 0;
      while (true) {
        const headers = new Headers(this.#headers);
        if (request.body !== undefined) { headers.delete("content-type"); headers.delete("content-length"); }
        let response: Response;
        try { response = await untilAborted(this.#fetch(url, { method, headers, redirect: "manual", signal: deadline.signal, ...(request.body === undefined ? {} : { body: request.body }) }), deadline.signal); }
        catch (error) { if (method === "GET" && !deadline.signal.aborted && retries++ < this.#getRetries) continue; throw error; }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (method === "POST") throw new DoclingServeError("redirect", "Docling POST redirects are not replayed; the original submission outcome may be unknown.", { outcome: "unknown", ...task });
          let target: URL;
          try { target = new URL(location ?? "", url); } catch (error) { throw new DoclingServeError("redirect", "Invalid Docling redirect.", { cause: error, ...task }); }
          if (location === null || target.origin !== this.#base.origin || target.username !== "" || target.password !== "" || ++redirects > 3) throw new DoclingServeError("redirect", "Docling redirect leaves the configured origin or exceeds the redirect limit.", task);
          url = target; continue;
        }
        if (method === "GET" && (response.status === 429 || response.status >= 500) && retries++ < this.#getRetries) { await response.body?.cancel(); continue; }
        if (!response.ok) {
          await response.body?.cancel();
          throw new DoclingServeError(request.taskId !== undefined && (response.status === 404 || response.status === 410) ? "expired" : "http", `Docling HTTP ${response.status}${request.taskId === undefined ? "" : ` for task ${request.taskId}`}.`, { status: response.status, outcome: method === "POST" && response.status >= 500 ? "unknown" : "failed", ...task });
        }
        const chunks: Uint8Array[] = []; let length = 0;
        const reader = response.body?.getReader();
        if (reader !== undefined) {
          try {
            while (true) {
              const part = await untilAborted(reader.read(), deadline.signal);
              if (part.done) break;
              length += part.value.byteLength;
              if (length > this.#maxResponseBytes) { await reader.cancel(); throw new DoclingServeError("limit", "Docling response exceeds maxResponseBytes.", { outcome, ...task }); }
              chunks.push(part.value);
            }
          } finally { reader.releaseLock(); }
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
        catch (error) { throw new DoclingServeError("response", "Docling returned malformed JSON or UTF-8.", { cause: error, outcome, ...task }); }
      }
    } catch (error) {
      caller.throwIfAborted();
      if (error instanceof DoclingServeError) throw error;
      if (deadline.expired()) throw new DoclingServeError("timeout", "Docling HTTP request deadline elapsed; abort does not cancel server work.", { outcome, cause: error, ...task });
      throw new DoclingServeError("transport", `Docling transport failed: ${messageOf(error)}`, { outcome, cause: error, ...task });
    } finally { deadline.release(); }
  }
}
