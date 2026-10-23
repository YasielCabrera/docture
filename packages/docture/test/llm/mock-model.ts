/**
 * A mock `LanguageModel` built on the AI SDK's own test double.
 *
 * Using `MockLanguageModelV4` rather than hand-rolling a fake keeps these tests
 * honest: the strategy is exercised through the real `generateObject` code path —
 * real prompt assembly, real structured-output parsing, real usage plumbing — with
 * only the network replaced.
 */

import { MockLanguageModelV4 } from "ai/test";

export interface MockCall {
  readonly prompt: unknown;
  readonly system: string | undefined;
}

export interface MockModelHandle {
  readonly model: MockLanguageModelV4;
  /** One entry per request the strategy made. */
  readonly calls: MockCall[];
}

export interface MockModelOptions {
  readonly modelId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/**
 * A model that answers with `objects` in order, cycling if asked more times than
 * there are answers. Cycling matters for `paginate`, where one answer per page is
 * tedious to spell out but the last one is fine to repeat.
 */
export function mockModel(
  objects: readonly unknown[],
  options: MockModelOptions = {},
): MockModelHandle {
  const calls: MockCall[] = [];
  let index = 0;

  const model = new MockLanguageModelV4({
    modelId: options.modelId ?? "mock-model",
    provider: "mock",
    async doGenerate(callOptions) {
      const object = objects[Math.min(index, objects.length - 1)];
      index += 1;

      // `prompt` is the normalised message array; keep it for assertions about what
      // the strategy actually sent (text vs images, one page vs all).
      calls.push({
        prompt: callOptions.prompt,
        system: undefined,
      });

      const inputTokens = options.inputTokens ?? 100;
      const outputTokens = options.outputTokens ?? 25;

      return {
        content: [{ type: "text" as const, text: JSON.stringify(object) }],
        // Provider spec v4 nests what used to be flat, in two places, and getting
        // either wrong fails quietly rather than loudly:
        //   - `finishReason` is `{ unified, raw }`, not the string `"stop"`.
        //   - `usage` is `{ inputTokens: { total, … } }`, while the PUBLIC
        //     `generateObject` result is flat (`usage.inputTokens`). The SDK maps
        //     between them, so a flat mock here reports zero tokens everywhere.
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: {
            total: inputTokens,
            noCache: inputTokens,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });

  return { model, calls };
}

/** A model that always fails, for exercising fallback. */
export function failingModel(message = "provider exploded"): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId: "failing-model",
    provider: "mock",
    async doGenerate() {
      throw new Error(message);
    },
  });
}
