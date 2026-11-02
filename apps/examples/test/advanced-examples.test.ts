import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";
import { runExample as convert } from "../document-conversion/index.js";
import { runExample as importNative } from "../docling/index.js";
import { runExample as preload } from "../under-the-hood/index.js";
import { runExample as checked } from "../checked-tools-eval/index.js";
import { runExample as generate } from "../synthetic-corpus/index.js";
import { runExample as evaluate } from "../synthetic-corpus/evaluate.js";

it("extracts the local PDF through preloaded and capability-checked sources", async () => {
  expect(await preload()).toEqual({
    data: { invoiceNumber: "INV-2026-0142", total: 717.3 }, pages: 1, loader: "pdfjs",
  });
  expect((await checked()).data).toEqual({ invoiceNumber: "INV-2026-0142", total: 717.3 });
});

it("writes a real statement's Markdown and chunks with original page provenance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docture-conversion-example-"));
  const result = await convert(pathToFileURL(`${directory}/`));
  const markdown = await readFile(join(directory, "statement.md"), "utf8");
  expect(result.pages).toBe(6);
  expect(markdown).toContain("TRUE CHECKING");
  expect(markdown).toContain("READY RESERVE");
  expect(markdown).toContain("Account Reconciliation Form");
  const chunks = z.array(z.object({
    text: z.string().min(1), provenance: z.array(z.object({ pageNumber: z.number() })).min(1),
  })).parse(JSON.parse(await readFile(join(directory, "chunks.json"), "utf8")));
  expect(chunks).toHaveLength(result.chunks);
  expect([...new Set(chunks.flatMap((chunk) => chunk.provenance.map((part) => part.pageNumber)))].sort())
    .toEqual([1, 2, 3, 4, 5, 6]);
});

it("imports the actual native Docling file and retains its table in retrieval text", async () => {
  const result = await importNative();
  expect(result.pages).toBe(2);
  expect(result.text).toContain("The measured pressure is 100.");
  expect(result.chunks.join("\n")).toContain("| Pressure | 100 |");
});

it("scores generated digital PDFs perfectly and records the omissions in scanned PDFs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docture-synthetic-evaluation-"));
  const corpus = await generate(directory);
  expect(corpus).toMatchObject({ written: 4, skipped: 0, failed: [] });
  const result = await evaluate(corpus.manifest);
  const summary = result.summary["text-layer"];
  expect(summary?.cases).toEqual({ total: 4, scored: 4, errored: 0, skipped: 0 });
  expect(summary?.slices["rendition"]?.["digital"]?.metrics["f1"]).toBe(1);
  expect(summary?.slices["rendition"]?.["scan"]?.metrics["f1"]).toBe(0);
});
