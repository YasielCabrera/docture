import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

function contentRecord(sourceText: string) {
  return { file: "paperless:42", ok: true, data: { subject: "Stored content" }, citations: [{ path: "subject", status: "uncited", ids: [] }], citationSources: [], sourceText, source: { kind: "paperless", schemaVersion: 1, variant: "content", digest: createHash("sha256").update(sourceText, "utf8").digest("hex"), instance: "https://archive.example.test/", documentId: 42, fileVersionId: 47, apiVersion: 10, serverVersion: "3.3.4", metadata: { title: "Stored content" } } };
}

it("reviews exact digest-validated stored text without canvas, physical pages or fabricated citation IDs", async () => {
  const cwd = await tempDir("paperless-text-review");
  const sourceText = "Stored content with Unicode 😀 and a form feed\fbelongs to logical text.\r\n<script>untrusted()</script>";
  await writeFixture(cwd, "saved.json", JSON.stringify({ version: 1, command: "paperless", action: "extract", ok: true, results: [contentRecord(sourceText)] }));
  await writeFixture(cwd, "placeholder.txt", "This is only a compatibility CLI argument, not extraction evidence.");
  vi.doMock("@napi-rs/canvas", () => { throw new Error("CANVAS MUST NOT LOAD"); });
  try {
    const reviewed = await cli(["review", "--extraction", "saved.json", "--source", "placeholder.txt", "--no-config", "--out", "review.html"], { cwd });
    expect(reviewed.code, reviewed.stderr).toBe(0);
    const html = await readFile(join(cwd, "review.html"), "utf8");
    expect(html).toContain("Stored source text");
    expect(html).toContain("Geometry and physical highlights are unavailable");
    expect(html).toContain("Digest verified against the saved source descriptor");
    expect(html).toContain(contentRecord(sourceText).source.digest);
    expect(html).toContain("&lt;script&gt;untrusted()&lt;/script&gt;");
    expect(html).toContain('&quot;fileVersionId&quot;: 47');
    expect(html).not.toContain('data-page="');
    expect(html).not.toContain('<div class="line"');
    expect(html).not.toContain('data-granularity="');
    expect(html).not.toContain("compatibility CLI argument");
  } finally { vi.doUnmock("@napi-rs/canvas"); }
});

it("reviews an actual saved Paperless extraction artifact with source identity intact", async () => {
  const cwd = await tempDir("paperless-artifact-review");
  const artifact = await readFile(new URL("./fixtures/paperless-content-extraction.json", import.meta.url), "utf8");
  await writeFixture(cwd, "saved.json", artifact);
  await writeFixture(cwd, "placeholder.txt", "not the stored content");
  const reviewed = await cli(["review", "--extraction", "saved.json", "--source", "placeholder.txt", "--no-config", "--out", "review.html"], { cwd });
  expect(reviewed.code, reviewed.stderr).toBe(0);
  const html = await readFile(join(cwd, "review.html"), "utf8");
  const parsed = JSON.parse(artifact);
  expect(html).toContain(parsed.source.digest);
  expect(html).toContain("paperless:42");
  expect(html).toContain("uncited");
  expect(html).not.toContain('<div class="line"');
});

it.each(["changed-text", "changed-digest", "wrong-variant", "missing-source", "missing-source-text"])("rejects inconsistent content provenance %s", async (change) => {
  const cwd = await tempDir("paperless-text-mismatch");
  const saved: Record<string, unknown> = contentRecord("Stored content");
  if (change === "changed-text") saved.sourceText = "Changed text";
  if (change === "changed-digest") saved.source = { ...contentRecord("Stored content").source, digest: "0".repeat(64) };
  if (change === "wrong-variant") saved.source = { ...contentRecord("Stored content").source, variant: "archive" };
  if (change === "missing-source") delete saved.source;
  if (change === "missing-source-text") delete saved.sourceText;
  await writeFixture(cwd, "saved.json", JSON.stringify(saved));
  await writeFixture(cwd, "placeholder.txt", "not evidence");
  const reviewed = await cli(["review", "--extraction", "saved.json", "--source", "placeholder.txt", "--no-config"], { cwd });
  expect(reviewed.code).toBe(2);
  expect(reviewed.stderr).toContain("source");
});

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAICAYAAADaxo44AAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVAiZY/z///9/BiyACZvg4JUAABofBAymvql2AAAAAElFTkSuQmCC";

it.each(["archive", "original"] as const)("binds %s review to the saved binary digest and preserves its identity", async (variant) => {
  const cwd = await tempDir("paperless-binary-review");
  const bytes = "exact saved PDF bytes";
  const source = { ...contentRecord("").source, variant, digest: createHash("sha256").update(bytes).digest("hex") };
  const record = { file: "paperless:42", ok: true, data: { subject: "Saved invoice" }, source,
    citations: [{ path: "subject", status: "verified", ids: ["p1-line-1"] }],
    citationSources: [{ id: "p1-line-1", pageNumber: 1, text: "Saved invoice", box: { x: 10, y: 20, width: 100, height: 10 } }] };
  await writeFixture(cwd, "saved.json", JSON.stringify({ version: 1, command: "paperless", action: "extract", ok: true, results: [record] }));
  await writeFixture(cwd, "source.pdf", bytes);
  await writeFixture(cwd, "docture.config.mjs", `const png=Uint8Array.from(atob(${JSON.stringify(PNG)}),c=>c.charCodeAt(0)); export default {loaders:[{name:"fixture",capabilities:{text:true,geometry:true,images:true,mimeTypes:["application/pdf"]},async load(){return {loader:"fixture",form:"digital",text:"Saved invoice",pages:[{pageNumber:1,width:600,height:800,text:"Saved invoice",image:async()=>png}]};}}]};`);
  const args = ["review", "--extraction", "saved.json", "--source", "source.pdf", "--out", "review.html"];
  const matching = await cli(args, { cwd });
  expect(matching.code, matching.stderr).toBe(0);
  const html = await readFile(join(cwd, "review.html"), "utf8");
  expect(html).toContain('data-line="p1-line-1"');
  expect(html).toContain(source.digest);
  expect(html).toContain('&quot;fileVersionId&quot;: 47');
  await writeFixture(cwd, "source.pdf", "different PDF bytes entirely");
  const mismatching = await cli(args, { cwd });
  expect(mismatching.code, mismatching.stderr).toBe(2);
  expect(mismatching.stderr).toContain("source digest");
});
