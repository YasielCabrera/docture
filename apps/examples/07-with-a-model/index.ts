/**
 * The AI SDK seam: bringing your own model.
 *
 *     AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples model
 *
 * Needs: `pnpm fetch` AND a real API key. There is no mock — a mock would teach you the
 * wiring and lie about the answer, and the answer is the thing a model is for. Without
 * a key this skips loudly and exits 0.
 *
 * The document is `invoice-aws`, deliberately: example 06 showed that neither
 * hand-written parser can read it. This is the layout nobody wrote a parser for, which
 * in production is most of them.
 *
 * Read top to bottom:
 *
 *   1. ONE LINE TO ADD A MODEL — and what `LLM` turns itself into
 *   2. THE MODEL IS THE AI SDK's — a gateway string, or a provider instance
 *   3. THE PROMPT, printed. `system` vs `instructions` vs `hints`
 *   4. PRICING — tokens are honest, cost needs a table
 *   5. CACHING — run it twice, pay once
 *   6. TWO MODELS AT ONCE, cheap first
 */

import {
  CompletionStrategy,
  Extractor,
  contract,
  type ExtractionResult,
} from "docture";
import {
  DEFAULT_SYSTEM_PROMPT,
  LLM,
  buildPrompt,
  cacheKey,
  llm,
  lookupPricing,
  memoryCache,
  modelIdOf,
  toUsage,
  type PricingTable,
} from "@docture/llm";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { z } from "zod";
import { Invoice } from "../shared/contracts.js";
import { odooInvoiceParser } from "../shared/parsers/odoo.js";
import { servicesInvoiceParser } from "../shared/parsers/services.js";
import { amount, field, heading, note, provenance, step, table } from "../shared/print.js";
import { pathOf } from "../shared/documents.js";
import { MODEL_NAME, isMain, requireDocument, requireModel, run } from "../shared/run.js";

/**
 * A pricing table is USD per MILLION tokens, keyed by model id — the unit every
 * provider quotes. Without one, `usage.costUsd` stays honestly `undefined` rather than
 * reporting a zero that might mean "free" or might mean "unpriced".
 *
 * These are illustrative. Put your real numbers here, or load them from config.
 */
const PRICING: PricingTable = {
  "gpt-5": { inputPerMillion: 1.25, outputPerMillion: 10 },
  "gpt-5-mini": { inputPerMillion: 0.25, outputPerMillion: 2 },
  "claude-opus-5": { inputPerMillion: 5, outputPerMillion: 25 },
};

async function main(): Promise<void> {
  const path = await requireDocument("invoice-aws");
  // Throws ExampleSkipped without a key, which `run` prints as a bordered block.
  const model = requireModel({ pricing: PRICING });

  heading(`A layout nobody wrote a parser for, read by ${model.id}`);

  // ── 1. One line to add a model ────────────────────────────────────────────────

  step("1. one line to add a model");

  /**
   * `loadLlm` takes a `ModelBackend`, not a `LanguageModel`. That indirection is the
   * whole reason `@docture/core` does not depend on the AI SDK — a deterministic
   * pipeline should not install a model client, and a test in `packages/core` enforces
   * it. `LLM` is the implementation of that seam.
   *
   * One `LLM` knows how to become four things: the text extraction strategy, the vision
   * strategy, the classifier and the splitter, all configured once.
   */
  const extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    // Free and exact first. Both of these will fail on this document, and that is the
    // point: the model is the fallback, not the default.
    .loadStrategy(odooInvoiceParser(), servicesInvoiceParser())
    .loadLlm(model);

  try {
    const result = await extractor.extract(path, Invoice);
    field("vendor", result.data.vendor);
    field("invoice number", result.data.invoiceNumber);
    field("total", `${result.data.currency} ${amount(result.data.total)}`);
    console.log(`\n  ${result.data.lineItems.length} line items:\n`);
    table(
      [
        { header: "description", width: 40 },
        { header: "qty", width: 6, right: true },
        { header: "amount", width: 12, right: true },
      ],
      result.data.lineItems.map((i) => [i.description, amount(i.quantity), amount(i.amount)]),
    );
    provenance(result);
    note(
      "Read those attempts: two parsers were tried and failed before a token was spent.\n" +
        "That ordering is not an optimisation, it is the design — `result.method` is how\n" +
        "you know a model ran at all.",
    );

    // ── 2. The model is the AI SDK's ────────────────────────────────────────────

    step("2. three ways to say which model");

    field("a gateway string", `new LLM("${MODEL_NAME}")`);
    field("a provider instance", 'new LLM(openai("gpt-5"))  // pnpm add @ai-sdk/openai');
    field("your own provider", "new LLM(myProvider.chat(...))");
    field("modelIdOf(this one)", modelIdOf(model.model));
    note(
      "`ai` is a PEER dependency, so there is exactly one copy of `LanguageModel` in the\n" +
        "tree and the model you construct is the model that runs. A gateway string needs no\n" +
        "provider package at all — the AI SDK routes it.",
    );

    // ── 3. The prompt, printed ──────────────────────────────────────────────────

    step("3. the prompt, printed");

    /**
     * Three knobs, three scopes, and it is worth knowing which is which:
     *
     *   - `system`       REPLACES the default system prompt. Reach for this last.
     *   - `instructions` APPENDS to it. The usual place for domain guidance.
     *   - `hints`        per-classification notes, keyed by name. Layout quirks.
     *
     * `buildPrompt` is exported so you can see exactly what gets sent, and build on the
     * defaults rather than replace them.
     */
    const parts = buildPrompt("<<the document text goes here>>", {
      instructions: "Amounts may use a comma as a thousands separator.",
      hints: "AWS invoices list per-service charges with no quantity column.",
    });

    console.log(`  DEFAULT_SYSTEM_PROMPT is ${DEFAULT_SYSTEM_PROMPT.length} chars. With both`);
    console.log("  `instructions` and `hints` appended, the system message becomes:\n");
    for (const line of parts.system.split("\n")) console.log(`    │ ${line}`);
    console.log("\n  and the user message:\n");
    for (const line of parts.prompt.split("\n")) console.log(`    │ ${line}`);
    note(
      "The document is wrapped in delimiters. Without them, a document containing\n" +
        'something that reads like an instruction ("ignore the above and…") is\n' +
        "indistinguishable from one.",
    );

    // ── 4. Pricing ──────────────────────────────────────────────────────────────

    step("4. pricing — tokens are honest, cost needs a table");

    const priced = await extractor.extract(pathOf("invoice-flipkart"), Invoice);
    field("input tokens", priced.usage.inputTokens.toLocaleString());
    field("output tokens", priced.usage.outputTokens.toLocaleString());
    field(
      "costUsd",
      priced.usage.costUsd === undefined
        ? "undefined — no pricing entry for this model id"
        : `$${priced.usage.costUsd.toFixed(6)}`,
    );

    /**
     * `lookupPricing` falls back from `"openai/gpt-5"` to `"gpt-5"`, so one table serves
     * both a gateway string and a provider instance.
     */
    field("lookupPricing(gateway id)", JSON.stringify(lookupPricing(MODEL_NAME, PRICING)));
    field("lookupPricing(unknown)", String(lookupPricing("some/unknown-model", PRICING)));
    // `toUsage` is what a custom strategy calls to report its own spend in the same
    // shape, so a hand-written model strategy costs the same way the built-in one does.
    field(
      "toUsage(...) for a custom strategy",
      JSON.stringify(toUsage({ inputTokens: 1000, outputTokens: 200 }, 120, "gpt-5", PRICING)),
    );

    // ── 5. Caching ──────────────────────────────────────────────────────────────

    step("5. caching — run it twice, pay once");

    /**
     * The key covers everything that could change the answer: model id, both prompts,
     * and the JSON Schema. Leave the schema out and a schema change silently returns the
     * old shape — which is why `cacheKey` takes it rather than letting a caller forget.
     *
     * `memoryCache` is bounded and in-process, enough for one eval run. `fileCache(dir)`
     * survives the process, which is what you want re-scoring a corpus.
     */
    const cache = memoryCache();
    const cached = new Extractor()
      .loadDocumentLoader(new DocumentLoaderPdfJs())
      .loadStrategy(llm({ model: model.model, cache, pricing: PRICING, temperature: 0 }));

    try {
      const first = await cached.extract(pathOf("invoice-oyo"), Invoice);
      const second = await cached.extract(pathOf("invoice-oyo"), Invoice);
      table(
        [
          { header: "run", width: 10 },
          { header: "tokens", width: 12, right: true },
          { header: "cost", width: 12, right: true },
          { header: "wall", width: 10, right: true },
        ],
        (
          [
            ["first", first],
            ["second", second],
          ] as const
        ).map(([label, r]: readonly [string, ExtractionResult<unknown>]) => [
          label,
          r.usage.totalTokens.toLocaleString(),
          r.usage.costUsd === undefined ? "—" : `$${r.usage.costUsd.toFixed(6)}`,
          `${r.usage.wallMs} ms`,
        ]),
      );
      field(
        "a key looks like",
        `${cacheKey({ modelId: "gpt-5", system: "s", prompt: "p", jsonSchema: {} }).slice(0, 24)}…`,
      );
    } finally {
      await cached.dispose();
    }

    // ── 6. Two models at once ───────────────────────────────────────────────────

    step("6. two models at once, cheap first");

    /**
     * A strategy's `name` defaults to the model id, so registering two models is just
     * registering two strategies — and order is still the policy. Send everything to the
     * cheap one and let the expensive one catch what it drops.
     *
     * The contract here is small on purpose: a two-field answer is a fair thing to ask a
     * mini model for, and this is the shape of a real cost-tiering setup.
     */
    const Vendor = contract({
      name: "vendor-only",
      description: "Just who issued this invoice, and what it came to.",
      schema: z.object({ vendor: z.string(), total: z.number() }),
    });

    const tiered = new Extractor().loadDocumentLoader(new DocumentLoaderPdfJs()).loadStrategy(
      llm({
        model: "openai/gpt-5-mini",
        name: "mini",
        pricing: PRICING,
        temperature: 0,
        // One request, and an error if the document does not fit — rather than a silent
        // split. Example 08 is about the other two options.
        completion: CompletionStrategy.FORBIDDEN,
      }),
      llm({ model: model.model, name: "flagship", pricing: PRICING, temperature: 0 }),
    );

    try {
      const result = await tiered.extract(pathOf("invoice-saeco"), Vendor);
      field("answered by", result.method);
      field("vendor", result.data.vendor);
      field("total", amount(result.data.total));
      field(
        "cost",
        result.usage.costUsd === undefined ? "unpriced" : `$${result.usage.costUsd.toFixed(6)}`,
      );
      if (result.attempts.some((a) => a.status === "failed")) provenance(result);
    } finally {
      await tiered.dispose();
    }

    note(
      "`createLlmExtractor({ model })` is the one-call version of this whole file, for\n" +
        "when you want a model-backed extractor and no opinions about routing.",
    );
    console.log("\n  Next: 08-long-documents — when one request is not enough.");
  } finally {
    await extractor.dispose();
  }
}

if (isMain(import.meta.url)) await run(main);
