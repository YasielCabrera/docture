import type { IncomingMessage } from "node:http";
import { HttpFailure } from "./protocol.js";

export async function readBody(request: IncomingMessage, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim();
  if (contentType !== "application/json") throw new HttpFailure(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const length = request.headers["content-length"];
  if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > maxBytes)) throw new HttpFailure(413, "BODY_TOO_LARGE", "The request body exceeds the configured limit.");
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const cleanup = (): void => {
      request.off("data", onData); request.off("end", onEnd); request.off("error", onError); signal.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown): void => { cleanup(); request.pause(); reject(error); };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > maxBytes) { fail(new HttpFailure(413, "BODY_TOO_LARGE", "The request body exceeds the configured limit.")); return; }
      chunks.push(chunk);
    };
    const onEnd = (): void => { cleanup(); resolve(Buffer.concat(chunks)); };
    const onError = (error: Error): void => fail(error);
    const onAbort = (): void => fail(signal.reason);
    if (signal.aborted) { reject(signal.reason); return; }
    request.on("data", onData); request.once("end", onEnd); request.once("error", onError); signal.addEventListener("abort", onAbort, { once: true });
    request.resume();
  });
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new HttpFailure(400, "INVALID_REQUEST", "The body must contain valid JSON."); }
}
