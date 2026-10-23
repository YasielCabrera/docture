/**
 * Below the facade.
 *
 *     pnpm --filter @docture/examples internals
 *
 * Needs: `pnpm run fetch`. No API key.
 *
 * `Extractor` is a composition root, and a convenient one. Everything it does is
 * available a layer down, which matters in three situations: wiring that comes from a
 * config file, reading a document ONCE and extracting several things from it, and a host
 * that already has its own orchestration and wants the pipeline without the class.
 *
 * Read top to bottom:
 *
 *   1. THE SAME EXTRACTOR, FROM A CONFIG OBJECT
 *   2. `components()` — ask a wired extractor what is in it
 *   3. READ ONCE, EXTRACT MANY — the mechanism `Process` is built on
 *   4. `runPipeline` — no Extractor at all
 */

import { readFile } from "node:fs/promises";
import { Extractor, contract, createExtractor, declarationOrder, isLoadedSource, loadDocument, preloadedFeatures, runPipeline, silentLogger, type LoadedSource, type PipelineComponents } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { DocumentLoaderMuPdf } from "docture/loaders/mupdf";
import { z } from "zod";
import { Invoice } from "../shared/contracts.js";
import { odooInvoiceParser } from "../shared/parsers/odoo.js";
import { servicesInvoiceParser } from "../shared/parsers/services.js";
import { amount, field, heading, note, step, table } from "../shared/print.js";
import { isMain, requireDocument, run } from "../shared/run.js";

/**
 * Wiring as DATA. Nothing here is a docture type — it is the shape a config file, a
 * feature flag or an environment variable can produce.
 */
interface PipelineConfig {
  readonly loaders: readonly ("pdfjs" | "mupdf")[];
  readonly parsers: readonly ("odoo" | "services")[];
  readonly stageTimeoutMs?: number;
}

function build(config: PipelineConfig): Extractor {
  /**
   * `createExtractor` and `new Extractor({...})` are the same thing. The declarative form
   * exists precisely for this: a fluent chain cannot be assembled from a loop.
   */
  return createExtractor({
    loaders: config.loaders.map((name) =>
      name === "pdfjs" ? new DocumentLoaderPdfJs() : new DocumentLoaderMuPdf(),
    ),
    strategies: config.parsers.map((name) =>
      name === "odoo" ? odooInvoiceParser() : servicesInvoiceParser(),
    ),
    policy: declarationOrder,
    logger: silentLogger,
    ...(config.stageTimeoutMs === undefined ? {} : { stageTimeoutMs: config.stageTimeoutMs }),
  });
}

async function main(): Promise<void> {
  const path = await requireDocument("invoice-odoo");

  heading("Under the hood");

  // ── 1. From a config object ───────────────────────────────────────────────────

  step("1. the same extractor, from a config object");

  const config: PipelineConfig = {
    loaders: ["pdfjs", "mupdf"],
    parsers: ["odoo", "services"],
    stageTimeoutMs: 30_000,
  };
  const configured = build(config);

  try {
    const result = await configured.extract(path, Invoice);
    field("config", JSON.stringify(config));
    field("result", `${result.data.lineItems.length} line items via ${result.loader}`);

    // ── 2. components() ────────────────────────────────────────────────────────

    step("2. ask a wired extractor what is in it");

    /**
     * A getter, not a method. Returns copies, so a caller cannot mutate the wiring by holding the arrays. Useful
     * for a startup log or a health endpoint: "which loaders and strategies is this
     * process actually running?" should not require reading the code that built it.
     */
    const parts = configured.components;
    table(
      [
        { header: "kind", width: 16 },
        { header: "count", width: 7, right: true },
        { header: "names, in declaration order", width: 46 },
      ],
      [
        ["loaders", parts.loaders.length, parts.loaders.map((l) => l.name).join(" → ")],
        ["strategies", parts.strategies.length, parts.strategies.map((s) => s.name).join(" → ")],
        ["classifiers", parts.classifiers.length, parts.classifiers.map((c) => c.name).join(", ") || "—"],
        [
          "classifications",
          parts.classifications.length,
          parts.classifications.map((c) => c.name).join(", ") || "—",
        ],
      ],
    );
  } finally {
    await configured.dispose();
  }

  // ── 3. Read once, extract many ────────────────────────────────────────────────

  step("3. read once, extract many");

  /**
   * `loadDocument` is the load stage alone: a list of loaders, some bytes, and out comes
   * the parsed document plus which loader won and what the others did.
   */
  const read = await loadDocument(
    [new DocumentLoaderPdfJs()],
    { bytes: new Uint8Array(await readFile(path)), mimeType: "application/pdf" },
    silentLogger,
    AbortSignal.timeout(60_000),
    undefined,
  );

  field("loader that won", read.loader.name);
  field("loaders tried", read.attempts.map((a) => `${a.strategy}(${a.status})`).join(", "));
  field("pages", read.document.pages.length);

  /**
   * A `LoadedSource` is a document that has already been read, offered as a source. The
   * load stage is SKIPPED ENTIRELY — no loader is consulted and no bytes are read — which
   * is why it carries its own facts: `capabilities` cannot be asked for when there is no
   * loader in the picture.
   */
  const preloaded: LoadedSource = {
    loaded: read.document,
    mimeType: "application/pdf",
    fileName: "invoice-odoo.pdf",
  };

  field("isLoadedSource(preloaded)", isLoadedSource(preloaded));
  field("its features", JSON.stringify(preloadedFeatures(preloaded)));

  /**
   * Three different contracts against the SAME parsed document. The PDF is parsed once
   * and reused, which is exactly the mechanism `Process` uses to pull several documents
   * out of one bundle without paying to parse it several times.
   */
  const Header = contract({
    name: "header",
    description: "Just the identifying fields.",
    schema: z.object({ invoiceNumber: z.string(), vendor: z.string() }),
  });
  const Totals = contract({
    name: "totals",
    description: "Just the money.",
    schema: z.object({ subtotal: z.number(), tax: z.number(), total: z.number() }),
  });

  const reader = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(odooInvoiceParser());

  try {
    console.log("");
    const started = Date.now();
    const header = await reader.extractData(preloaded, Header);
    const totals = await reader.extractData(preloaded, Totals);
    const whole = await reader.extractData(preloaded, Invoice);
    const reused = Date.now() - started;

    field("header", `${header.invoiceNumber} from ${header.vendor}`);
    field("totals", `${amount(totals.subtotal)} + ${amount(totals.tax)} = ${amount(totals.total)}`);
    field("whole invoice", `${whole.lineItems.length} line items`);
    field("three extractions took", `${reused} ms, on one parse`);

    // The comparison that makes the point.
    const fromDisk = Date.now();
    await reader.extractData(path, Header);
    await reader.extractData(path, Totals);
    await reader.extractData(path, Invoice);
    field("the same three from disk", `${Date.now() - fromDisk} ms, three parses`);
    note(
      "One page, so the gap is small. On a 200-page scan it is the difference between a\n" +
        "report that finishes and one that gets killed.",
    );
  } finally {
    await reader.dispose();
  }

  // ── 4. runPipeline ────────────────────────────────────────────────────────────

  step("4. runPipeline — no Extractor at all");

  /**
   * `PipelineComponents` is what `Extractor` holds. Assembling it by hand gives you the
   * run loop — load, features, classify, route, attempt, validate — with none of the
   * class. For a host that already has its own registry and dependency injection, this is
   * the seam to use.
   *
   * Everything the loop decides still lands in `result.attempts`, in order.
   */
  const components: PipelineComponents = {
    loaders: [new DocumentLoaderPdfJs()],
    strategies: [servicesInvoiceParser(), odooInvoiceParser()],
    classifiers: [],
    classifications: [],
    policy: declarationOrder,
    logger: silentLogger,
    stageTimeoutMs: 30_000,
  };

  const direct = await runPipeline(components, path, Invoice.schema, {
    signal: AbortSignal.timeout(60_000),
  });

  field("answered by", direct.method);
  field("via loader", direct.loader);
  field("attempts", direct.attempts.map((a) => `${a.strategy}(${a.status})`).join(", "));
  field("line items", direct.data.lineItems.length);
  field("validated", direct.validation.valid);
  note(
    "Note the strategy order: `services` was declared first here, failed, and `odoo`\n" +
      "answered. Same policy, same recording, no Extractor — the class is a convenience\n" +
      "over this function, not a layer with its own behaviour.",
  );

  await components.loaders[0]?.dispose?.();
  for (const strategy of components.strategies) await strategy.dispose?.();

  console.log("\n  Next: 14-testing-your-pipeline — the test kit.");
}

if (isMain(import.meta.url)) await run(main);
