# 06-fallback-routing-and-errors — Fallback, routing and errors

> the fallback chain over eleven real layouts, `RoutingPolicy`, `only`, all fourteen typed errors, timeouts, cancellation, logging, duplicate names.

**Needs:** `pnpm run fetch`. No API key — and the missing key is itself one of the rungs this example reports.

```sh
pnpm --filter @docture/examples fallback
```

Docs: [`reference/errors`](../../docs/content/docs/resources/errors.mdx)

## Imports and installs

Routing and errors come from `docture`; the PDF reader comes from
`docture/loaders/pdfjs`. The optional `LLM` fallback comes from `docture/llm`
and needs `ai@^7.0.0`.

For a separate application:

```sh
pnpm add docture pdfjs-dist@6.2.108 zod
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

## What you learn

This is the example the corpus buys. Eleven real invoice layouts, two hand-written
parsers:

```
document                 answered by              outcome            strategies tried, in order
invoice-odoo             odoo-invoice-parser      4 items, free      odoo-invoice-parser ✓
invoice-services         services-invoice-parser  2 items, free      odoo ✗ → services ✓
invoice-aws              nothing                  EXTRACTION_FAILED  odoo ✗ → services ✗
invoice-flipkart         nothing                  EXTRACTION_FAILED  odoo ✗ → services ✗
…
```

**Two extracted, nine fell through.** That is what a two-parser pipeline honestly is, and
it is the state every real pipeline is in on a Tuesday. Set `AI_GATEWAY_API_KEY` and the
model becomes the last rung: the two parsers still win on their layouts — free and exact
beats paid and general — and the other nine stop being failures. The wiring diff is one
`.loadLlm(...)`.

## Order is the policy

Strategies run in the order you declared them; the first that does not throw wins. A
`RoutingPolicy` replaces that when it should not be true, and it sees only the *feasible*
candidates.

## Every failure is typed

Fourteen error classes, each with a literal `code`, so a `switch` over `DoctureErrorCode` is
checked for exhaustiveness by the compiler. Add an error to the library and the `advise`
function in this example stops compiling until it is handled — which is the difference
between a typed failure contract and a documented one.

Two things worth noting from the run:

- **`errorCodeOf` and `messageOf` work on any thrown value**, including one that is not
  an `Error`. That is what you want in a `catch`.
- **`controller.abort()` with no argument** gives a real `AbortError`, which
  `isAbortError` recognises. Aborting with `new Error("...")` gives you a cancellation the
  platform does not recognise as one.

## What to read next

[`07-with-a-model`](../07-with-a-model) — the AI SDK seam.
