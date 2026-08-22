/**
 * `docture.config.ts` — the wiring, when flags stop being enough.
 *
 *     docture extract documents/invoice-odoo.pdf --config 15-cli/docture.config.ts
 *
 * The flags cover the common case: one PDF loader, one model, one schema. A config file
 * covers everything else, and it does it by handing you THE ACTUAL LIBRARY rather than a
 * description of it — your loaders, your strategies, constructed by your imports.
 *
 * Which means the deterministic parsers from `shared/parsers/` work from the command
 * line, unchanged, with no model and no API key. That is the thing worth noticing here:
 * the CLI is not a lesser interface with its own capabilities.
 *
 * Anything passed on the command line still wins over what is here — a config is a
 * default, never an override.
 */

import { defineConfig } from "@docture/cli";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { DocumentLoaderMuPdf } from "@docture/loader-mupdf";
import { Invoice } from "../shared/contracts.js";
import { odooInvoiceParser } from "../shared/parsers/odoo.js";
import { servicesInvoiceParser } from "../shared/parsers/services.js";
import { classifications } from "./kinds.js";
// Imported from the example itself, so this config uses the code you read there rather
// than a copy of it. Example 10 guards its `main` with `isMain`, so importing it is safe.
import { headingClassifier } from "../10-classification/index.js";

export default defineConfig({
  // Declaration order is the fallback order, exactly as in example 03.
  loaders: [new DocumentLoaderPdfJs(), new DocumentLoaderMuPdf()],

  /**
   * Given `strategies`, the CLI builds none of its own and `--model` is unused. Drop this
   * line and `--model openai/gpt-5` takes over — which is the two-line diff between a
   * free deterministic pipeline and a model-backed one.
   */
  strategies: [odooInvoiceParser(), servicesInvoiceParser()],

  /**
   * Without a classifier, `docture classify` has nothing to ask and says so. This one
   * reads headings, so `classify` works here with no model either.
   */
  classifiers: [headingClassifier()],
  classifications,
  // `Invoice.schema`, not `Invoice`: the config takes a schema, and `Invoice` is a
  // contract wrapping one. `schemaOf(Invoice)` says the same thing if you would rather
  // not reach into the object.
  schema: Invoice.schema,
  stageTimeoutMs: 60_000,

  /**
   * Where model responses are cached, relative to this file. Nothing to cache while
   * `strategies` is set and no model runs — it is here for the moment you add one.
   */
  cacheDir: "../.cache/docture",
  concurrency: 4,
});
