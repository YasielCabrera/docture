import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createExtractor, type LoadedDocument, type LoadedPage } from "docture";
import { llm } from "docture/llm/text";
import { memoryCache, type LlmCache } from "docture/llm/cache";
import { inMemoryLoader } from "docture/testing/doubles";

export interface RecordedCall {
  readonly prompt: unknown;
  readonly responseFormat: unknown;
}

export function promptText(prompt: unknown): string {
  return (prompt as { content: unknown }[]).map((message) => typeof message.content === "string"
    ? message.content
    : (message.content as { type: string; text?: string }[]).map((part) => part.text ?? "").join("\n")).join("\n");
}

export function replyModel(
  replies: readonly unknown[] | ((prompt: string) => unknown),
): { readonly model: MockLanguageModelV4; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const model = new MockLanguageModelV4({
    modelId: "mock-model",
    provider: "mock",
    async doGenerate(options) {
      const reply = typeof replies === "function"
        ? replies(promptText(options.prompt))
        : replies[Math.min(calls.length, replies.length - 1)];
      calls.push({ prompt: options.prompt, responseFormat: options.responseFormat });
      return {
        content: [{ type: "text" as const, text: typeof reply === "string" ? reply : JSON.stringify(reply) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 25, text: 25, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}

export function recordingCache(inner: LlmCache = memoryCache()): LlmCache & { readonly keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    async get(key) {
      keys.push(key);
      return inner.get(key);
    },
    set: (key, value) => inner.set(key, value),
  };
}

export function positionedPage(pageNumber: number, lines: readonly string[]): LoadedPage {
  return {
    pageNumber,
    width: 612,
    height: 792,
    text: lines.join("\n"),
    lines: lines.map((text, index) => ({
      y: 100 + index * 20,
      height: 12,
      text,
      spans: text === "" ? [] : [{ text, x: 72, y: 100 + index * 20, width: text.length * 6, height: 12 }],
    })),
  };
}

export function positionedDocument(pages: readonly (readonly string[])[]): LoadedDocument {
  const loaded = pages.map((lines, index) => positionedPage(index + 1, lines));
  return { pages: loaded, text: loaded.map((page) => page.text).join("\f"), form: "digital", loader: "fixture" };
}

export const invoicePages: readonly (readonly string[])[] = [
  ["Total due: $1,234.50", "Invoice INV-0042 issued by ACME Corp for consulting services."],
  ["Widgets subtotal 10.00", "Gadgets subtotal 20.00", "Please pay within thirty days of the invoice date."],
];

const Invoice = z.object({ total: z.number(), vendor: z.string().nullable() });

export async function uncitedRequests(): Promise<unknown> {
  const runs: Record<string, unknown> = {};
  for (const [name, completion, replies] of [
    ["single", "forbidden", [{ total: 1234.5, vendor: "ACME Corp" }]],
    ["paginate", "paginate", [{ total: 1234.5, vendor: "ACME Corp" }, { total: 30 }]],
    ["repair", "forbidden", [{ total: "1234.50", vendor: "ACME Corp" }, { total: 1234.5, vendor: "ACME Corp" }]],
  ] as const) {
    const { model, calls } = replyModel(replies);
    const cache = recordingCache();
    const document = positionedDocument(invoicePages);
    const result = await createExtractor({
      loaders: [inMemoryLoader(document)],
      strategies: [llm({ model, completion, cache })],
    }).extract({ loaded: document }, Invoice);
    runs[name] = { calls, keys: cache.keys, resultKeys: Object.keys(result).sort() };
  }
  return JSON.parse(JSON.stringify(runs));
}
