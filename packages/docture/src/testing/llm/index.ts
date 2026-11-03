/**
 * Deterministic language models for testing docture's model-backed layout and OCR
 * without credentials. They implement the AI SDK provider interface directly, so
 * this entry needs `ai` only for its types.
 */

import type { LanguageModel } from "ai";
import type { DocumentElement, LayoutAnnotation, LayoutBox } from "../../core/index.js";
import type { LlmOcrElement } from "../../llm/ocr.js";

/** The provider-level model the AI SDK calls. */
export type MockLanguageModel = Extract<LanguageModel, { readonly specificationVersion: "v4" }>;

export interface MockModelOptions {
  /** Default `"mock-model"`. Pricing tables look models up by this id. */
  readonly modelId?: string;
  /** Tokens reported for every call. Default 0 and 0. */
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}

/** One element as `llmLayout` describes it to the model. */
export interface LayoutModelElement {
  readonly id: string;
  readonly role: DocumentElement["kind"];
  readonly box: LayoutBox;
  /** Text, list item texts, or table rows, by role. */
  readonly content: unknown;
}

export interface LayoutModelPage {
  readonly pageNumber: number;
  readonly elements: readonly LayoutModelElement[];
}

type Prompt = Parameters<MockLanguageModel["doGenerate"]>[0]["prompt"];

function userText(prompt: Prompt): string {
  return prompt.flatMap((message) => message.role === "user"
    ? message.content.flatMap((part) => part.type === "text" ? [part.text] : [])
    : []).join("\n");
}

function answering(answer: (prompt: Prompt) => unknown, options: MockModelOptions): MockLanguageModel {
  const inputTokens = options.usage?.inputTokens ?? 0;
  const outputTokens = options.usage?.outputTokens ?? 0;
  return {
    specificationVersion: "v4",
    provider: "mock",
    modelId: options.modelId ?? "mock-model",
    supportedUrls: {},
    async doGenerate(call) {
      return {
        content: [{ type: "text", text: JSON.stringify(answer(call.prompt)) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
        },
        warnings: [],
      };
    },
    async doStream() {
      throw new Error("The docture mock model does not stream.");
    },
  };
}

/**
 * A model for `llmLayout` that answers with the given annotations.
 *
 * Element ids are content digests, so pass a function to choose annotations from
 * the elements the analyzer sends instead of hard-coding ids.
 */
export function mockLayoutModel(
  annotations: readonly LayoutAnnotation[] | ((pages: readonly LayoutModelPage[]) => readonly LayoutAnnotation[]),
  options: MockModelOptions = {},
): MockLanguageModel {
  return answering((prompt) => ({
    annotations: typeof annotations === "function"
      ? annotations(JSON.parse(userText(prompt)) as LayoutModelPage[])
      : annotations,
  }), options);
}

/** A model for `llmOcr` that answers each page with its listed elements, and a blank page otherwise. */
export function mockOcrModel(
  pages: Readonly<Record<number, readonly LlmOcrElement[]>>,
  options: MockModelOptions = {},
): MockLanguageModel {
  return answering((prompt) => {
    const pageNumber = Number(/page (\d+)/iu.exec(userText(prompt))?.[1]);
    return { elements: pages[pageNumber] ?? [] };
  }, options);
}
