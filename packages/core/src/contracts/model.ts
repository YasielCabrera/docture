/**
 * What core needs from a model, without knowing what a model is.
 *
 * `@docture/core` does not depend on the AI SDK — a deterministic pipeline should
 * not install a model client, and an
 * [architecture test](../../test/architecture.test.ts) enforces it. But
 * `extractor.loadLlm(…)` is the line everyone writes first, so core needs SOME way
 * to accept a model.
 *
 * This is that seam. A `ModelBackend` knows how to turn itself into the strategies
 * core already understands; `@docture/llm`'s `LLM` class is the implementation, and
 * the AI SDK stays on that side of the line.
 *
 * ```ts
 * import { Extractor } from "@docture/core";
 * import { LLM } from "@docture/llm";
 * import { openai } from "@ai-sdk/openai";
 *
 * new Extractor()
 *   .loadDocumentLoader(new DocumentLoaderPdfJs())
 *   .loadLlm(new LLM(openai("gpt-5")));
 * ```
 */

import type { Classifier } from "./classifier.js";
import type { Splitter } from "./splitter.js";
import type { ExtractionStrategy } from "./strategy.js";

export interface ModelBackend {
  /** Model id, e.g. `"openai/gpt-5"`. Appears in cache keys and reports. */
  readonly id: string;
  /** The default extraction strategy: send the text, get the object. */
  extraction(): ExtractionStrategy;
  /**
   * A strategy that sends page images instead of text. Absent on a backend with no
   * vision, which is why `loadLlm({ vision: true })` can fail at the wiring line
   * rather than on the first scanned page.
   */
  vision?(): ExtractionStrategy;
  /** A classifier driven by this model. */
  classifier?(): Classifier;
  /** A splitter driven by this model, for `Process`. */
  splitter?(): Splitter;
}

export interface LoadLlmOptions {
  /**
   * Also register the vision strategy, for documents with no text layer. Needs a
   * loader that can render pages — see `withRasterizer`.
   */
  readonly vision?: boolean;
  /** Also register a model-driven classifier, so `classifications` get decided. */
  readonly classify?: boolean;
}
