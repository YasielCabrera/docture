/**
 * Nothing is silent.
 *
 *     pnpm --filter @docture/examples fallback
 *
 * Needs: `pnpm run fetch`. No API key — and the missing key is itself one of the rungs
 * this example reports, which is the point. Set AI_GATEWAY_API_KEY to add a model as
 * the last resort and watch the table change.
 *
 * Read top to bottom:
 *
 *   1. ELEVEN REAL LAYOUTS, two parsers. Watch what happens to the other nine
 *   2. ORDER IS THE POLICY — and a `RoutingPolicy` when it should not be
 *   3. `only` — pin the run to one strategy
 *   4. EVERY FAILURE IS TYPED, and a `switch` over the codes is exhaustive
 *   5. TIMEOUTS AND CANCELLATION
 *   6. A LOGGER, if you want the running commentary
 *   7. TWO STRATEGIES WITH ONE NAME is a wiring error, not a shadowing bug
 */

import { ContractViolationError, DuplicateComponentError, ExtractionFailedError, LoadFailedError, MissingEngineError, ModelOutputError, PageSelectionError, NoEligibleLoaderError, NoEligibleStrategyError, NoConvertibleContentError, SplitFailedError, TimeoutError, UnclassifiedGroupError, UnsupportedSourceError, consoleLogger, declarationOrder, defineStrategy, errorCodeOf, isAbortError, messageOf, silentLogger, type ExtractionStrategy, type Logger, type DoctureErrorCode, type RoutingPolicy } from "docture";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice } from "../shared/contracts.js";
import { odooInvoiceParser } from "../shared/parsers/odoo.js";
import { servicesInvoiceParser } from "../shared/parsers/services.js";
import { field, heading, note, step, table } from "../shared/print.js";
import { idsOfKind, pathOf } from "../shared/documents.js";
import { isMain, optionalModel, requireDocument, run } from "../shared/run.js";

/** The wiring under test. Exported so the test drives exactly this. */
export function invoiceChain(model?: ReturnType<typeof optionalModel>): Extractor {
  const extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    // Order IS the routing policy. Free and exact first, paid and general last.
    .loadStrategy(odooInvoiceParser(), servicesInvoiceParser());

  if (model !== undefined) extractor.loadLlm(model);
  return extractor;
}

async function main(): Promise<void> {
  await requireDocument("invoice-odoo");
  const model = optionalModel();

  heading("Fallback, routing, and the typed failure contract");

  // ── 1. Eleven real layouts, two parsers ──────────────────────────────────────

  step("1. eleven real invoice layouts, two hand-written parsers");

  note(
    "This is what a real pipeline looks like on a Tuesday. Two layouts somebody sat down\n" +
      "and wrote a parser for; nine nobody has. The two are read free and exact. The nine\n" +
      "fall through — and `result.attempts` says exactly what was tried and in what order,\n" +
      "so 'why did the model run?' is answerable from the return value alone.\n\n" +
      "(A twelfth invoice in the corpus arrives as plain text rather than a PDF. It is in\n" +
      "example 03, because the interesting thing about it is the loader.)",
  );
  console.log("");

  const extractor = invoiceChain(model);
  const rows: unknown[][] = [];
  let answered = 0;

  try {
    for (const id of idsOfKind("invoice")) {
      const outcome = await extractor.safeExtract(pathOf(id), Invoice);

      if (outcome.ok) {
        answered += 1;
        rows.push([
          id,
          outcome.result.method,
          outcome.result.usage.totalTokens === 0
            ? `${outcome.result.data.lineItems.length} items, free`
            : `${outcome.result.data.lineItems.length} items, ${outcome.result.usage.totalTokens} tok`,
          outcome.result.attempts
            .map((a) => (a.status === "ok" ? `${a.strategy} ✓` : a.strategy))
            .join(" → "),
        ]);
      } else {
        // The interesting rows. Every attempt is on the error, with its message.
        const attempts =
          outcome.error instanceof ExtractionFailedError ? outcome.error.attempts : [];
        const failed = attempts.filter((a) => a.status === "failed");
        rows.push([
          id,
          "nothing",
          errorCodeOf(outcome.error) ?? "?",
          // Every rung, in order. This is the column worth reading: it is the whole
          // reason `attempts` is on the result rather than in a log somewhere.
          failed.map((a) => `${a.strategy} ✗`).join(" → ") || messageOf(outcome.error),
        ]);
      }
    }
  } finally {
    await extractor.dispose();
  }

  table(
    [
      { header: "document", width: 23 },
      { header: "answered by", width: 23 },
      { header: "outcome", width: 17 },
      { header: "strategies tried, in order", width: 47 },
    ],
    rows,
  );

  console.log("");
  field("PDF layouts tried", rows.length);
  field("extracted", answered);
  field("fell through", rows.length - answered);
  field("model configured", model === undefined ? "no — AI_GATEWAY_API_KEY unset" : model.id);
  if (model === undefined) {
    note(
      "Those nine failures are the honest state of a two-parser pipeline. Set\n" +
        "AI_GATEWAY_API_KEY and the model becomes the last rung: the two parsers still win\n" +
        "on their layouts — free and exact beats paid and general — and the other nine stop\n" +
        "being failures. Nothing about the wiring changes except one `.loadLlm(...)`.",
    );
  }

  // ── 2. Order is the policy ────────────────────────────────────────────────────

  step("2. order is the policy — until you replace it");

  /**
   * `declarationOrder` is the default: eligible strategies run in the order you
   * declared them. A `RoutingPolicy` sees only the FEASIBLE candidates and may reorder
   * them, which is the hook for "prefer whichever parser matched this vendor last time"
   * without touching the wiring.
   */
  const preferServices: RoutingPolicy = (candidates, ctx) => {
    const ordered = declarationOrder(candidates, ctx);
    return [...ordered].sort((a, b) => {
      const rank = (s: ExtractionStrategy): number =>
        s.name.startsWith("services") ? 0 : 1;
      return rank(a) - rank(b);
    });
  };

  for (const [label, policy] of [
    ["declaration order", declarationOrder],
    ["policy: services first", preferServices],
  ] as const) {
    const routed = new Extractor({
      loaders: [new DocumentLoaderPdfJs()],
      strategies: [odooInvoiceParser(), servicesInvoiceParser()],
      policy,
    });
    try {
      const result = await routed.extract(pathOf("invoice-services"), Invoice);
      const order = result.attempts.map((a) => a.strategy).join(" → ");
      field(label, order);
    } finally {
      await routed.dispose();
    }
  }
  note("Same two strategies, same document. Only the order the pipeline tried them in.");

  // ── 3. `only` ─────────────────────────────────────────────────────────────────

  step("3. `only` — pin the run to one strategy");

  /**
   * Useful for an eval sweep: run the same corpus through each strategy in isolation and
   * compare. Example 12 does exactly that.
   */
  const pinned = invoiceChain();
  try {
    const outcome = await pinned.safeExtract(pathOf("invoice-services"), Invoice, {
      only: ["odoo-invoice-parser"],
    });
    field("only: [odoo], services doc", outcome.ok ? "extracted" : errorCodeOf(outcome.error) ?? "?");
    const ok = await pinned.safeExtract(pathOf("invoice-services"), Invoice, {
      only: ["services-invoice-parser"],
    });
    field("only: [services], same doc", ok.ok ? `extracted by ${ok.result.method}` : "failed");
  } finally {
    await pinned.dispose();
  }

  // ── 4. Every failure is typed ─────────────────────────────────────────────────

  step("4. every failure is typed, and the switch is exhaustive");

  /**
   * Every error in this library carries a literal `code`, so a `switch` over
   * `DoctureErrorCode` is checked for exhaustiveness by the compiler. Add an error to the
   * library and this function stops compiling until it is handled — which is the
   * difference between a typed failure contract and a documented one.
   */
  function advise(code: DoctureErrorCode): string {
    switch (code) {
      case "NO_ELIGIBLE_LOADER":
        return "wire a loader that accepts this media type";
      case "LOAD_FAILED":
        return "every loader threw; the bytes are probably not what they claim";
      case "NO_CONVERTIBLE_CONTENT":
        return "the selected loader found no indexable text; configure OCR for a scan";
      case "NO_ELIGIBLE_STRATEGY":
        return "the document lacks a fact every strategy requires — OCR or render it";
      case "EXTRACTION_FAILED":
        return "every strategy threw; read `attempts` for each reason";
      case "PAGE_OUT_OF_RANGE":
        return "select at least one existing page number";
      case "MODEL_OUTPUT_FAILED":
        return "the model response failed its schema; usage includes the billed call";
      case "CONTRACT_VIOLATION":
        return "data came back the wrong shape; `issues` names the field";
      case "UNSUPPORTED_SOURCE":
        return "that was not a document";
      case "TIMEOUT":
        return "a stage passed `stageTimeoutMs`; raise it or shrink the work";
      case "DUPLICATE_COMPONENT":
        return "two components share a name; rename one at the wiring site";
      case "SPLIT_FAILED":
        return "the splitter could not cut the bundle";
      case "UNCLASSIFIED_GROUP":
        return 'pages matched no classification; pass { onUnclassified: "skip" } to drop them';
      case "MISSING_ENGINE":
        return "install the optional engine the message names; the file was not read";
      case "MISSING_COMPONENT":
        return "supply the missing pipeline component before running";
      case "EVAL_SPEC_INVALID":
      case "GROUND_TRUTH_INVALID":
      case "EVAL_DATASET_INVALID":
      case "EVAL_RUN_STORE_FAILED":
      case "OUT_OF_SCOPE":
      case "MIGRATION_GUARD_FAILED":
      case "EVAL_RUNS_INCOMPARABLE":
      case "EVAL_PREFLIGHT_FAILED":
        return "raised by @docture/eval, not by extraction";
    }
  }

  /**
   * Every code in the union, paired with the class that raises it.
   *
   * `satisfies` is doing real work here: the second element of each pair must be a
   * `DoctureErrorCode`, so a typo is a compile error rather than a row that reads
   * plausibly and means nothing.
   */
  const ERRORS = [
    ["NoEligibleLoaderError", "NO_ELIGIBLE_LOADER"],
    ["LoadFailedError", "LOAD_FAILED"],
    ["PageSelectionError", "PAGE_OUT_OF_RANGE"],
    ["ModelOutputError", "MODEL_OUTPUT_FAILED"],
    ["NoConvertibleContentError", "NO_CONVERTIBLE_CONTENT"],
    ["NoEligibleStrategyError", "NO_ELIGIBLE_STRATEGY"],
    ["ExtractionFailedError", "EXTRACTION_FAILED"],
    ["ContractViolationError", "CONTRACT_VIOLATION"],
    ["UnsupportedSourceError", "UNSUPPORTED_SOURCE"],
    ["TimeoutError", "TIMEOUT"],
    ["DuplicateComponentError", "DUPLICATE_COMPONENT"],
    ["SplitFailedError", "SPLIT_FAILED"],
    ["UnclassifiedGroupError", "UNCLASSIFIED_GROUP"],
    ["MissingEngineError", "MISSING_ENGINE"],
    ["MissingComponentError", "MISSING_COMPONENT"],
  ] as const satisfies readonly (readonly [string, DoctureErrorCode])[];

  table(
    [
      { header: "error class", width: 25 },
      { header: "code", width: 21 },
      { header: "what to do about it", width: 62 },
    ],
    ERRORS.map(([name, code]) => [name, code, advise(code)]),
  );

  // Every one of these classes is a real export, and every one extends `DoctureError`.
  // `instanceof DoctureError` catches the family; `switch (error.code)` splits it.
  field(
    "all fourteen are exported",
    [
      NoEligibleLoaderError,
      LoadFailedError,
      PageSelectionError,
      ModelOutputError,
      NoConvertibleContentError,
      NoEligibleStrategyError,
      ExtractionFailedError,
      ContractViolationError,
      UnsupportedSourceError,
      TimeoutError,
      DuplicateComponentError,
      SplitFailedError,
      UnclassifiedGroupError,
      MissingEngineError,
    ].every((Cls) => Cls.prototype instanceof Error),
  );

  note(
    "`safeExtract` is the non-throwing form, mirroring Zod's `parse` / `safeParse`.\n" +
      "`errorCodeOf` and `messageOf` read a code and a message off ANY thrown value,\n" +
      "including one that is not an Error at all — which is what you want in a catch.",
  );
  console.log("");
  field("errorCodeOf(TimeoutError)", errorCodeOf(new TimeoutError("load", 10)));
  field("errorCodeOf(a bare string)", String(errorCodeOf("a string")));
  field("messageOf({ nope: 1 })", messageOf({ nope: 1 }));

  // ── 5. Timeouts and cancellation ──────────────────────────────────────────────

  step("5. timeouts and cancellation");

  /** A strategy that takes longer than the deadline it is given. */
  const slow = defineStrategy({
    name: "deliberately-slow",
    requires: ["TEXT_LAYER"],
    async extract(ctx) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      ctx.signal.throwIfAborted();
      return { data: {} };
    },
  });

  const impatient = new Extractor({
    loaders: [new DocumentLoaderPdfJs()],
    strategies: [slow],
    // Per-stage, not per-run: loading and extracting each get their own deadline.
    stageTimeoutMs: 50,
  });
  try {
    const outcome = await impatient.safeExtract(pathOf("invoice-odoo"), Invoice);
    if (!outcome.ok) {
      const attempts = outcome.error instanceof ExtractionFailedError ? outcome.error.attempts : [];
      field("stageTimeoutMs: 50", errorCodeOf(outcome.error) ?? "?");
      field("the attempt says", attempts.at(-1)?.error ?? messageOf(outcome.error));
      field("errorCode on the attempt", attempts.at(-1)?.errorCode ?? "(none)");
    }
  } finally {
    await impatient.dispose();
  }

  /**
   * An `AbortSignal` you own. `isAbortError` is the one predicate that recognises a
   * cancellation however it was raised — a `DOMException`, a `TimeoutError`, or a
   * provider's own abort shape.
   */
  const cancellable = invoiceChain();
  try {
    const controller = new AbortController();
    // No reason argument: the signal then carries a real `AbortError` DOMException,
    // which is what `isAbortError` is for. Aborting with a plain `new Error("...")`
    // gives you a cancellation the platform does not recognise as one — worth knowing,
    // because it is the difference between "the user left" and "something broke".
    controller.abort();
    const outcome = await cancellable.safeExtract(pathOf("invoice-odoo"), Invoice, {
      signal: controller.signal,
    });
    console.log("");
    field("aborted before starting", outcome.ok ? "extracted anyway" : "stopped");
    if (!outcome.ok) field("isAbortError(error)", isAbortError(outcome.error));
  } finally {
    await cancellable.dispose();
  }

  // ── 6. A logger ───────────────────────────────────────────────────────────────

  step("6. a logger, if you want the running commentary");

  /**
   * `silentLogger` is the default — a library should not print unless asked.
   * `consoleLogger` is the built-in. A `Logger` is four methods and a `child`, so
   * routing it into pino, winston or an OTEL span is a small adapter.
   */
  const captured: string[] = [];
  const collecting: Logger = {
    debug: (message) => captured.push(`debug ${message}`),
    info: (message) => captured.push(`info  ${message}`),
    warn: (message) => captured.push(`warn  ${message}`),
    error: (message) => captured.push(`error ${message}`),
    // `child` scopes the bindings, which is how each attempt's log lines carry the
    // strategy name without every call site repeating it.
    child: () => collecting,
  };

  const logged = invoiceChain().loadLogger(collecting);
  try {
    await logged.safeExtract(pathOf("invoice-aws"), Invoice);
    field("log lines captured", captured.length);
    for (const line of captured.slice(0, 6)) console.log(`    ${line}`);
    if (captured.length > 6) console.log(`    … ${captured.length - 6} more`);
  } finally {
    await logged.dispose();
  }
  console.log("");
  // `consoleLogger` is a FACTORY — it takes the bindings every line should carry.
  // `silentLogger` is already an instance, because there is nothing to bind.
  field("consoleLogger({...}).child", typeof consoleLogger({ run: 42 }).child);
  field("silentLogger", typeof silentLogger.child);
  field("the default", "silentLogger — a library should not print unless asked");

  // ── 7. Two components with one name ───────────────────────────────────────────

  step("7. two strategies with one name is a wiring error");

  /**
   * ES modules resolve an ambiguous name by silently dropping one. A component registry
   * that did the same would mean the strategy you thought you registered never ran, and
   * nothing would say so. So it fails at the WIRING LINE instead.
   */
  try {
    new Extractor().loadStrategy(odooInvoiceParser(), odooInvoiceParser());
    field("same name twice", "allowed — that would be a bug");
  } catch (error) {
    if (error instanceof DuplicateComponentError) {
      field("error.code", error.code);
      field("message", error.message);
    }
  }

  console.log("\n  Next: 07-with-a-model — the AI SDK seam.");
}

if (isMain(import.meta.url)) await run(main);
