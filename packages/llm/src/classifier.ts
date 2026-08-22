/**
 * `LlmClassifier` — decide a document's kind with a model.
 *
 * Cheap by construction: it sends a text excerpt, not the whole document, and asks
 * for a name and a confidence rather than the full extraction. Classifying with the
 * same budget as extracting would defeat the purpose of classifying at all.
 *
 * Honours the classifier contract: it never throws. A model outage, a refusal, or a
 * name that is not one of the candidates all become abstentions, because a broken
 * classifier must not fail a document that the UNKNOWN path could still handle.
 */

import { generateObject, type LanguageModel } from "ai";
import { z } from "zod/v4";
import {
  type ClassificationSignal,
  type Classifier,
  type ClassifyContext,
} from "@docture/core";
import { modelIdOf } from "./strategy.js";
import { cacheKey, type LlmCache } from "./cache.js";

export interface LlmClassifierOptions {
  readonly model: LanguageModel;
  readonly name?: string;
  /** Characters of document text to send. Default 4000 — the front matter decides it. */
  readonly excerptChars?: number;
  readonly cache?: LlmCache;
  readonly temperature?: number;
  readonly maxRetries?: number;
}

const verdictSchema = z.object({
  name: z.string().describe('The matching document type name, or "UNKNOWN" if none fit.'),
  confidence: z.number().min(0).max(1).describe("How certain you are, 0 to 1."),
  reason: z.string().describe("One short sentence of evidence from the document."),
});

export class LlmClassifier implements Classifier {
  readonly name: string;
  readonly requires = ["TEXT_LAYER"] as const;

  constructor(private readonly options: LlmClassifierOptions) {
    this.name = options.name ?? "llm-classifier";
  }

  async classify(ctx: ClassifyContext): Promise<ClassificationSignal | null> {
    if (ctx.candidates.length === 0) return null;

    const excerpt = ctx.document.text.slice(0, this.options.excerptChars ?? 4000);
    if (excerpt.trim() === "") return null;

    const catalogue = ctx.candidates
      .map((candidate) => `- ${candidate.name}: ${candidate.description}`)
      .join("\n");

    const system = [
      "You identify what kind of document you are looking at.",
      "Choose exactly one name from the list, or UNKNOWN if none of them fit.",
      "Judge only on evidence in the excerpt. Do not guess to be helpful:",
      "a wrong confident answer is worse than UNKNOWN.",
    ].join("\n");

    const prompt = [
      "Document types:",
      catalogue,
      "",
      "<excerpt>",
      excerpt,
      "</excerpt>",
    ].join("\n");

    try {
      const modelId = modelIdOf(this.options.model);
      const key = cacheKey({
        modelId,
        system,
        prompt,
        jsonSchema: { classify: ctx.candidates.map((c) => c.name) },
        variant: "classify",
      });

      const cached = await this.options.cache?.get(key);
      const verdict =
        cached !== undefined
          ? (cached.data as z.infer<typeof verdictSchema>)
          : await (async () => {
              const response = await generateObject({
                model: this.options.model,
                schema: verdictSchema,
                system,
                prompt,
                temperature: this.options.temperature ?? 0,
                maxRetries: this.options.maxRetries ?? 2,
                abortSignal: ctx.signal,
              });
              await this.options.cache?.set(key, {
                data: response.object,
                usage: {
                  inputTokens: response.usage.inputTokens ?? 0,
                  outputTokens: response.usage.outputTokens ?? 0,
                  totalTokens: response.usage.totalTokens ?? 0,
                },
              });
              return response.object;
            })();

      if (verdict.name === "UNKNOWN") {
        return { classifier: this.name, name: null, confidence: 0, note: verdict.reason };
      }

      // A model that returns a name outside the candidate list has not classified —
      // it has invented. Treat it as an abstention and say so.
      const known = ctx.candidates.some((candidate) => candidate.name === verdict.name);
      if (!known) {
        return {
          classifier: this.name,
          name: null,
          confidence: 0,
          note: `returned "${verdict.name}", which is not a candidate`,
        };
      }

      return {
        classifier: this.name,
        name: verdict.name,
        confidence: verdict.confidence,
        note: verdict.reason,
      };
    } catch (error) {
      // Never throw: see the class comment.
      return {
        classifier: this.name,
        name: null,
        confidence: 0,
        note: `failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function llmClassifier(options: LlmClassifierOptions): Classifier {
  return new LlmClassifier(options);
}
