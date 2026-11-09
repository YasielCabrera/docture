# Extract an invoice with a model

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Use the AI SDK gateway as the model provider, wrap the model in `LLM`, and register it with `loadLlm`. The local PDF and schema are the same inputs you would supply in an application. With a direct provider, the same line reads `.loadLlm(new LLM(openai("gpt-5")))`.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples model
```

The result contains the invoice number, total, line items, and provider usage. A live request requires an AI Gateway account and incurs provider charges.

`DOCTURE_MODEL` overrides the default gateway model `anthropic/claude-sonnet-4.6`. `runExample(model)` accepts any AI SDK language model, including a direct provider instance. Tests supply a deterministic provider mock while still reading this PDF.

For a standalone application, install the integrations used here.

```sh
pnpm add docture ai zod pdfjs-dist
```

The sample PDF is bundled beside the code. [Original document](https://raw.githubusercontent.com/Egrarobo/apify-actors/main/pdf-tables-to-rows/samples/invoice-us-ruled.pdf).
