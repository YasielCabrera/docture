import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PaperlessReadOptions, PaperlessSource, PaperlessSourceResult } from "docture/sources/paperless";

export interface PaperlessJob { readonly key: string; readonly instance: string; readonly documentId: number }
export interface PaperlessQueue { enqueue(job: PaperlessJob): Promise<"queued" | "duplicate"> }

export function instanceRoot(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Paperless instance must be an HTTP(S) service root.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`; return url.href;
}
function documentId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("documentId must be a positive integer."); return value;
}
function authenticated(header: string | undefined, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`); const received = Buffer.from(header ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createPaperlessIngress(options: { readonly instance: string; readonly token: string; readonly queue: PaperlessQueue }) {
  const instance = instanceRoot(options.instance);
  if (options.token.trim() === "") throw new Error("Configure an ingress bearer token.");
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const send = (status: number, value: unknown): void => { response.statusCode = status; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); };
    if (request.method !== "POST") { response.setHeader("Allow", "POST"); send(405, { error: "POST required" }); return; }
    if (!authenticated(request.headers.authorization, options.token)) { send(401, { error: "Unauthorized" }); return; }
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 8192) { send(413, { error: "Webhook body exceeds 8192 bytes" }); return; } chunks.push(Buffer.from(chunk)); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).some((key) => !["event", "instance", "documentId"].includes(key))) throw new Error("Invalid webhook body.");
      if (!("instance" in value) || typeof value.instance !== "string" || instanceRoot(value.instance) !== instance) throw new Error("Webhook instance does not match configuration.");
      if (!("documentId" in value)) throw new Error("documentId is required."); const id = documentId(value.documentId);
      if (!("event" in value) || value.event !== "document_added" && value.event !== "document_updated") throw new Error("Unsupported event.");
      if (value.event === "document_updated") { send(202, { ignored: true, reason: "Only Document Added events enqueue extraction." }); return; }
      const result = await options.queue.enqueue({ key: `${instance}document:${id}:added`, instance, documentId: id });
      send(202, { result });
    } catch { send(400, { error: "Invalid webhook payload or queue submission failed" }); }
  };
}

export function createExampleQueue(maxKeys = 1_000): PaperlessQueue & { take(): PaperlessJob | undefined } {
  const seen = new Set<string>(); const pending: PaperlessJob[] = [];
  return {
    async enqueue(job) {
      if (seen.has(job.key)) return "duplicate";
      if (seen.size >= maxKeys) throw new Error("Example queue retention limit reached.");
      seen.add(job.key); pending.push(job); return "queued";
    },
    take() { return pending.shift(); },
  };
}

export async function runPaperlessJob<T>(job: PaperlessJob, options: { readonly instance: string; readonly source: Pick<PaperlessSource, "read">; readonly read: Omit<PaperlessReadOptions, "versionId">; readonly process: (source: PaperlessSourceResult) => Promise<T> }): Promise<T> {
  if (instanceRoot(job.instance) !== instanceRoot(options.instance)) throw new Error("Queued instance does not match worker configuration.");
  documentId(job.documentId);
  const current = await options.source.read(job.documentId, options.read);
  return options.process(current);
}

export async function enqueuePostConsume(env: Readonly<Record<string, string | undefined>>, fetcher: typeof fetch = fetch): Promise<void> {
  const id = env.DOCUMENT_ID;
  if (id === undefined || !/^[1-9]\d*$/u.test(id) || !Number.isSafeInteger(Number(id))) throw new Error("DOCUMENT_ID must be a positive integer.");
  const instance = instanceRoot(env.PAPERLESS_INSTANCE ?? "");
  const ingress = new URL(env.PAPERLESS_INGRESS_URL ?? "");
  if (!["http:", "https:"].includes(ingress.protocol) || ingress.username || ingress.password || ingress.hash) throw new Error("Configure an HTTP(S) ingress URL without credentials.");
  const token = env.PAPERLESS_INGRESS_TOKEN;
  if (token === undefined || token.trim() === "") throw new Error("Configure PAPERLESS_INGRESS_TOKEN.");
  const response = await fetcher(ingress, { method: "POST", redirect: "manual", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ event: "document_added", instance, documentId: Number(id) }), signal: AbortSignal.timeout(5_000) });
  await response.body?.cancel();
  if (response.status !== 202) throw new Error(`Queue ingress rejected post-consume submission with HTTP ${response.status}.`);
}
