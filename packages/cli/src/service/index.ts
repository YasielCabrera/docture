import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { FlexibleSchema } from "docture";
import type { Io } from "../cli/io.js";
import type { LoadedConfig } from "../config.js";
import type { WiringFlags } from "../wiring.js";
import { readBody } from "./body.js";
import { createOperations, type ServiceOperations } from "./operations.js";
import { HttpFailure, parseRequest, routeOf, type ServiceRoute } from "./protocol.js";

export interface HttpServiceOptions {
  readonly io: Io;
  readonly config?: LoadedConfig;
  readonly schemas?: Readonly<Record<string, FlexibleSchema>>;
  readonly flags?: WiringFlags;
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
  readonly maxConcurrency?: number;
  readonly maxQueue?: number;
  readonly maxBodyBytes?: number;
  readonly bodyTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
}

export interface HttpServiceAddress {
  readonly host: string;
  readonly port: number;
  readonly url: string;
}

export interface HttpService {
  readonly address: HttpServiceAddress | undefined;
  readonly pending: number;
  start(): Promise<HttpServiceAddress>;
  close(): Promise<void>;
}

interface Task { readonly controller: AbortController; settled: Promise<void> }
interface Waiting {
  readonly signal: AbortSignal;
  readonly admit: () => void;
  readonly reject: (error: unknown) => void;
  readonly abort: () => void;
}

function integer(value: number, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${name} must be an integer of at least ${minimum}.`);
  return value;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  if (status >= 400) response.setHeader("connection", "close");
  response.end(JSON.stringify(value));
}

function sendFailure(response: ServerResponse, route: ServiceRoute | undefined, error: unknown): void {
  const failure = error instanceof HttpFailure ? error : new HttpFailure(500, "SERVICE_FAILED", "The service could not complete the request.");
  send(response, failure.status, { version: 1, command: route ?? "serve", ok: false, results: [{ file: "document", ok: false, error: { code: failure.code, message: failure.message } }] });
}

/** Create an idle HTTP service. Configuration and schema selection are fixed when it starts. */
export function createHttpService(options: HttpServiceOptions): HttpService {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const concurrency = integer(options.maxConcurrency ?? 4, "maxConcurrency", 1);
  const maxQueue = integer(options.maxQueue ?? 16, "maxQueue", 0);
  const maxBodyBytes = integer(options.maxBodyBytes ?? 16 * 1024 * 1024, "maxBodyBytes", 1);
  const bodyTimeoutMs = integer(options.bodyTimeoutMs ?? 30_000, "bodyTimeoutMs", 1);
  const shutdownTimeoutMs = integer(options.shutdownTimeoutMs ?? 30_000, "shutdownTimeoutMs", 1);
  const token = options.token ?? options.io.env["DOCTURE_SERVE_TOKEN"];
  const expectedAuth = token === undefined ? undefined : createHash("sha256").update(`Bearer ${token}`).digest();
  const tasks = new Set<Task>();
  const queue: Waiting[] = [];
  let active = 0;
  let state: "idle" | "starting" | "running" | "closing" | "closed" = "idle";
  let server: Server | undefined;
  let operations: ServiceOperations | undefined;
  let address: HttpServiceAddress | undefined;
  let starting: Promise<HttpServiceAddress> | undefined;
  let closing: Promise<void> | undefined;
  let schemas: Readonly<Record<string, FlexibleSchema>> = {};

  const release = (): void => {
    active -= 1;
    let waiting = queue.shift();
    while (waiting !== undefined && waiting.signal.aborted) {
      waiting.signal.removeEventListener("abort", waiting.abort);
      waiting.reject(waiting.signal.reason);
      waiting = queue.shift();
    }
    if (waiting !== undefined) {
      waiting.signal.removeEventListener("abort", waiting.abort);
      active += 1;
      waiting.admit();
    }
  };

  const acquire = (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    if (active < concurrency) { active += 1; return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      const waiting: Waiting = {
        signal, admit: resolve, reject,
        abort() {
          const index = queue.indexOf(waiting);
          if (index !== -1) queue.splice(index, 1);
          reject(signal.reason);
        },
      };
      queue.push(waiting);
      signal.addEventListener("abort", waiting.abort, { once: true });
    });
  };

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    let route: ServiceRoute;
    try {
      if (state !== "running") throw new HttpFailure(503, "SERVICE_CLOSING", "The service is closing.");
      route = routeOf(request.url);
      if (request.method !== "POST") throw new HttpFailure(405, "METHOD_NOT_ALLOWED", "Use POST with a JSON document body.");
      if (expectedAuth !== undefined) {
        const supplied = createHash("sha256").update(request.headers.authorization ?? "").digest();
        if (!timingSafeEqual(expectedAuth, supplied)) throw new HttpFailure(401, "UNAUTHORIZED", "A valid bearer token is required.");
      }
      if (tasks.size >= concurrency + maxQueue) throw new HttpFailure(503, "SERVICE_BUSY", "The configured request capacity is full.");
    } catch (error) { sendFailure(response, undefined, error); return; }
    request.pause();
    const controller = new AbortController();
    const signal = controller.signal;
    const onAbort = (): void => controller.abort(new HttpFailure(499, "CANCELLED", "The caller disconnected."));
    const onClose = (): void => { if (!response.writableEnded) onAbort(); };
    request.once("aborted", onAbort);
    response.once("close", onClose);
    const timer = setTimeout(() => controller.abort(new HttpFailure(408, "BODY_TIMEOUT", "The request body deadline expired.")), bodyTimeoutMs);
    const task: Task = { controller, settled: Promise.resolve() };
    tasks.add(task);
    task.settled = (async () => {
      let admitted = false;
      try {
        await acquire(signal);
        admitted = true;
        const raw = await readBody(request, signal, maxBodyBytes);
        clearTimeout(timer);
        const input = parseRequest(route, raw, schemas);
        const current = operations;
        if (current === undefined) throw new HttpFailure(503, "SERVICE_CLOSING", "The service is closing.");
        send(response, 200, await current.run(input, signal));
      } catch (error) { sendFailure(response, route, signal.aborted ? signal.reason : error); }
      finally {
        clearTimeout(timer);
        request.off("aborted", onAbort); response.off("close", onClose);
        if (admitted) release();
        tasks.delete(task);
      }
    })();
  };

  const initialize = async (): Promise<HttpServiceAddress> => {
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError("port must be an integer from 0 through 65535.");
    if (host.length === 0) throw new Error("host must not be empty.");
    if (token !== undefined && token.length === 0) throw new Error("The bearer token must not be empty.");
    if (!["127.0.0.1", "localhost", "::1"].includes(host) && token === undefined) throw new Error("Binding outside localhost requires a configured bearer token.");
    schemas = Object.freeze({ ...(options.config?.config.schema === undefined ? {} : { default: options.config.config.schema }), ...options.schemas });
    const configured = options.config;
    const config = configured === undefined ? undefined : { path: configured.path, config: {
      ...configured.config,
      ...(configured.config.loaders === undefined ? {} : { loaders: [...configured.config.loaders] }),
      ...(configured.config.strategies === undefined ? {} : { strategies: [...configured.config.strategies] }),
      ...(configured.config.classifiers === undefined ? {} : { classifiers: [...configured.config.classifiers] }),
      ...(configured.config.classifications === undefined ? {} : { classifications: [...configured.config.classifications] }),
    } };
    operations = await createOperations({ io: options.io, flags: { ...options.flags }, schemas, ...(config === undefined ? {} : { config }) });
    server = createServer(handle);
    server.requestTimeout = bodyTimeoutMs;
    server.headersTimeout = bodyTimeoutMs;
    try {
      const current = server;
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error): void => { current.off("listening", ready); reject(error); };
        const ready = (): void => { current.off("error", failed); resolve(); };
        current.once("error", failed); current.once("listening", ready); current.listen(port, host);
      });
      const bound = server.address();
      if (bound === null || typeof bound === "string") throw new Error("The service did not bind a TCP address.");
      address = { host: bound.address, port: bound.port, url: `http://${bound.family === "IPv6" ? `[${bound.address}]` : bound.address}:${bound.port}` };
      if (state !== "closing") state = "running";
      return address;
    } catch (error) { await operations.dispose(); operations = undefined; throw error; }
  };

  return {
    get address() { return address; },
    get pending() { return tasks.size; },
    start() {
      if (state === "closing" || state === "closed") return Promise.reject(new Error("The service is closed."));
      if (starting === undefined) {
        state = "starting";
        starting = initialize().catch((error: unknown) => { if (state !== "closing") state = "closed"; throw error; });
      }
      return starting;
    },
    close() {
      if (closing !== undefined) return closing;
      state = "closing";
      closing = (async () => {
        await starting?.catch(() => {});
        const listener = server;
        const stopped = listener === undefined || !listener.listening ? Promise.resolve() : new Promise<void>((resolve, reject) => listener.close((error) => error === undefined ? resolve() : reject(error)));
        const timer = setTimeout(() => {
          for (const task of tasks) task.controller.abort(new HttpFailure(503, "SERVICE_SHUTDOWN", "The service shutdown deadline expired."));
          listener?.closeAllConnections();
        }, shutdownTimeoutMs);
        try {
          await Promise.allSettled([...tasks].map((task) => task.settled));
          listener?.closeIdleConnections();
          await stopped;
          await operations?.dispose();
        } finally { clearTimeout(timer); operations = undefined; state = "closed"; }
      })();
      return closing;
    },
  };
}
