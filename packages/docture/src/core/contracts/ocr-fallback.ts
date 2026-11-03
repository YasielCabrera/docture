import type { LoadedDocument, LoadedPage } from "../domain/geometry.js";
import type { OcrFallbackPage, OcrFallbackReport, OcrFallbackWarning } from "../domain/ocr-fallback.js";
import { inferForm } from "../pipeline/features.js";
import { errorCodeOf } from "../pipeline/errors.js";
import { selectPages } from "../pipeline/pages.js";
import { createDisposalScope, type DisposalScope } from "./disposal.js";
import { loaderAccepts, type DocumentLoader } from "./loader.js";

export type { OcrFallbackPage, OcrFallbackReport, OcrFallbackWarning } from "../domain/ocr-fallback.js";

export type PageOcrQuality = { readonly kind: "intentional-blank" } | { readonly kind: "text"; readonly quality: number };

export interface OcrFallbackOptions {
  /**
   * Caller-defined quality. Explicitly identify intentional blanks to leave them untouched.
   * Default {@link textLengthQuality}, which cannot tell an intentional blank from a scan.
   */
  readonly assess?: (page: LoadedPage) => PageOcrQuality;
  /** Pages below this quality go to OCR, and a candidate must reach it and improve on the original. Default {@link DEFAULT_OCR_THRESHOLD}. */
  readonly threshold?: number;
  /** Required strict improvement beyond the original score. Default 0. */
  readonly minimumImprovement?: number;
}

/** Scores a page by its trimmed text length, so a page with an empty or near-empty text layer goes to OCR. */
export function textLengthQuality(page: LoadedPage): PageOcrQuality {
  return { kind: "text", quality: page.text.trim().length };
}

/** Pages with fewer than 20 characters of trimmed text go to OCR under {@link textLengthQuality}. */
export const DEFAULT_OCR_THRESHOLD = 20;

type PageSupplier = { -readonly [K in keyof OcrFallbackPage]: OcrFallbackPage[K] };

/** The report `withOcrFallback` stores in `meta.ocrFallback`, when the document has one. */
export function ocrFallbackReport(document: LoadedDocument): OcrFallbackReport | undefined {
  const report = document.meta?.["ocrFallback"];
  if (typeof report !== "object" || report === null) return undefined;
  const candidate = report as Partial<OcrFallbackReport>;
  return Array.isArray(candidate.pages) && Array.isArray(candidate.warnings) && Array.isArray(candidate.requestedPages)
    ? report as OcrFallbackReport
    : undefined;
}

function quality(value: PageOcrQuality): PageOcrQuality {
  if (value.kind === "text" && (!Number.isFinite(value.quality) || value.quality < 0)) throw new TypeError("OCR page quality must be finite and nonnegative.");
  return value;
}

function physicalMismatch(original: LoadedPage, candidate: LoadedPage): boolean {
  return original.width > 0 && original.height > 0 && candidate.width > 0 && candidate.height > 0
    && (Math.abs(original.width - candidate.width) > 1 || Math.abs(original.height - candidate.height) > 1);
}

/**
 * Explicitly reread low-quality pages with a caller-selected OCR loader.
 *
 * @remarks One OCR request is made per selected low-quality page. Custom loaders may ignore page hints and read the full document. Failures and insufficient improvements retain original pages with diagnostics. Quality defaults to trimmed text length against a threshold of 20, independently of inferForm; pass `assess` to keep intentional blanks. The composition owns both loaders through a shared disposal scope.
 * The loaded document's `meta.ocrFallback` holds an {@link OcrFallbackReport}, which `DocumentConverter` exposes as `ConversionResult.ocrFallback`.
 * @example
 * ```ts
 * import { textLengthQuality, withOcrFallback } from "docture";
 * const loader = withOcrFallback(primary, ocr);
 * const strict = withOcrFallback(primary, ocr, {
 *   threshold: 40,
 *   assess: page => page.pageNumber === 2 ? { kind: "intentional-blank" } : textLengthQuality(page),
 * });
 * ```
 */
export function withOcrFallback(primary: DocumentLoader, ocr: DocumentLoader, options: OcrFallbackOptions = {}): DocumentLoader & { dispose(scope?: DisposalScope): Promise<void> } {
  const improvement = options.minimumImprovement ?? 0;
  const threshold = options.threshold ?? DEFAULT_OCR_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || !Number.isFinite(improvement) || improvement < 0) throw new TypeError("OCR thresholds must be finite and nonnegative.");
  const assess = options.assess ?? textLengthQuality;
  let disposed: Promise<void> | undefined;
  const name = `${primary.name}+ocr:${ocr.name}`;
  return {
    name,
    capabilities: {
      text: primary.capabilities.text || ocr.capabilities.text,
      geometry: primary.capabilities.geometry || ocr.capabilities.geometry,
      images: primary.capabilities.images,
      mimeTypes: [...primary.capabilities.mimeTypes],
      facts: primary.capabilities.facts?.filter((fact) => ocr.capabilities.facts?.includes(fact)) ?? [],
    },
    async load(document, ctx) {
      disposed = undefined;
      ctx.signal.throwIfAborted();
      const started = Date.now();
      const read = await primary.load(document, ctx);
      ctx.signal.throwIfAborted();
      const loaded = ctx.request?.pages === undefined ? read : selectPages(read, ctx.request.pages);
      const primaryMs = Date.now() - started;
      const requestedPages: number[] = [];
      const warnings: OcrFallbackWarning[] = [];
      const suppliers: PageSupplier[] = [];
      const pages: LoadedPage[] = [];
      let ocrMs = 0;
      for (const original of [...loaded.pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
        ctx.signal.throwIfAborted();
        const originalQuality = quality(assess(original));
        const supplier: PageSupplier = { pageNumber: original.pageNumber, supplier: "primary", ...(originalQuality.kind === "text" ? { originalQuality: originalQuality.quality } : {}) };
        suppliers.push(supplier);
        let kept = original;
        if (originalQuality.kind === "text" && originalQuality.quality < threshold) {
          const warn = (code: OcrFallbackWarning["code"], message: string, errorCode?: string) => warnings.push({ pageNumber: original.pageNumber, code, message, ...(errorCode === undefined ? {} : { errorCode }) });
          if (!loaderAccepts(ocr, document.mimeType ?? "application/octet-stream")) {
            warn("OCR_NOT_ELIGIBLE", "OCR loader does not accept the source media type; original page retained.");
          } else {
            requestedPages.push(original.pageNumber);
            const before = Date.now();
            try {
              const recognized = await ocr.load(document, { ...ctx, request: { ...ctx.request, pages: [original.pageNumber] } });
              ctx.signal.throwIfAborted();
              const candidate = recognized.pages.find((page) => page.pageNumber === original.pageNumber);
              if (candidate === undefined) warn("OCR_PAGE_MISSING", "OCR returned no matching original page; original page retained.");
              else if (physicalMismatch(original, candidate)) warn("GEOMETRY_MISMATCH", "OCR dimensions differ from the original page; original page retained.");
              else {
                const candidateQuality = quality(assess(candidate));
                if (candidateQuality.kind === "text" && candidateQuality.quality >= threshold && candidateQuality.quality > originalQuality.quality + improvement) {
                  supplier.supplier = "ocr";
                  supplier.candidateQuality = candidateQuality.quality;
                  kept = {
                    ...candidate,
                    pageNumber: original.pageNumber,
                    width: original.width > 0 ? original.width : candidate.width,
                    height: original.height > 0 ? original.height : candidate.height,
                    ...(candidate.image !== undefined ? { image: candidate.image } : original.image === undefined ? {} : { image: original.image }),
                  };
                } else warn("NO_IMPROVEMENT", "OCR did not meet the configured quality improvement; original page retained.");
              }
            } catch (error) {
              ctx.signal.throwIfAborted();
              warn("OCR_FAILED", "OCR failed for this page; original page retained.", errorCodeOf(error));
            } finally { ocrMs += Date.now() - before; }
          }
        }
        pages.push(kept);
      }
      for (const warning of warnings) ctx.logger.warn("OCR fallback retained original page", { pageNumber: warning.pageNumber, code: warning.code, ...(warning.errorCode === undefined ? {} : { errorCode: warning.errorCode }) });
      return {
        ...loaded, pages, text: pages.map((page) => page.text).join("\f"), form: inferForm(pages.map((page) => page.text.trim().length)), loader: name,
        meta: { ...loaded.meta, ocrFallback: { primary: primary.name, ocr: ocr.name, requestedPages, pages: suppliers, warnings, primaryMs, ocrMs, totalMs: Date.now() - started, externalCost: "not-reported" } satisfies OcrFallbackReport },
      };
    },
    dispose(scope = createDisposalScope()) { disposed ??= scope.dispose(primary, ocr); return disposed; },
  };
}
