import { chmod, link, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { captureIo, run } from "../src/index.js";

const SOURCE = Buffer.from('{\n  "documentId": "original-source",\n  "total": 42\n}\n');
const directories: string[] = [];

afterAll(async () => {
  await Promise.all(directories.map((cwd) => rm(cwd, { recursive: true, force: true })));
});
afterEach(() => vi.unstubAllGlobals());

async function workspace({ failing = false, filename = "invoice.json" } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "docture-extract-"));
  directories.push(cwd);
  const source = join(cwd, filename);
  const marker = join(cwd, "calls.txt");
  await mkdir(join(cwd, "nested"));
  await writeFile(source, SOURCE);
  await writeFile(join(cwd, "schema.json"), '{"type":"object"}');
  await writeFile(join(cwd, "docture.config.mjs"), `
import { appendFileSync } from "node:fs";
const mark = (step) => appendFileSync(${JSON.stringify(marker)}, step + "\\n");
export default {
  get loaders() {
    mark("wiring");
    return [{
      name: "fixture",
      capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
      async load() {
        mark("load");
        if (${failing}) throw new Error("temporary loader failure");
        return { loader: "fixture", form: "digital", text: "Invoice", pages: [{
          pageNumber: 1, width: 600, height: 800, text: "Invoice", lines: []
        }] };
      }
    }];
  },
  strategies: [{ name: "fixed", async extract() {
    mark("strategy");
    return { data: { total: 42 } };
  } }]
};
`);
  return { cwd, source, marker };
}

async function extract(options: {
  cwd: string;
  inputs?: readonly string[];
  out: string;
  format?: string;
  flags?: readonly string[];
}) {
  const io = captureIo({ cwd: options.cwd, env: {}, color: false });
  const code = await run([
    "extract", ...(options.inputs ?? ["invoice.json"]), "--schema", "./schema.json",
    "--out", options.out, "--format", options.format ?? "json", ...(options.flags ?? []),
  ], { io });
  return { code, stdout: io.stdout, stderr: io.stderr };
}

async function expectRefusal(options: {
  result: Awaited<ReturnType<typeof extract>>;
  input: string;
  target: string;
  marker: string;
}) {
  expect(options.result.code).toBe(2);
  expect(options.result.stdout).toBe("");
  expect(options.result.stderr).toContain("error [USAGE]");
  expect(options.result.stderr).toContain(options.input);
  expect(options.result.stderr).toContain(options.target);
  expect(options.result.stderr).toContain("Choose a different --out, or omit --out.");
  await expect(readFile(options.marker)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("extract output safety", () => {
  it.each(["json", "ndjson", "text"])(
    "refuses a failing JSON source as a directory %s output before document work",
    async (format) => {
      const { cwd, source, marker } = await workspace({ failing: true });
      const result = await extract({ cwd, out: "./", format });
      expect(await readFile(source)).toEqual(SOURCE);
      await expectRefusal({ result, input: source, target: source, marker });
    },
  );

  it.each([
    { name: "relative input and output", input: () => "invoice.json", out: () => "invoice.json" },
    { name: "absolute input and output", input: (cwd: string) => join(cwd, "invoice.json"), out: (cwd: string) => join(cwd, "invoice.json") },
    { name: "relative input and absolute output", input: () => "invoice.json", out: (cwd: string) => join(cwd, "invoice.json") },
    { name: "absolute input and relative output", input: (cwd: string) => join(cwd, "invoice.json"), out: () => "invoice.json" },
    { name: "dot-prefixed input and output", input: () => "./invoice.json", out: () => "./invoice.json" },
    { name: "parent segments in input and output", input: () => "./nested/../invoice.json", out: () => "./nested/../invoice.json" },
    { name: "absolute input with parent segments", input: (cwd: string) => `${cwd}/nested/../invoice.json`, out: () => "invoice.json" },
  ])("refuses the same single-file destination with $name", async ({ input, out }) => {
    const { cwd, source, marker } = await workspace();
    const result = await extract({ cwd, inputs: [input(cwd)], out: out(cwd) });
    expect(await readFile(source)).toEqual(SOURCE);
    await expectRefusal({ result, input: isAbsolute(input(cwd)) ? input(cwd) : source, target: source, marker });
  });

  it.each(["invoice.json", "invoice with spaces.json"])(
    "refuses a decoded file URL as its single-file output for %s",
    async (filename) => {
      const { cwd, source, marker } = await workspace({ filename });
      const input = pathToFileURL(source).href;
      const result = await extract({ cwd, inputs: [input], out: filename });
      expect(await readFile(source)).toEqual(SOURCE);
      await expectRefusal({ result, input, target: source, marker });
    },
  );

  it("refuses a file URL source as a directory output", async () => {
    const { cwd, source, marker } = await workspace();
    const input = pathToFileURL(source).href;
    const result = await extract({ cwd, inputs: [input], out: "./" });
    expect(await readFile(source)).toEqual(SOURCE);
    await expectRefusal({ result, input, target: source, marker });
  });

  it.each([
    { name: "an output symlink", prepare: async (cwd: string) => {
      await symlink(join(cwd, "invoice.json"), join(cwd, "alias.json"));
      return { input: "invoice.json", out: "alias.json", target: join(cwd, "alias.json") };
    } },
    { name: "an input symlink", prepare: async (cwd: string) => {
      await symlink(join(cwd, "invoice.json"), join(cwd, "alias.json"));
      return { input: "alias.json", out: "invoice.json", target: join(cwd, "invoice.json") };
    } },
    { name: "a hardlinked output", prepare: async (cwd: string) => {
      await link(join(cwd, "invoice.json"), join(cwd, "alias.json"));
      return { input: "invoice.json", out: "alias.json", target: join(cwd, "alias.json") };
    } },
    { name: "a symlinked output directory", prepare: async (cwd: string) => {
      await symlink(cwd, join(cwd, "mirror"), "dir");
      return { input: "invoice.json", out: "mirror/", target: join(cwd, "mirror/invoice.json") };
    } },
  ])("refuses source aliases through $name", async ({ prepare }) => {
    const { cwd, source, marker } = await workspace();
    const { input, out, target } = await prepare(cwd);
    const result = await extract({ cwd, inputs: [input], out });
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(target)).toEqual(SOURCE);
    await expectRefusal({ result, input: join(cwd, input), target, marker });
  });

  it("refuses an absolute source alias with parent traversal after a symlink", async () => {
    const { cwd, source, marker } = await workspace();
    const target = join(cwd, "remote/invoice.json");
    const remoteBytes = Buffer.from('{ "documentId": "remote-source" }\n');
    await mkdir(join(cwd, "remote/deep"), { recursive: true });
    await writeFile(target, remoteBytes);
    await symlink(join(cwd, "remote/deep"), join(cwd, "jump"), "dir");
    const input = `${cwd}/jump/../invoice.json`;
    const result = await extract({ cwd, inputs: [input], out: target });
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(target)).toEqual(remoteBytes);
    await expectRefusal({ result, input, target, marker });
  });

  it("refuses a batch output hardlinked to another input before writing any result", async () => {
    const { cwd, source, marker } = await workspace();
    const other = join(cwd, "other.json");
    const target = join(cwd, "out/invoice.json");
    const untouched = join(cwd, "out/other.json");
    const otherBytes = Buffer.from('{ "documentId": "other-source" }\n');
    const outputBytes = Buffer.from('{ "previous": "output" }\n');
    await writeFile(other, otherBytes);
    await mkdir(join(cwd, "out"));
    await link(other, target);
    await writeFile(untouched, outputBytes);
    const result = await extract({ cwd, inputs: ["invoice.json", "other.json"], out: "out/" });
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(other)).toEqual(otherBytes);
    expect(await readFile(target)).toEqual(otherBytes);
    expect(await readFile(untouched)).toEqual(outputBytes);
    await expectRefusal({ result, input: other, target, marker });
  });

  it("refuses an identical missing input and output without creating it", async () => {
    const { cwd, marker } = await workspace();
    const missing = join(cwd, "missing.json");
    const result = await extract({ cwd, inputs: ["missing.json"], out: "./nested/../missing.json" });
    await expect(readFile(missing)).rejects.toMatchObject({ code: "ENOENT" });
    await expectRefusal({ result, input: missing, target: missing, marker });
  });

  it("refuses source replacement before resolving a requested model", async () => {
    const { cwd, source, marker } = await workspace();
    const result = await extract({ cwd, out: "invoice.json", flags: ["--no-config", "--model", "invalid-model"] });
    expect(await readFile(source)).toEqual(SOURCE);
    await expectRefusal({ result, input: source, target: source, marker });
  });

  it.each([
    { name: "single-file", out: "result.json", target: "result.json" },
    { name: "directory", out: "out/", target: "out/invoice.json" },
  ])("refuses an unreadable-parent input with a reachable hardlink as a $name output", async ({ out, target }) => {
    const { cwd, marker } = await workspace();
    const locked = join(cwd, "locked");
    const input = join(locked, "invoice.json");
    const destination = join(cwd, target);
    await mkdir(locked);
    await mkdir(join(cwd, "out"));
    await writeFile(input, SOURCE);
    await link(input, destination);
    await chmod(locked, 0);
    let result;
    let withModel;
    try {
      await expect(readFile(input)).rejects.toMatchObject({ code: "EACCES" });
      result = await extract({ cwd, inputs: [input], out });
      withModel = await extract({ cwd, inputs: [input], out, flags: ["--no-config", "--model", "invalid-model"] });
    } finally {
      await chmod(locked, 0o700);
    }
    expect(await readFile(input)).toEqual(SOURCE);
    expect(await readFile(destination)).toEqual(SOURCE);
    for (const invocation of [result, withModel]) {
      expect(invocation.code).toBe(2);
      expect(invocation.stdout).toBe("");
      expect(invocation.stderr).toContain("error [USAGE]");
      expect(invocation.stderr).toContain(`Cannot verify --out target "${destination}" against input "${input}"`);
      expect(invocation.stderr).toContain("Choose a new --out destination, or omit --out.");
      expect(invocation.stderr).not.toContain("would overwrite");
    }
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["single-file", "directory"])("keeps an unreadable-parent input as a per-document failure at a new %s destination", async (mode) => {
    const { cwd, source, marker } = await workspace();
    const locked = join(cwd, "locked");
    const input = join(locked, "blocked.json");
    await mkdir(locked);
    await writeFile(input, SOURCE);
    await chmod(locked, 0);
    let result;
    try {
      await expect(readFile(input)).rejects.toMatchObject({ code: "EACCES" });
      result = await extract({
        cwd, inputs: mode === "directory" ? ["invoice.json", input] : [input],
        out: mode === "directory" ? "out/" : "result.json",
      });
    } finally {
      await chmod(locked, 0o700);
    }
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("EACCES");
    const error = { file: "blocked.json", ok: false, error: { code: "UNSUPPORTED_SOURCE", message: expect.stringContaining("EACCES") } };
    if (mode === "directory") {
      await expect(readFile(join(cwd, "out/blocked.json"), "utf8").then(JSON.parse)).resolves.toMatchObject(error);
      await expect(readFile(join(cwd, "out/invoice.json"), "utf8").then(JSON.parse)).resolves.toEqual({
        file: "invoice.json", ok: true, data: { total: 42 },
      });
    } else {
      await expect(readFile(join(cwd, "result.json"), "utf8").then(JSON.parse)).resolves.toMatchObject({
        version: 1, command: "extract", ok: false, results: [error],
      });
    }
    expect(await readFile(input)).toEqual(SOURCE);
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(marker, "utf8")).toBe(mode === "directory" ? "wiring\nload\nstrategy\n" : "wiring\n");
  });

  it("requires a new destination when an unreadable-parent input cannot be compared with an existing safe output", async () => {
    const { cwd, marker } = await workspace();
    const locked = join(cwd, "locked");
    const input = join(locked, "invoice.json");
    const target = join(cwd, "result.json");
    const previous = '{"previous":"output"}\n';
    await mkdir(locked);
    await writeFile(input, SOURCE);
    await writeFile(target, previous);
    await chmod(locked, 0);
    let result;
    try {
      result = await extract({ cwd, inputs: [input], out: "result.json" });
    } finally {
      await chmod(locked, 0o700);
    }
    expect(await readFile(input)).toEqual(SOURCE);
    expect(await readFile(target, "utf8")).toBe(previous);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error [USAGE]");
    expect(result.stderr).toContain(`Cannot verify --out target "${target}" against input "${input}"`);
    expect(result.stderr).toContain("Choose a new --out destination, or omit --out.");
    expect(result.stderr).not.toContain("would overwrite");
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses an output that cannot be inspected before document work", async () => {
    const { cwd, source, marker } = await workspace();
    const locked = join(cwd, "locked");
    const target = join(locked, "result.json");
    const previous = '{"previous":"output"}\n';
    await mkdir(locked);
    await writeFile(target, previous);
    await chmod(locked, 0);
    let result;
    try {
      result = await extract({ cwd, out: target });
    } finally {
      await chmod(locked, 0o700);
    }
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(target, "utf8")).toBe(previous);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error [USAGE]");
    expect(result.stderr).toContain(`Cannot inspect --out target "${target}"`);
    expect(result.stderr).toContain("Choose a new --out destination, or omit --out.");
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    { input: "missing.json", code: "ENOENT" },
    { input: "invoice.json/child.json", code: "ENOTDIR" },
  ])("keeps a $code input failure at an existing safe output", async ({ input, code }) => {
    const { cwd, source } = await workspace();
    const target = join(cwd, "result.json");
    await writeFile(target, '{"previous":"output"}\n');
    const result = await extract({ cwd, inputs: [input], out: target });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    await expect(readFile(target, "utf8").then(JSON.parse)).resolves.toMatchObject({
      version: 1, command: "extract", ok: false,
      results: [{ file: input.split("/").at(-1), ok: false, error: { code: "UNSUPPORTED_SOURCE", message: expect.stringContaining(code) } }],
    });
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it("overwrites an existing safe destination when local inputs can be inspected", async () => {
    const { cwd, source, marker } = await workspace();
    const target = join(cwd, "result.json");
    await writeFile(target, '{"previous":"output"}\n');
    const result = await extract({ cwd, out: target });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    await expect(readFile(target, "utf8").then(JSON.parse)).resolves.toEqual({
      version: 1, command: "extract", ok: true,
      results: [{ file: "invoice.json", ok: true, data: { total: 42 } }],
    });
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(marker, "utf8")).toBe("wiring\nload\nstrategy\n");
  });

  it.each(["json", "ndjson", "text"])("keeps a safe failed directory item with %s output", async (format) => {
    const { cwd, source, marker } = await workspace({ failing: true });
    const result = await extract({ cwd, out: "out/", format });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    await expect(readFile(join(cwd, "out/invoice.json"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      file: "invoice.json", ok: false,
      error: { code: "LOAD_FAILED", message: "Every loader failed: fixture (temporary loader failure)." },
    });
    expect(result.stderr).toContain("temporary loader failure");
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(marker, "utf8")).toBe("wiring\nload\n");
  });

  it.each(["json", "ndjson"])("keeps a safe failed single-file %s result", async (format) => {
    const { cwd, source, marker } = await workspace({ failing: true });
    const result = await extract({ cwd, out: "./nested/../result.json", format });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    const item = { file: "invoice.json", ok: false,
      error: { code: "LOAD_FAILED", message: "Every loader failed: fixture (temporary loader failure)." } };
    await expect(readFile(join(cwd, "result.json"), "utf8").then(JSON.parse)).resolves.toMatchObject(format === "json"
      ? { version: 1, command: "extract", ok: false, results: [item] }
      : item);
    expect(result.stderr).toContain("temporary loader failure");
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(marker, "utf8")).toBe("wiring\nload\n");
  });

  it("keeps unreadable inputs as per-document batch failures at safe outputs", async () => {
    const { cwd, source } = await workspace();
    await symlink("unreadable.json", join(cwd, "unreadable.json"));
    await mkdir(join(cwd, "out"));
    await writeFile(join(cwd, "out/invoice.json"), '{"previous":"success"}\n');
    await writeFile(join(cwd, "out/unreadable.json"), '{"previous":"failure"}\n');
    const result = await extract({ cwd, inputs: ["invoice.json", "unreadable.json"], out: "out/" });
    expect(result.code).toBe(1);
    expect(JSON.parse(await readFile(join(cwd, "out/invoice.json"), "utf8"))).toEqual({
      file: "invoice.json", ok: true, data: { total: 42 },
    });
    expect(JSON.parse(await readFile(join(cwd, "out/unreadable.json"), "utf8"))).toMatchObject({
      file: "unreadable.json", ok: false, error: { code: "UNSUPPORTED_SOURCE", message: expect.stringContaining("ELOOP") },
    });
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it("writes a remote input to a safe local destination", async () => {
    const { cwd, source, marker } = await workspace();
    const fetch = vi.fn(async () => new Response(SOURCE, { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const result = await extract({ cwd, inputs: ["https://example.test/invoice.json"], out: "result.json" });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(JSON.parse(await readFile(join(cwd, "result.json"), "utf8"))).toEqual({
      version: 1, command: "extract", ok: true,
      results: [{ file: "invoice.json", ok: true, data: { total: 42 } }],
    });
    expect(fetch.mock.calls).toHaveLength(1);
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(marker, "utf8")).toBe("wiring\nload\nstrategy\n");
  });
});

describe("extract missing output targets", () => {
  it.each(["json", "ndjson", "text"].flatMap((format) => [
    { format, mode: "single-file" }, { format, mode: "identical spelling" }, { format, mode: "directory" },
  ]))("refuses an absent absolute parent-traversal input with $mode $format output", async ({ format, mode }) => {
    const { cwd, source, marker } = await workspace();
    const input = `${cwd}/nested/../leaf.json`;
    const target = join(cwd, "leaf.json");
    const out = mode === "directory" ? "./" : mode === "identical spelling" ? input : target;
    const result = await extract({ cwd, inputs: [input], out, format });
    await expectRefusal({ result, input, target, marker });
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["json", "ndjson", "text"])("compares physical parents on both sides of an absent %s destination", async (format) => {
    const { cwd, source, marker } = await workspace();
    await symlink(cwd, join(cwd, "mirror"), "dir");
    const input = `${await realpath(cwd)}/nested/../leaf.json`;
    const target = join(cwd, "mirror/leaf.json");
    const result = await extract({ cwd, inputs: [input], out: target, format });
    await expectRefusal({ result, input, target, marker });
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["json", "ndjson", "text"])("refuses a missing physical source after symlink parent traversal with %s output", async (format) => {
    const { cwd, source, marker } = await workspace();
    await mkdir(join(cwd, "remote/deep"), { recursive: true });
    await symlink(join(cwd, "remote/deep"), join(cwd, "jump"), "dir");
    const input = `${cwd}/jump/../leaf.json`;
    const target = join(cwd, "remote/leaf.json");
    const result = await extract({ cwd, inputs: [input], out: target, format });
    await expectRefusal({ result, input, target, marker });
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["json", "ndjson", "text"])("keeps a missing symlink-parent source distinct from its lexical %s output", async (format) => {
    const { cwd, source } = await workspace();
    await mkdir(join(cwd, "remote/deep"), { recursive: true });
    await symlink(join(cwd, "remote/deep"), join(cwd, "jump"), "dir");
    const input = `${cwd}/jump/../leaf.json`;
    const result = await extract({ cwd, inputs: [input], out: "./", format });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    await expect(readFile(join(cwd, "leaf.json"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      file: "leaf.json", ok: false, error: { code: "UNSUPPORTED_SOURCE", message: expect.stringContaining("ENOENT") },
    });
    await expect(readFile(join(cwd, "remote/leaf.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["relative", "absolute", "symlink parent traversal"].flatMap((linkTarget) =>
    ["input", "output"].flatMap((side) => ["json", "ndjson", "text"].map((format) => ({ linkTarget, side, format }))),
  ))("refuses an absent $format endpoint through a dangling $side link with $linkTarget target", async ({ linkTarget, side, format }) => {
    const { cwd, source, marker } = await workspace();
    await mkdir(join(cwd, "links"));
    await mkdir(join(cwd, "remote/deep"), { recursive: true });
    await symlink(join(cwd, "remote/deep"), join(cwd, "jump"), "dir");
    const endpoint = join(cwd, linkTarget === "symlink parent traversal" ? "remote/leaf.json" : "leaf.json");
    const linkText = linkTarget === "absolute" ? endpoint
      : linkTarget === "relative" ? "../leaf.json" : "../jump/../leaf.json";
    const alias = join(cwd, "links/alias.json");
    await symlink(linkText, alias);
    const input = side === "input" ? alias : endpoint;
    const target = side === "input" ? endpoint : alias;
    const result = await extract({ cwd, inputs: [input], out: target, format });
    await expectRefusal({ result, input, target, marker });
    expect(await readlink(alias)).toBe(linkText);
    await expect(readFile(endpoint)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["input", "output"])("keeps the physical target of a dangling %s link distinct from a lexical nonmatch", async (side) => {
    const { cwd, source } = await workspace();
    await mkdir(join(cwd, "remote/deep"), { recursive: true });
    await symlink(join(cwd, "remote/deep"), join(cwd, "jump"), "dir");
    const alias = join(cwd, "alias.json");
    const linkText = "jump/../leaf.json";
    await symlink(linkText, alias);
    const lexical = join(cwd, "leaf.json");
    const input = side === "input" ? alias : lexical;
    const out = side === "input" ? lexical : alias;
    const result = await extract({ cwd, inputs: [input], out });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    await expect(readFile(out, "utf8").then(JSON.parse)).resolves.toMatchObject({
      version: 1, command: "extract", ok: false,
      results: [{ ok: false, error: { code: "UNSUPPORTED_SOURCE", message: expect.stringContaining("ENOENT") } }],
    });
    await expect(readFile(input)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readlink(alias)).toBe(linkText);
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["json", "ndjson", "text"])("prepares a new directory before refusing an absent parent-traversal %s source", async (format) => {
    const { cwd, source, marker } = await workspace();
    const input = `${cwd}/new/../new/leaf.json`;
    const target = join(cwd, "new/leaf.json");
    const result = await extract({ cwd, inputs: [input], out: "new/", format });
    await expectRefusal({ result, input, target, marker });
    expect(await readdir(join(cwd, "new"))).toEqual([]);
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["relative", "absolute"])("refuses a dangling input with a newly prepared %s target parent", async (kind) => {
    const { cwd, source, marker } = await workspace();
    await mkdir(join(cwd, "links"));
    const input = join(cwd, "links/leaf.json");
    const target = join(cwd, "new/leaf.json");
    const linkText = kind === "relative" ? "../new/leaf.json" : target;
    await symlink(linkText, input);
    const result = await extract({ cwd, inputs: [input], out: "new/" });
    await expectRefusal({ result, input, target, marker });
    expect(await readlink(input)).toBe(linkText);
    expect(await readdir(join(cwd, "new"))).toEqual([]);
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["physical", "lexical"])("uses the %s location of a symlinked directory when preparing new output folders", async (location) => {
    const { cwd, source, marker } = await workspace();
    await mkdir(join(cwd, "remote/deep"), { recursive: true });
    await symlink(join(cwd, "remote/deep"), join(cwd, "jump"), "dir");
    const input = location === "physical" ? `${cwd}/remote/deep/new/../new/leaf.json` : `${cwd}/new/../new/leaf.json`;
    const target = join(cwd, "jump/new/leaf.json");
    const result = await extract({ cwd, inputs: [input], out: "jump/new/" });
    if (location === "physical") {
      await expectRefusal({ result, input, target, marker });
      expect(await readdir(join(cwd, "remote/deep/new"))).toEqual([]);
    } else {
      expect(result.code).toBe(1);
      await expect(readFile(target, "utf8").then(JSON.parse)).resolves.toMatchObject({
        file: "leaf.json", ok: false, error: { message: expect.stringContaining("ENOENT") },
      });
      await expect(stat(join(cwd, "new"))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it("preserves native lookup behavior through more than thirty-two terminal links", async () => {
    const { cwd, source, marker } = await workspace();
    for (let index = 0; index < 34; index += 1) {
      await symlink(index === 33 ? "leaf.json" : `link-${index + 1}.json`, join(cwd, `link-${index}.json`));
    }
    const input = join(cwd, "link-0.json");
    const target = join(cwd, "leaf.json");
    const nativeFailure = await stat(input).then(() => undefined, (error: unknown) => error);
    if (nativeFailure instanceof Error && "code" in nativeFailure && nativeFailure.code === "ELOOP") {
      await writeFile(target, '{"previous":"output"}\n');
      const result = await extract({ cwd, inputs: [input], out: target });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      await expect(readFile(target, "utf8").then(JSON.parse)).resolves.toMatchObject({
        version: 1, command: "extract", ok: false,
        results: [{ file: "link-0.json", ok: false, error: { code: "UNSUPPORTED_SOURCE", message: expect.stringContaining("ELOOP") } }],
      });
      expect(await readlink(input)).toBe("link-1.json");
      expect(await readFile(marker, "utf8")).toBe("wiring\n");
    } else {
      expect(nativeFailure).toMatchObject({ code: "ENOENT" });
      const result = await extract({ cwd, inputs: [input], out: target });
      await expectRefusal({ result, input, target, marker });
      await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["json", "ndjson", "text"])("keeps a truly unresolved input as a partial batch failure with %s output", async (format) => {
    const { cwd, source, marker } = await workspace();
    const input = `${cwd}/missing/../leaf.json`;
    const result = await extract({ cwd, inputs: ["invoice.json", input], out: "out/", format });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    await expect(readFile(join(cwd, "out/leaf.json"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      file: "leaf.json", ok: false, error: { code: "UNSUPPORTED_SOURCE", message: expect.stringContaining("ENOENT") },
    });
    await expect(readFile(join(cwd, "out/invoice.json"), "utf8").then(JSON.parse)).resolves.toEqual({
      file: "invoice.json", ok: true, data: { total: 42 },
    });
    await expect(stat(join(cwd, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(cwd, "leaf.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(marker, "utf8")).toBe("wiring\nload\nstrategy\n");
  });

  it.each(["json", "ndjson"])("writes a separate single-file %s failure without inventing an unresolved input parent", async (format) => {
    const { cwd, source } = await workspace();
    const input = `${cwd}/missing/../leaf.json`;
    const result = await extract({ cwd, inputs: [input], out: "leaf.json", format });
    expect(result.code).toBe(1);
    const item = { file: "leaf.json", ok: false, error: { code: "UNSUPPORTED_SOURCE", message: expect.stringContaining("ENOENT") } };
    await expect(readFile(join(cwd, "leaf.json"), "utf8").then(JSON.parse)).resolves.toMatchObject(format === "json"
      ? { version: 1, command: "extract", ok: false, results: [item] } : item);
    await expect(stat(join(cwd, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(input)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it("preserves single-file output failure when its parent is absent", async () => {
    const { cwd, source, marker } = await workspace();
    const input = `${cwd}/new/../new/leaf.json`;
    const target = join(cwd, "new/leaf.json");
    const result = await extract({ cwd, inputs: [input], out: target });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ENOENT");
    expect(result.stderr).not.toContain("would overwrite");
    await expect(stat(join(cwd, "new"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(source)).toEqual(SOURCE);
    expect(await readFile(marker, "utf8")).toBe("wiring\n");
  });

  it.each(["trailing slash", "terminal dot", "terminal parent"])("keeps an unresolved %s as a failure instead of inventing an ordinary leaf", async (ending) => {
    const { cwd, source } = await workspace();
    const input = `${cwd}/missing${ending === "trailing slash" ? "/" : ending === "terminal dot" ? "/." : "/.."}`;
    const target = join(cwd, "missing");
    const result = await extract({ cwd, inputs: [input], out: target });
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("would overwrite");
    await expect(readFile(target, "utf8").then(JSON.parse)).resolves.toMatchObject({
      version: 1, command: "extract", ok: false, results: [{ ok: false }],
    });
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["trailing slash", "terminal dot", "terminal parent"])("keeps a dangling leaf target with %s unresolved", async (ending) => {
    const { cwd, source } = await workspace();
    const input = join(cwd, "alias.json");
    const linkText = `missing${ending === "trailing slash" ? "/" : ending === "terminal dot" ? "/." : "/.."}`;
    await symlink(linkText, input);
    const target = join(cwd, "missing");
    const result = await extract({ cwd, inputs: [input], out: target });
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("would overwrite");
    await expect(readFile(target, "utf8").then(JSON.parse)).resolves.toMatchObject({
      version: 1, command: "extract", ok: false, results: [{ ok: false }],
    });
    expect(await readlink(input)).toBe(linkText);
    expect(await readFile(source)).toEqual(SOURCE);
  });

  it.each(["config import", "invalid config", "invalid model", "schema import", "invalid schema"])(
    "refuses a newly resolvable batch alias before %s and leaves no sibling output files",
    async (problem) => {
      const { cwd, source, marker } = await workspace();
      const configPath = join(cwd, "docture.config.mjs");
      const moduleMarker = join(cwd, "module.txt");
      const schemaMarker = join(cwd, "schema.txt");
      const input = `${cwd}/new/../new/leaf.json`;
      const target = join(cwd, "new/leaf.json");
      const originalConfig = await readFile(configPath, "utf8");
      await writeFile(configPath, `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(moduleMarker)}, "imported");
${problem === "invalid config" ? "export default null;" : originalConfig}`);
      await writeFile(join(cwd, "marked-schema.mjs"), `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(schemaMarker)}, "imported");
export default { type: "object" };`);
      const flags = problem === "invalid model" ? ["--no-config", "--model", "invalid-model"]
        : problem === "schema import" ? ["--schema", "./marked-schema.mjs"]
          : problem === "invalid schema" ? ["--schema", "./does-not-exist.mjs"] : [];
      const result = await extract({ cwd, inputs: ["invoice.json", input], out: "new/", flags });
      await expectRefusal({ result, input, target, marker });
      expect(await readdir(join(cwd, "new"))).toEqual([]);
      await expect(readFile(moduleMarker)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(schemaMarker)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(source)).toEqual(SOURCE);
    },
  );

  it("refuses an existing source alias before importing invalid config", async () => {
    const { cwd, source, marker } = await workspace();
    const configPath = join(cwd, "docture.config.mjs");
    const moduleMarker = join(cwd, "module.txt");
    await writeFile(configPath, `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(moduleMarker)}, "imported");
export default null;`);
    const result = await extract({ cwd, out: "./" });
    await expectRefusal({ result, input: source, target: source, marker });
    await expect(readFile(moduleMarker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(source)).toEqual(SOURCE);
  });
});

describe("extract native directory aliases", () => {
  it("refuses an absent endpoint through macOS firmlinks with different realpath spellings", async ({ skip }) => {
    if (process.platform !== "darwin") skip("This regression requires macOS firmlinks.");
    const { cwd, source, marker } = await workspace();
    const physical = await realpath(cwd);
    const alternate = `/System/Volumes/Data${physical}`;
    const parent = await stat(physical, { bigint: true });
    try {
      const aliasParent = await stat(alternate, { bigint: true });
      expect(aliasParent.dev).toBe(parent.dev);
      expect(aliasParent.ino).toBe(parent.ino);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        skip("This macOS installation does not expose the Data volume firmlink spelling.");
      }
      throw error;
    }
    expect(await realpath(alternate)).not.toBe(physical);
    for (const side of ["input", "output"]) {
      const input = `${side === "input" ? alternate : physical}/nested/../leaf.json`;
      const target = `${side === "input" ? physical : alternate}/leaf.json`;
      const result = await extract({ cwd, inputs: [input], out: target });
      await expectRefusal({ result, input, target, marker });
      await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(source)).toEqual(SOURCE);
    }
  });
});
