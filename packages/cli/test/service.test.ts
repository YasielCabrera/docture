import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { DocumentLoaderData, type DocumentLoader, type StrategyContext } from "docture";
import { captureIo } from "../src/cli/io.js";
import { createHttpService } from "../src/service/index.js";
import { cleanup, cli, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

afterAll(cleanup);

const schema = z.object({ text: z.string() });
const body = (text = "Service text") => ({ document: { data: Buffer.from(text).toString("base64"), mimeType: "text/plain", fileName: "note.txt" } });
const deferred = <T,>() => Promise.withResolvers<T>();

function configured(options: { extract?: (ctx: StrategyContext) => Promise<{ data: unknown }>; load?: DocumentLoader["load"] } = {}) {
  const calls = { load: 0, dispose: 0, extract: 0 };
  const data = new DocumentLoaderData({ name: "shared" });
  const loader = Object.freeze({
    name: data.name, capabilities: data.capabilities,
    async load(...args: Parameters<DocumentLoader["load"]>) { calls.load += 1; return options.load === undefined ? data.load(...args) : options.load(...args); },
    async dispose() { calls.dispose += 1; },
  });
  const config = { path: "/tmp/docture-service.config.mjs", config: {
    loaders: [loader], strategies: [{ name: "text", async extract(ctx: StrategyContext) { calls.extract += 1; return options.extract?.(ctx) ?? { data: { text: ctx.document.text } }; } }],
  } };
  return { calls, loader, config };
}

async function post(url: string, route: string, input: unknown, token?: string) {
  return fetch(`${url}/${route}`, { method: "POST", headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(input) });
}

async function reply(response: Response) {
  return z.object({ ok: z.boolean(), results: z.array(z.record(z.string(), z.unknown())) }).parse(await response.json());
}

it("reuses frozen configured resources across convert, inspect and extract and closes once", async () => {
  const fixture = configured();
  const service = createHttpService({ io: captureIo(), config: fixture.config, schemas: { note: schema } });
  const address = await service.start();
  expect(address.port).toBeGreaterThan(0);
  expect(address.host).toBe("127.0.0.1");
  try {
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const converted = await post(address.url, "convert", { ...body(), format: "text" });
      expect(converted.status).toBe(200);
      expect(await converted.json()).toMatchObject({ version: 1, command: "convert", ok: true, results: [{ content: "Service text", format: "text", loader: "shared" }] });
      const inspected = await post(address.url, "inspect", body());
      expect(await inspected.json()).toMatchObject({ version: 1, command: "inspect", ok: true, results: [{ loader: "shared", pages: [{ pageNumber: 1, chars: 12 }] }] });
      const extracted = await post(address.url, "extract", { ...body(), schema: "note" });
      expect(await extracted.json()).toMatchObject({ version: 1, command: "extract", ok: true, results: [{ data: { text: "Service text" }, method: "text" }] });
    }
    expect(fixture.calls).toEqual({ load: 6, extract: 2, dispose: 0 });
  } finally {
    const first = service.close();
    expect(service.close()).toBe(first);
    await first;
  }
  expect(fixture.calls.dispose).toBe(1);
});

it("matches CLI conversion, inspection and extraction payloads on equivalent bytes", async () => {
  const cwd = await tempDir("service-parity");
  await writeFixture(cwd, "note.txt", "Service text");
  await writeFixture(cwd, "schema.json", '{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}');
  await writeFixture(cwd, "docture.config.mjs", textLoaderConfig(["Service text"], '{name:"text",async extract(ctx){return {data:{text:ctx.document.text}};}}'));
  const fixture = configured();
  const service = createHttpService({ io: captureIo(), config: fixture.config, schemas: { note: schema } });
  const address = await service.start();
  try {
    const converted = await reply(await post(address.url, "convert", { ...body(), format: "text" }));
    const convertCli = await cli(["convert", "note.txt", "--out", "out", "--to", "txt"], { cwd });
    expect(convertCli.code, convertCli.stderr).toBe(0);
    expect(converted.results[0]?.["content"]).toBe(await readFile(join(cwd, "out/note.txt"), "utf8"));
    const inspected = await reply(await post(address.url, "inspect", body()));
    const inspectCli = await cli(["inspect", "note.txt", "--format", "json"], { cwd });
    expect(inspectCli.code, inspectCli.stderr).toBe(0);
    expect(z.array(z.object({ pageNumber: z.number(), chars: z.number() })).parse(inspected.results[0]?.["pages"]).map((page) => [page.pageNumber, page.chars])).toEqual(JSON.parse(inspectCli.stdout).results[0].pages.map((page: { pageNumber: number; chars: number }) => [page.pageNumber, page.chars]));
    const extracted = await reply(await post(address.url, "extract", { ...body(), schema: "note" }));
    const extractCli = await cli(["extract", "note.txt", "--schema", "schema.json", "--full"], { cwd });
    expect(extractCli.code, extractCli.stderr).toBe(0);
    expect(extracted.results[0]?.["data"]).toEqual(JSON.parse(extractCli.stdout).results[0].data);
  } finally { await service.close(); }
});

it("requires bearer auth off loopback and validates requests before loading", async () => {
  await expect(createHttpService({ io: captureIo(), host: "0.0.0.0" }).start()).rejects.toThrow("bearer token");
  const fixture = configured();
  const service = createHttpService({ io: captureIo(), config: fixture.config, schemas: { note: schema }, token: "test-secret", maxBodyBytes: 512 });
  const address = await service.start();
  try {
    expect((await post(address.url, "convert", body())).status).toBe(401);
    expect((await post(address.url, "convert", body(), "wrong")).status).toBe(401);
    for (const input of [{ ...body(), path: "/etc/passwd" }, { document: { data: "SGVsbG8", mimeType: "text/plain" } }, { document: { data: "", mimeType: "text/plain" } }, { ...body(), pages: [0] }]) {
      expect((await post(address.url, "convert", input, "test-secret")).status).toBe(400);
    }
    expect((await post(address.url, "extract", { ...body(), schema: "toString" }, "test-secret")).status).toBe(400);
    expect((await post(address.url, "convert", body("a".repeat(1000)), "test-secret")).status).toBe(413);
    expect((await fetch(`${address.url}/convert`)).status).toBe(405);
    expect((await post(address.url, "missing", body(), "test-secret")).status).toBe(404);
    expect(fixture.calls.load).toBe(0);
  } finally { await service.close(); }
});

it("retains warm instances after a failed request and snapshots the schema allowlist", async () => {
  let fail = true;
  const fixture = configured({ async extract(ctx) { if (fail) { fail = false; throw new Error("first failed"); } return { data: { text: ctx.document.text } }; } });
  const schemas: Record<string, typeof schema> = { note: schema };
  const service = createHttpService({ io: captureIo(), config: fixture.config, schemas });
  const address = await service.start();
  schemas["later"] = schema;
  try {
    const failed = await reply(await post(address.url, "extract", { ...body(), schema: "note" }));
    expect(failed.ok).toBe(false);
    const success = await reply(await post(address.url, "extract", { ...body(), schema: "note" }));
    expect(success.results[0]?.["data"]).toEqual({ text: "Service text" });
    expect((await post(address.url, "extract", { ...body(), schema: "later" })).status).toBe(400);
    expect(fixture.calls.dispose).toBe(0);
  } finally { await service.close(); }
  expect(fixture.calls.dispose).toBe(1);
});

it("bounds active and queued requests and drains accepted work before disposal", async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  const fixture = configured({ async extract(ctx) { entered.resolve(); await release.promise; ctx.signal.throwIfAborted(); return { data: { text: ctx.document.text } }; } });
  const service = createHttpService({ io: captureIo(), config: fixture.config, schemas: { note: schema }, maxConcurrency: 1, maxQueue: 1, shutdownTimeoutMs: 2000 });
  const address = await service.start();
  const first = post(address.url, "extract", { ...body(), schema: "note" });
  await entered.promise;
  const second = post(address.url, "extract", { ...body(), schema: "note" });
  await vi.waitFor(() => expect(service.pending).toBe(2));
  expect((await post(address.url, "extract", { ...body(), schema: "note" })).status).toBe(503);
  const closing = service.close();
  expect(fixture.calls.dispose).toBe(0);
  release.resolve();
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
  await closing;
  expect(fixture.calls).toEqual({ load: 2, extract: 2, dispose: 1 });
});

it("aborts on disconnect and waits for abort settlement before shutdown disposal", async () => {
  const entered = deferred<void>();
  const aborted = deferred<void>();
  const settle = deferred<void>();
  const fixture = configured({ async extract(ctx) { entered.resolve(); await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => { aborted.resolve(); resolve(); }, { once: true })); await settle.promise; ctx.signal.throwIfAborted(); return { data: {} }; } });
  const service = createHttpService({ io: captureIo(), config: fixture.config, schemas: { note: schema }, shutdownTimeoutMs: 10 });
  const address = await service.start();
  const client = request(`${address.url}/extract`, { method: "POST", headers: { "content-type": "application/json" } });
  client.on("error", () => {});
  client.end(JSON.stringify({ ...body(), schema: "note" }));
  await entered.promise;
  client.destroy();
  await aborted.promise;
  const closing = service.close();
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(fixture.calls.dispose).toBe(0);
  settle.resolve();
  await closing;
  expect(fixture.calls.dispose).toBe(1);
});

it("cleans shared configured resources when later startup wiring fails", async () => {
  const fixture = configured();
  const service = createHttpService({ io: captureIo(), config: { ...fixture.config, config: { loaders: [fixture.loader] } }, schemas: { note: schema } });
  await expect(service.start()).rejects.toThrow("Nothing is wired");
  await service.close();
  expect(fixture.calls.dispose).toBe(1);
});

it("removes a disconnected queued request without running its loader", async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  const fixture = configured({ async extract(ctx) { entered.resolve(); await release.promise; return { data: { text: ctx.document.text } }; } });
  const service = createHttpService({ io: captureIo(), config: fixture.config, schemas: { note: schema }, maxConcurrency: 1, maxQueue: 1 });
  const address = await service.start();
  try {
    const first = post(address.url, "extract", { ...body(), schema: "note" });
    await entered.promise;
    const controller = new AbortController();
    const queued = fetch(`${address.url}/extract`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body(), schema: "note" }), signal: controller.signal }).catch(() => undefined);
    await vi.waitFor(() => expect(service.pending).toBe(2));
    controller.abort();
    await queued;
    await vi.waitFor(() => expect(service.pending).toBe(1));
    release.resolve();
    expect((await first).status).toBe(200);
    expect(fixture.calls.load).toBe(1);
  } finally { release.resolve(); await service.close(); }
});

it("forced shutdown aborts active work and waits for the engine to settle", async () => {
  const entered = deferred<void>();
  const aborted = deferred<void>();
  const settle = deferred<void>();
  const fixture = configured({ async extract(ctx) {
    entered.resolve();
    await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => { aborted.resolve(); resolve(); }, { once: true }));
    await settle.promise;
    ctx.signal.throwIfAborted();
    return { data: {} };
  } });
  const service = createHttpService({ io: captureIo(), config: fixture.config, schemas: { note: schema }, shutdownTimeoutMs: 10 });
  const address = await service.start();
  const response = post(address.url, "extract", { ...body(), schema: "note" }).catch(() => undefined);
  await entered.promise;
  const closing = service.close();
  await aborted.promise;
  expect(fixture.calls.dispose).toBe(0);
  settle.resolve();
  await Promise.all([closing, response]);
  expect(fixture.calls.dispose).toBe(1);
});

it("bounds incomplete request bodies without cancelling normal completed bodies", async () => {
  const fixture = configured();
  const service = createHttpService({ io: captureIo(), config: fixture.config, bodyTimeoutMs: 30 });
  const address = await service.start();
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const client = request(`${address.url}/convert`, { method: "POST", headers: { "content-type": "application/json" } }, (response) => {
        response.resume(); response.once("end", () => { client.destroy(); resolve(response.statusCode ?? 0); });
      });
      client.on("error", reject);
      client.write('{"document":');
    });
    expect(status).toBe(408);
    expect(fixture.calls.load).toBe(0);
    expect((await post(address.url, "convert", { ...body(), format: "text" })).status).toBe(200);
  } finally { await service.close(); }
});
