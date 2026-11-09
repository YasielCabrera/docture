import { withDeadline } from "../../core/pipeline/deadline.js";
import { DoctureError, messageOf } from "../../core/pipeline/errors.js";

export type DoclingServeFailure = "configuration" | "transport" | "http" | "redirect" | "response" | "task" | "expired" | "timeout" | "conversion" | "limit";

export class DoclingServeError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "DoclingServeError";
  override readonly code = "DOCLING_FAILED" as const;
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
  /** Bounds each HTTP request except the synchronous `convert()` POST. Default 30000. */
  readonly requestTimeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  /** Retries for a GET that failed in transport or with 429 or 5xx. Default 2, at most 10. */
  readonly getRetries?: number;
  /**
   * First backoff before a retried GET, doubled per retry with full jitter, unless
   * the response sends `Retry-After`. Default 250.
   */
  readonly getRetryDelayMs?: number;
}

const MAX_RETRY_WAIT_MS = 60_000;
const ERROR_BODY_BYTES = 4096;
const ERROR_DETAIL_CHARS = 500;

/** `Retry-After` as seconds or an HTTP date, in milliseconds from now. */
function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (value === undefined || value === "") return undefined;
  const wait = /^\d+$/u.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(wait) ? Math.min(MAX_RETRY_WAIT_MS, Math.max(0, wait)) : undefined;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const aborted = (): void => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/** A bounded excerpt of an error response: FastAPI's `detail` when present, else the text. */
async function errorDetail(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < ERROR_BODY_BYTES) {
      const part = await untilAborted(reader.read(), signal);
      if (part.done) break;
      chunks.push(part.value);
      length += part.value.byteLength;
    }
    await reader.cancel().catch(() => {});
  } catch {
    return "";
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const detail = jsonDetail(new TextDecoder().decode(bytes.subarray(0, ERROR_BODY_BYTES)));
  const flat = (typeof detail === "string" ? detail : JSON.stringify(detail)).replace(/\s+/gu, " ").trim();
  return flat.length <= ERROR_DETAIL_CHARS ? flat : `${flat.slice(0, ERROR_DETAIL_CHARS)}...`;
}

function jsonDetail(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && "detail" in parsed ? parsed.detail : text;
  } catch {
    return text;
  }
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
  readonly #getRetryDelay: number;

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
    this.#getRetryDelay = positiveInteger(options.getRetryDelayMs ?? 250, "getRetryDelayMs", 0);
  }

  async request(path: string, request: { readonly body?: FormData; readonly signal?: AbortSignal; readonly taskId?: string; readonly timeoutMs?: number } = {}): Promise<unknown> {
    const caller = request.signal ?? new AbortController().signal;
    caller.throwIfAborted();
    const timeoutMs = request.timeoutMs ?? this.#timeout;
    const deadline = withDeadline("Docling HTTP request", timeoutMs, caller);
    const endsAt = timeoutMs > 0 ? performance.now() + timeoutMs : Infinity;
    const retryWait = (retry: number, response?: Response): number =>
      (response === undefined ? undefined : retryAfterMs(response)) ??
        Math.random() * Math.min(MAX_RETRY_WAIT_MS, this.#getRetryDelay * 2 ** retry);
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
        catch (error) { if (method === "GET" && !deadline.signal.aborted && retries < this.#getRetries) { await pause(retryWait(retries++), deadline.signal); continue; } throw error; }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (method === "POST") throw new DoclingServeError("redirect", "Docling POST redirects are not replayed; the original submission outcome may be unknown.", { outcome: "unknown", ...task });
          let target: URL;
          try { target = new URL(location ?? "", url); } catch (error) { throw new DoclingServeError("redirect", "Invalid Docling redirect.", { cause: error, ...task }); }
          if (location === null || target.origin !== this.#base.origin || target.username !== "" || target.password !== "" || ++redirects > 3) throw new DoclingServeError("redirect", "Docling redirect leaves the configured origin or exceeds the redirect limit.", task);
          url = target; continue;
        }
        if (method === "GET" && (response.status === 429 || response.status >= 500) && retries < this.#getRetries) {
          const wait = retryWait(retries, response);
          if (performance.now() + wait < endsAt) { await response.body?.cancel(); await pause(wait, deadline.signal); retries++; continue; }
        }
        if (!response.ok) {
          const detail = await errorDetail(response, deadline.signal);
          throw new DoclingServeError(request.taskId !== undefined && (response.status === 404 || response.status === 410) ? "expired" : "http", `Docling HTTP ${response.status}${request.taskId === undefined ? "" : ` for task ${request.taskId}`}${detail === "" ? "." : `: ${detail}`}`, { status: response.status, outcome: method === "POST" && response.status >= 500 ? "unknown" : "failed", ...task });
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
