import { DoctureError } from "../core/pipeline/errors.js";

export type PaperlessApiVersion = 9 | 10;
export type PaperlessFailure = "configuration" | "http" | "protocol" | "transport" | "limit" | "unsupported-version" | "source-changed";

export class PaperlessError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "PaperlessError";
  override readonly code = "UNSUPPORTED_SOURCE" as const;
  constructor(message: string, readonly kind: PaperlessFailure = "protocol", readonly status?: number, readonly outcome: "rejected" | "unknown" = "rejected", options?: { readonly cause?: unknown }) {
    super(message, options);
  }
}

export interface PaperlessConnectionOptions {
  readonly baseUrl: string | URL;
  readonly apiVersion: PaperlessApiVersion;
  readonly token?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface PaperlessResponse {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly serverVersion: string;
}

export function positiveInteger(value: number, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new PaperlessError(`${label} must be a positive integer no greater than ${maximum}.`, "configuration");
  return value;
}

export class PaperlessTransport {
  readonly instance: string;
  readonly apiVersion: PaperlessApiVersion;
  readonly #root: URL;
  readonly #fetch: typeof fetch;
  readonly #headers: Headers;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: PaperlessConnectionOptions) {
    let root: URL;
    try { root = new URL(options.baseUrl); } catch { throw new PaperlessError("Paperless baseUrl must be an absolute HTTP(S) service root.", "configuration"); }
    if (!["http:", "https:"].includes(root.protocol) || root.username || root.password || root.search || root.hash) throw new PaperlessError("Paperless baseUrl must be HTTP(S), without credentials, query or fragment.", "configuration");
    if (options.apiVersion !== 9 && options.apiVersion !== 10) throw new PaperlessError("Paperless supports REST API versions 9 and 10 only.", "configuration");
    root.pathname = `${root.pathname.replace(/\/+$/, "")}/`;
    this.#root = root;
    this.instance = root.href;
    this.apiVersion = options.apiVersion;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#headers = new Headers(options.headers);
    if (options.token !== undefined) this.#headers.set("Authorization", `Token ${options.token}`);
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? 30_000, "timeoutMs");
    this.#maxResponseBytes = positiveInteger(options.maxResponseBytes ?? 32 * 1024 * 1024, "maxResponseBytes");
  }

  url(path: string): URL {
    const url = new URL(path, this.#root);
    if (url.origin !== this.#root.origin || !url.pathname.startsWith(`${this.#root.pathname}api/`) || url.username || url.password || url.hash) throw new PaperlessError("Paperless returned an untrusted URL outside the configured instance.");
    return url;
  }

  async json(path: string, signal?: AbortSignal, mutation?: { readonly body: unknown }): Promise<{ readonly value: unknown; readonly serverVersion: string }> {
    const response = await this.request(path, signal, mutation);
    if (response.mimeType !== "application/json" && !response.mimeType.endsWith("+json")) throw new PaperlessError("Paperless returned a non-JSON response.", "protocol", undefined, mutation === undefined ? "rejected" : "unknown");
    try { const value: unknown = JSON.parse(new TextDecoder().decode(response.bytes)); return { value, serverVersion: response.serverVersion }; }
    catch (error) { throw new PaperlessError("Paperless returned malformed JSON.", "protocol", undefined, mutation === undefined ? "rejected" : "unknown", { cause: error }); }
  }

  async request(path: string, signal?: AbortSignal, mutation?: { readonly body: unknown }): Promise<PaperlessResponse> {
    signal?.throwIfAborted();
    const url = this.url(path);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error("Paperless request deadline exceeded.")), this.#timeoutMs);
    const combined = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal]);
    let response: Response | undefined;
    try {
      const headers = new Headers(this.#headers);
      headers.set("Accept", `application/json; version=${this.apiVersion}`);
      if (mutation !== undefined) headers.set("Content-Type", "application/json");
      response = await this.#fetch(url, { method: mutation === undefined ? "GET" : "POST", headers, redirect: "manual", cache: "no-store", signal: combined, ...(mutation === undefined ? {} : { body: JSON.stringify(mutation.body) }) });
      if (response.status >= 300 && response.status < 400) throw new PaperlessError("Paperless redirects are rejected before credentials can be forwarded.", "protocol", response.status);
      if (!response.ok) throw new PaperlessError(`Paperless request failed with HTTP ${response.status}.`, "http", response.status, mutation !== undefined && ![401, 403, 404, 406, 429].includes(response.status) ? "unknown" : "rejected");
      const serverVersion = response.headers.get("X-Version");
      const api = response.headers.get("X-Api-Version");
      if (serverVersion === null || !/^3\.\d+\.\d+(?:[-+].*)?$/.test(serverVersion) || (api !== "9" && api !== "10")) throw new PaperlessError("Paperless requires a confirmed 3.x server with REST API 9 or 10 response headers.", "unsupported-version");
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body !== null) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            combined.throwIfAborted();
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > this.#maxResponseBytes) throw new PaperlessError("Paperless response byte limit exceeded.", "limit");
            chunks.push(part.value);
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
      const bytes = new Uint8Array(size);
      let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { bytes, mimeType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "", serverVersion };
    } catch (error) {
      signal?.throwIfAborted();
      if (timeout.signal.aborted) throw new PaperlessError("Paperless request deadline exceeded.", "transport", undefined, mutation === undefined ? "rejected" : "unknown", { cause: error });
      if (error instanceof PaperlessError) {
        if (mutation !== undefined && error.status === undefined && error.outcome === "rejected") throw new PaperlessError(error.message, error.kind, undefined, "unknown", { cause: error });
        throw error;
      }
      throw new PaperlessError("Paperless request failed before a complete response was available.", "transport", undefined, mutation === undefined ? "rejected" : "unknown", { cause: error });
    } finally { clearTimeout(timer); await response?.body?.cancel().catch(() => {}); }
  }
}

export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
