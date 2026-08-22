/**
 * In-memory doubles for core's own tests.
 *
 * Deliberately local rather than imported from `@docture/testing`: that package
 * depends on core, and core's tests depending on it back would be a cycle. It also
 * proves the point that a loader is just an object — every fake here is one.
 */

import { defineLoader, type DocumentLoader, type LoaderCapabilities } from "../src/index.js";
import type {
  ExtractionStrategy,
  LoadedDocument,
  LoadedPage,
  StrategyContext,
  StrategyOutcome,
  Classifier,
  ClassificationSignal,
  Splitter,
} from "../src/index.js";

/**
 * Block until aborted — checking `aborted` FIRST, because a signal that fired
 * before we subscribed never fires again. A real engine has to get this right too.
 */
function hangUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

export function page(pageNumber: number, text: string, withLines = true): LoadedPage {
  const lines = text.split("\n").map((line, i) => ({
    y: 40 + i * 12,
    height: 10,
    text: line,
    spans: [{ text: line, x: 40, y: 40 + i * 12, width: line.length * 5, height: 10 }],
  }));
  return {
    pageNumber,
    width: 595,
    height: 842,
    text,
    ...(withLines ? { lines } : {}),
  };
}

export function doc(text: string, options: { lines?: boolean; loader?: string } = {}): LoadedDocument {
  const pages = [page(1, text, options.lines ?? true)];
  return {
    pages,
    text,
    form: text.trim().length > 0 ? "digital" : "scanned",
    loader: options.loader ?? "fake",
  };
}

export interface FakeLoaderOptions {
  readonly name?: string;
  readonly mimeTypes?: readonly string[];
  readonly geometry?: boolean;
  readonly images?: boolean;
  readonly document?: LoadedDocument;
  /** Throw instead of loading, to exercise loader fallback. */
  readonly fail?: string;
  /** Never settle, to exercise deadlines. */
  readonly hang?: boolean;
  readonly onDispose?: () => void | Promise<void>;
}

export function fakeLoader(options: FakeLoaderOptions = {}): DocumentLoader {
  const name = options.name ?? "fake";
  const capabilities: LoaderCapabilities = {
    text: true,
    geometry: options.geometry ?? true,
    images: options.images ?? false,
    mimeTypes: options.mimeTypes ?? ["application/pdf"],
  };
  return {
    name,
    capabilities,
    async load(_document, ctx) {
      if (options.fail !== undefined) throw new Error(options.fail);
      if (options.hang === true) {
        await hangUntilAborted(ctx.signal);
      }
      return options.document ?? doc("HELLO WORLD this is a document with plenty of text in it");
    },
    ...(options.onDispose === undefined
      ? {}
      : {
          async dispose() {
            await options.onDispose?.();
          },
        }),
  };
}

/** A loader with `geometry: false` pinned as a literal — for the capability test. */
export const textOnlyLoader = defineLoader({
  name: "text-only",
  capabilities: {
    text: true,
    geometry: false,
    images: false,
    mimeTypes: ["application/pdf"],
  },
  async load() {
    return doc("just text, no boxes, but certainly more than fifty characters of it");
  },
});

/** A loader with `geometry: true` pinned as a literal. */
export const geometryCapableLoader = defineLoader({
  name: "geometry-capable",
  capabilities: {
    text: true,
    geometry: true,
    images: false,
    mimeTypes: ["application/pdf"],
  },
  async load() {
    return doc("text with boxes, and more than fifty characters of it as well");
  },
});

export interface FakeStrategyOptions {
  readonly name?: string;
  readonly data?: unknown;
  readonly fail?: string;
  readonly hang?: boolean;
  readonly requires?: readonly string[];
  readonly needsClassification?: "required" | "hint" | "none";
  readonly usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  readonly onExtract?: (ctx: StrategyContext) => void;
  readonly onDispose?: () => void | Promise<void>;
}

export function fakeStrategy(options: FakeStrategyOptions = {}): ExtractionStrategy {
  return {
    name: options.name ?? "fake-strategy",
    ...(options.requires === undefined ? {} : { requires: options.requires }),
    ...(options.needsClassification === undefined
      ? {}
      : { needsClassification: options.needsClassification }),
    async extract(ctx): Promise<StrategyOutcome> {
      options.onExtract?.(ctx);
      if (options.fail !== undefined) throw new Error(options.fail);
      if (options.hang === true) {
        await hangUntilAborted(ctx.signal);
      }
      return {
        data: options.data ?? { value: "ok" },
        ...(options.usage === undefined ? {} : { usage: options.usage }),
      };
    },
    ...(options.onDispose === undefined
      ? {}
      : {
          async dispose() {
            await options.onDispose?.();
          },
        }),
  };
}

export function fakeClassifier(
  name: string,
  verdict: ClassificationSignal | null | "throw",
): Classifier {
  return {
    name,
    async classify() {
      if (verdict === "throw") throw new Error("classifier exploded");
      return verdict;
    },
  };
}

/** Minimal valid PDF bytes — enough for the mime sniffer, not for a real parser. */
export const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);

export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** A document of several pages, each with its own text. For split tests. */
export function multiPageDoc(texts: readonly string[], loader = "fake"): LoadedDocument {
  const pages = texts.map((text, i) => page(i + 1, text));
  return {
    pages,
    text: pages.map((p) => p.text).join("\f"),
    form: "digital",
    loader,
  };
}

/** Pages that can render, so an image-requiring splitter is eligible. */
export function renderableDoc(texts: readonly string[]): LoadedDocument {
  const base = multiPageDoc(texts);
  return {
    ...base,
    pages: base.pages.map((p) => ({
      ...p,
      image: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, p.pageNumber]),
    })),
  };
}

export interface FakeSplitterOptions {
  readonly name?: string;
  readonly requires?: readonly string[];
  /**
   * One entry per SEAM, so `n` pages take `n-1`. `true` means "same document".
   * Used by the LAZY path.
   */
  readonly seams?: readonly boolean[];
  /** What page N is called. Defaults to the first classification's name. */
  readonly classify?: (pageNumber: number) => string;
  /** Answer EAGER directly. Absent, eager degrades to lazy — which is the contract. */
  readonly eager?: readonly { pages: readonly number[]; classification: string }[];
  /** Tokens to report per request, so cost accounting can be asserted. */
  readonly tokensPerCall?: number;
  readonly onSeam?: (a: number, b: number) => void;
}

export function fakeSplitter(options: FakeSplitterOptions = {}): Splitter {
  const seams = options.seams ?? [];
  return {
    name: options.name ?? "fake-splitter",
    ...(options.requires === undefined ? {} : { requires: options.requires }),

    async belongsToSameDocument(first, second, ctx) {
      options.onSeam?.(first.pageNumber, second.pageNumber);
      if (options.tokensPerCall !== undefined) {
        ctx.recordUsage?.({
          inputTokens: options.tokensPerCall,
          outputTokens: 1,
          totalTokens: options.tokensPerCall + 1,
        });
      }
      const fallback = ctx.classifications[0]?.name ?? "UNKNOWN";
      const name = options.classify ?? ((): string => fallback);
      return {
        belongsToSameDocument: seams[first.pageNumber - 1] ?? true,
        classificationPage1: name(first.pageNumber),
        classificationPage2: name(second.pageNumber),
        confidence: 0.9,
      };
    },

    ...(options.eager === undefined
      ? {}
      : {
          async splitEager(_pages, ctx) {
            if (options.tokensPerCall !== undefined) {
              ctx.recordUsage?.({
                inputTokens: options.tokensPerCall,
                outputTokens: 1,
                totalTokens: options.tokensPerCall + 1,
              });
            }
            return options.eager ?? [];
          },
        }),
  };
}
