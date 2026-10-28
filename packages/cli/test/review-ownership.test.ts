import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAICAYAAADaxo44AAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVAiZY/z///9/BiyACZvg4JUAABofBAymvql2AAAAAElFTkSuQmCC";

function config(behaviour: "succeed" | "fail"): string {
  return `import { appendFileSync } from "node:fs";
const log = (name) => appendFileSync(new URL("./disposed.log", import.meta.url), name + "\\n");
const png = Uint8Array.from(atob(${JSON.stringify(PNG)}), (c) => c.charCodeAt(0));
const text = "Hello";
const fail = ${JSON.stringify(behaviour === "fail")};
export default {
  loaders: [{
    name: "rendering",
    capabilities: { text: true, geometry: true, images: true, mimeTypes: ["*/*"] },
    async load() {
      return { pages: [{ pageNumber: 1, width: 600, height: 800, text, image: async () => png }], text, form: "digital", loader: "rendering" };
    },
    async dispose() { log("loader"); },
  }],
  converter: {
    async *convertBatch(sources) {
      if (fail) throw new Error("converter exploded");
      for (const source of sources) {
        yield { source, outcome: { ok: true, result: { pages: [{ pageNumber: 1, width: 600, height: 800, elements: [] }] } } };
      }
    },
    async dispose() { log("converter"); },
  },
  extractor: {
    async extract() {
      if (fail) throw new Error("extractor exploded");
      return { data: { total: 1 } };
    },
    async *extractBatch() {},
    async classify() { throw new Error("unused"); },
    async dispose() { log("extractor"); },
  },
};
`;
}

function sharedLoaderConfig(converter: boolean): string {
  return `import { appendFileSync } from "node:fs";
import { DocumentConverter } from "docture";
const png = Uint8Array.from(atob(${JSON.stringify(PNG)}), (c) => c.charCodeAt(0));
const text = "Hello";
const loader = {
  name: "rendering",
  capabilities: { text: true, geometry: true, images: true, mimeTypes: ["*/*"] },
  async load() {
    return { pages: [{ pageNumber: 1, width: 600, height: 800, text, image: async () => png }], text, form: "digital", loader: "rendering" };
  },
  async dispose() { appendFileSync(new URL("./disposed.log", import.meta.url), "loader\\n"); },
};
export default {
  loaders: [loader],
  ${converter ? "converter: new DocumentConverter().loadDocumentLoader(loader)," : ""}
};
`;
}

async function disposedIn(cwd: string): Promise<string[]> {
  const log = await readFile(join(cwd, "disposed.log"), "utf8").catch(() => "");
  return log.split("\n").filter(Boolean).sort();
}

async function reviewWith(configSource: string, argv: readonly string[]) {
  const cwd = await tempDir("review-ownership");
  await writeFixture(cwd, "report.pdf", "%PDF-1.7\n");
  await writeFixture(cwd, "schema.json", JSON.stringify({ type: "object", properties: { total: { type: "number" } } }));
  await writeFixture(cwd, "docture.config.mjs", configSource);
  const run = await cli(["review", ...argv], { cwd });
  return { ...run, disposed: await disposedIn(cwd) };
}

function review(behaviour: "succeed" | "fail", argv: readonly string[]) {
  return reviewWith(config(behaviour), ["report.pdf", ...argv]);
}

describe("review with a pipeline the config built itself", () => {
  it("disposes the configured rendering loader and the supplied converter once each", async () => {
    const result = await review("succeed", []);

    expect(result.stderr).not.toContain("error");
    expect(result.code).toBe(0);
    expect(result.disposed).toEqual(["converter", "loader"]);
  });

  it("disposes the same resources once each when the supplied converter fails", async () => {
    const result = await review("fail", []);

    expect(result.stderr).toContain("converter exploded");
    expect(result.code).toBe(1);
    expect(result.disposed).toEqual(["converter", "loader"]);
  });

  it("disposes the configured rendering loader and the supplied extractor once each", async () => {
    const result = await review("succeed", ["--schema", "schema.json"]);

    expect(result.stderr).not.toContain("error");
    expect(result.code).toBe(0);
    expect(result.disposed).toEqual(["extractor", "loader"]);
  });

  it("disposes the same resources once each when the supplied extractor fails", async () => {
    const result = await review("fail", ["--schema", "schema.json"]);

    expect(result.stderr).toContain("extractor exploded");
    expect(result.code).toBe(1);
    expect(result.disposed).toEqual(["extractor", "loader"]);
  });
});

describe("review with a loader the config also gave to its own converter", () => {
  it("disposes the shared loader once", async () => {
    const result = await reviewWith(sharedLoaderConfig(true), ["report.pdf"]);

    expect(result.stderr).not.toContain("error");
    expect(result.code).toBe(0);
    expect(result.disposed).toEqual(["loader"]);
  });
});

describe("review with a frozen configured loader", () => {
  it("still disposes the loader once", async () => {
    const frozen = sharedLoaderConfig(false)
      .replace("const loader = {", "const loader = Object.freeze({")
      .replace("},\n};\nexport default", "},\n});\nexport default");
    expect(frozen).toContain("Object.freeze({");
    const result = await reviewWith(frozen, ["report.pdf"]);

    expect(result.disposed).toEqual(["loader"]);
  });
});

describe("review that fails before the reviewer is built", () => {
  it("disposes the configured loader once when the input file is missing", async () => {
    const result = await reviewWith(sharedLoaderConfig(false), ["missing.pdf"]);

    expect(result.stderr).toContain("missing.pdf");
    expect(result.code).toBe(1);
    expect(result.disposed).toEqual(["loader"]);
  });

  it("disposes the configured loader once when the schema cannot be read", async () => {
    const result = await reviewWith(sharedLoaderConfig(false), ["report.pdf", "--schema", "missing-schema.json"]);

    expect(result.stderr).toContain("missing-schema.json");
    expect(result.code).toBe(2);
    expect(result.disposed).toEqual(["loader"]);
  });
});
