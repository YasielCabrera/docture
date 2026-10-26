import { mkdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, cli, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

afterAll(cleanup);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const schema = '{"type":"object","properties":{"value":{"type":"string"}},"required":["value"]}';

async function project(provider: boolean, failLoad = true) {
  const cwd = await tempDir("credentials");
  const key = "credential-calls:" + cwd;
  const calls = { load: 0, model: 0 };
  Reflect.set(globalThis, key, calls);
  await writeFixture(cwd, "package.json", '{"type":"module"}');
  const config = textLoaderConfig(["Invoice with enough text to send to the model and keep the text layer eligible for extraction"], "")
    .replace("ctx.signal.throwIfAborted();", `ctx.signal.throwIfAborted(); Reflect.get(globalThis, ${JSON.stringify(key)}).load++; ${failLoad ? 'throw new Error("reader ran");' : ""}`);
  await writeFixture(cwd, "docture.config.mjs", config);
  await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
  await writeFixture(cwd, "schema.json", schema);
  if (provider) {
    await writeFixture(cwd, "node_modules/@ai-sdk/openai/package.json",
      '{"name":"@ai-sdk/openai","version":"1.0.0","type":"module","main":"index.js"}');
    await writeFixture(cwd, "node_modules/@ai-sdk/openai/index.js", `
export function openai(id) {
  return { specificationVersion: "v4", provider: "openai.chat", modelId: id, supportedUrls: {},
    async doGenerate() {
      Reflect.get(globalThis, ${JSON.stringify(key)}).model++;
      return {
        content: [{type:"text",text:'{"value":"cached"}'}],
        finishReason:{unified:"stop",raw:"stop"},
        usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}},
        warnings: []
      };
    },
    async doStream() { throw new Error("stream unused"); }
  };
}`);
  }
  return { cwd, calls, key };
}

describe("model credentials", () => {
  it("uses the real OpenAI provider with no key at an explicit compatible base URL", async () => {
    const { cwd } = await project(false, false);
    await mkdir(join(cwd, "node_modules/@ai-sdk"), { recursive: true });
    await symlink(new URL("../../../apps/docs/node_modules/@ai-sdk/openai", import.meta.url),
      join(cwd, "node_modules/@ai-sdk/openai"));
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return new Response(JSON.stringify({
        id: "local-response", created_at: 1, model: "test", status: "completed",
        output: [{ type: "message", role: "assistant", id: "message-1", status: "completed",
          content: [{ type: "output_text", text: '{"value":"local"}', annotations: [] }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }), { headers: { "content-type": "application/json" } });
    });
    const result = await cli(["extract", "a.pdf", "-s", "schema.json", "-m", "openai/test"], {
      cwd, env: { OPENAI_BASE_URL: "http://local.test/v1" },
    });
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).results[0].data).toEqual({ value: "local" });
    expect(urls).toEqual(["http://local.test/v1/responses"]);
  });

  it("checks credentials for a configured gateway model string before loading", async () => {
    const { cwd, calls } = await project(false);
    const path = join(cwd, "docture.config.mjs");
    await writeFixture(cwd, "docture.config.mjs", (await readFile(path, "utf8"))
      .replace("export default {", 'export default { model: "openai/test",'));
    const result = await cli(["extract", "a.pdf", "-s", "schema.json"], { cwd, env: {} });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("AI_GATEWAY_API_KEY");
    expect(calls).toEqual({ load: 0, model: 0 });
  });

  it("rejects missing provider credentials once before loading, including quiet mode", async () => {
    for (const quiet of [false, true]) {
      const { cwd, calls } = await project(true);
      const result = await cli(["extract", "a.pdf", "-s", "schema.json", "-m", "openai/test", ...(quiet ? ["-q"] : [])], { cwd, env: {} });
      expect(result.code).toBe(2);
      expect(result.stderr.match(/error/g)).toHaveLength(1);
      expect(result.stderr).toContain("OPENAI_API_KEY");
      expect(calls).toEqual({ load: 0, model: 0 });
    }
  });

  it("rejects a credential-free gateway before loading", async () => {
    const { cwd, calls } = await project(false);
    const result = await cli(["extract", "a.pdf", "-s", "schema.json", "-m", "openai/test", "--gateway"], { cwd, env: {} });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("AI_GATEWAY_API_KEY");
    expect(result.stderr).toContain("VERCEL_OIDC_TOKEN");
    expect(calls).toEqual({ load: 0, model: 0 });
  });

  it("permits credential-free cache reruns and compatible base URLs", async () => {
    const cached = await project(true, false);
    const first = await cli(["extract", "a.pdf", "-s", "schema.json", "-m", "openai/test", "--cache", cached.cwd + "/cache"], { cwd: cached.cwd, env: {} });
    expect(first.code, first.stderr).toBe(0);
    expect(first.stderr).toContain("OPENAI_API_KEY");
    const second = await cli(["extract", "a.pdf", "-s", "schema.json", "-m", "openai/test", "--cache", cached.cwd + "/cache"], { cwd: cached.cwd, env: {} });
    expect(second.code).toBe(0);
    expect(cached.calls).toEqual({ load: 2, model: 1 });
    const compatible = await project(true, false);
    const result = await cli(["extract", "a.pdf", "-s", "schema.json", "-m", "openai/test"], {
      cwd: compatible.cwd, env: { OPENAI_BASE_URL: "http://localhost:11434/v1" },
    });
    expect(result.code, result.stderr).toBe(0);
    expect(compatible.calls).toEqual({ load: 1, model: 1 });
  });

  it("keeps configured keyless OpenAI-compatible chat models working", async () => {
    const cwd = await tempDir("keyless-compatible");
    const provider = new URL("../../../apps/docs/node_modules/@ai-sdk/openai/dist/index.js", import.meta.url).href;
    const config = textLoaderConfig(["Invoice with visible text and more than fifty characters for text layer eligibility"], "").replace("export default {", `
import { createOpenAI } from ${JSON.stringify(provider)};
const local = createOpenAI({
  baseURL: "http://local.test/v1", apiKey: "",
  fetch: async () => new Response(JSON.stringify({
    id: "chat-local", object: "chat.completion", created: 1, model: "local",
    choices: [{ index: 0, message: { role: "assistant", content: '{"value":"local"}' }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  }), { headers: { "content-type": "application/json" } })
});
export default { model: local.chat("local"),`);
    await writeFixture(cwd, "docture.config.mjs", config);
    await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
    await writeFixture(cwd, "schema.json", schema);
    const result = await cli(["extract", "a.pdf", "-s", "schema.json"], { cwd, env: {} });
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).results[0].data).toEqual({ value: "local" });
  });
});
