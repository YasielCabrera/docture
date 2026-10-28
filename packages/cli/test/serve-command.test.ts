import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { captureIo, run } from "../src/index.js";
import "../src/commands/serve.js";
import { cleanup, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

afterAll(cleanup);

it("serve starts on port zero, exposes named schemas and removes its shutdown handler", async () => {
  const cwd = await tempDir("serve-command");
  await writeFixture(cwd, "docture.config.mjs", textLoaderConfig(["CLI service text"], '{name:"echo",async extract(ctx){return {data:{text:ctx.document.text}};}}'));
  await writeFixture(cwd, "schema.json", '{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}');
  const io = captureIo({ cwd });
  const controller = new AbortController();
  const handlers = process.listenerCount("SIGTERM");
  const running = run(["serve", "--port", "0", "--schema", "note=./schema.json"], { io, signal: controller.signal });
  try {
    await vi.waitFor(() => expect(io.stdout, io.stderr).toContain('"command":"serve"'), { timeout: 10_000 });
    const ready = z.object({ version: z.literal(1), ok: z.literal(true), address: z.object({ url: z.string(), port: z.number().positive() }) }).parse(JSON.parse(io.stdout));
    const response = await fetch(`${ready.address.url}/extract`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: { data: Buffer.from("ignored by fixture").toString("base64"), mimeType: "text/plain" }, schema: "note" }) });
    expect(await response.json()).toMatchObject({ ok: true, results: [{ data: { text: "CLI service text" }, method: "echo" }] });
  } finally { controller.abort(); expect(await running, io.stderr).toBe(0); }
  expect(process.listenerCount("SIGTERM")).toBe(handlers);
});

it("serve rejects unrestricted network binding and duplicate named schemas", async () => {
  const cwd = await tempDir("serve-invalid");
  await writeFixture(cwd, "schema.json", '{"type":"object"}');
  const external = captureIo({ cwd });
  expect(await run(["serve", "--no-config", "--host", "0.0.0.0", "--port", "0"], { io: external })).toBe(1);
  expect(external.stderr).toContain("bearer token");
  const duplicate = captureIo({ cwd });
  expect(await run(["serve", "--no-config", "--schema", "note=./schema.json", "--schema", "note=./schema.json"], { io: duplicate })).toBe(2);
  expect(duplicate.stderr).toContain("unique name=module");
});
