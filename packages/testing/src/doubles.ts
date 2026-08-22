/**
 * In-memory doubles, for testing code that CONSUMES docture without touching a
 * real PDF library or a real model.
 */

import {
  defineLoader,
  defineStrategy,
  inferForm,
  type DocumentLoader,
  type ExtractionStrategy,
  type LoadedDocument,
  type LoadedPage,
} from "@docture/core";

/** Build a `LoadedDocument` from plain page strings, with one line per newline. */
export function loadedDocument(
  pageTexts: readonly string[],
  options: { readonly loader?: string; readonly geometry?: boolean } = {},
): LoadedDocument {
  const withGeometry = options.geometry ?? true;

  const pages: LoadedPage[] = pageTexts.map((text, index) => {
    const lines = text.split("\n").map((line, i) => ({
      y: 50 + i * 14,
      height: 11,
      text: line,
      spans: [{ text: line, x: 50, y: 50 + i * 14, width: line.length * 5.5, height: 11 }],
    }));
    return {
      pageNumber: index + 1,
      width: 595,
      height: 842,
      text,
      ...(withGeometry ? { lines } : {}),
    };
  });

  return {
    pages,
    text: pageTexts.join("\f"),
    form: inferForm(pageTexts.map((t) => t.trim().length)),
    loader: options.loader ?? "in-memory",
  };
}

/**
 * A loader that returns a document you supply. Useful for testing a strategy or a
 * parser without a PDF anywhere in sight.
 */
export function inMemoryLoader(document: LoadedDocument): DocumentLoader {
  return defineLoader({
    name: document.loader,
    capabilities: {
      text: true,
      geometry: document.pages.some((p) => (p.lines?.length ?? 0) > 0),
      images: false,
      mimeTypes: ["*/*"],
    },
    async load(_raw, ctx) {
      ctx.signal.throwIfAborted();
      return document;
    },
  });
}

/** A strategy that returns fixed data. Stands in for a model with no API call. */
export function fixedStrategy(name: string, data: unknown): ExtractionStrategy {
  return defineStrategy({
    name,
    async extract(ctx) {
      ctx.signal.throwIfAborted();
      return { data };
    },
  });
}

/** A strategy that always throws — for exercising fallback. */
export function failingStrategy(name: string, message = "strategy failed"): ExtractionStrategy {
  return defineStrategy({
    name,
    async extract() {
      throw new Error(message);
    },
  });
}
