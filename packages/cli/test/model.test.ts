import { afterAll, describe, expect, it } from "vitest";
import { UsageError } from "../src/cli/errors.js";
import { resolveModel } from "../src/model.js";
import { cleanup, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

/** A provider package, installed where the working directory can see it. */
async function withFakeProvider(name: string, source: string): Promise<string> {
  const dir = await tempDir("model");
  const pkg = `node_modules/@ai-sdk/${name}`;
  await writeFixture(
    dir,
    `${pkg}/package.json`,
    JSON.stringify({ name: `@ai-sdk/${name}`, version: "1.0.0", type: "module", main: "index.js" }),
  );
  await writeFixture(dir, `${pkg}/index.js`, source);
  return dir;
}

describe("resolveModel", () => {
  it("insists on provider/model-id", async () => {
    const cwd = await tempDir("model-bare");
    const error = await resolveModel("gpt-5", { cwd, env: {} }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toContain("<provider>/<model-id>");
  });

  it("builds the model with the provider package the cwd can see", async () => {
    const cwd = await withFakeProvider(
      "acme",
      `export function acme(id) { return { modelId: id, provider: "acme" }; }`,
    );

    const resolved = await resolveModel("acme/big-1", { cwd, env: { ACME_API_KEY: "k" } });

    expect(resolved.via).toBe("@ai-sdk/acme");
    expect(resolved.id).toBe("acme/big-1");
    expect(resolved.model).toEqual({ modelId: "big-1", provider: "acme" });
    expect(resolved.warning).toBeUndefined();
  });

  it("keeps everything after the FIRST slash as the model id", async () => {
    const cwd = await withFakeProvider(
      "acme",
      `export function acme(id) { return { modelId: id }; }`,
    );

    const resolved = await resolveModel("acme/openai/gpt-oss-120b", { cwd, env: {} });
    expect(resolved.model).toEqual({ modelId: "openai/gpt-oss-120b" });
  });

  it("falls back to the gateway when the provider package is not installed", async () => {
    const cwd = await tempDir("model-gateway");

    const resolved = await resolveModel("openai/gpt-5", { cwd, env: { AI_GATEWAY_API_KEY: "k" } });

    expect(resolved.via).toBe("AI Gateway");
    // The AI SDK takes a bare string as a gateway model, so the spec IS the model.
    expect(resolved.model).toBe("openai/gpt-5");
    expect(resolved.warning).toBeUndefined();
  });

  it("rejects the gateway when neither credential is set", async () => {
    const cwd = await tempDir("model-nokey");

    await expect(resolveModel("openai/gpt-5", { cwd, env: {} })).rejects.toThrow(/AI_GATEWAY_API_KEY/);
  });

  it("rejects a provider whose key is missing", async () => {
    const cwd = await withFakeProvider(
      "openai",
      `export function openai(id) { return { modelId: id }; }`,
    );

    await expect(resolveModel("openai/gpt-5", { cwd, env: {} })).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("takes the gateway when told to, even with the provider right there", async () => {
    const cwd = await withFakeProvider(
      "openai",
      `export function openai(id) { return { modelId: id }; }`,
    );

    const resolved = await resolveModel("openai/gpt-5", {
      cwd,
      env: { AI_GATEWAY_API_KEY: "k" },
      gateway: true,
    });

    expect(resolved.via).toBe("AI Gateway");
    expect(resolved.model).toBe("openai/gpt-5");
  });

  it("fails loudly when a provider package exports nothing usable", async () => {
    const cwd = await withFakeProvider("hollow", `export const version = "1.0.0";`);

    await expect(resolveModel("hollow/x", { cwd, env: {} })).rejects.toThrow(
      /exports no "hollow" provider/,
    );
  });

  it("knows the providers whose package name does not follow from the prefix", async () => {
    const dir = await tempDir("model-irregular");
    await writeFixture(
      dir,
      "node_modules/@ai-sdk/amazon-bedrock/package.json",
      JSON.stringify({ name: "@ai-sdk/amazon-bedrock", version: "1.0.0", type: "module", main: "index.js" }),
    );
    await writeFixture(
      dir,
      "node_modules/@ai-sdk/amazon-bedrock/index.js",
      `export function bedrock(id) { return { modelId: id, provider: "bedrock" }; }`,
    );

    const resolved = await resolveModel("bedrock/claude-opus-5", { cwd: dir, env: {} });
    expect(resolved.via).toBe("@ai-sdk/amazon-bedrock");
    expect(resolved.model).toEqual({ modelId: "claude-opus-5", provider: "bedrock" });
  });
});
