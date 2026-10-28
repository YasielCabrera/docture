import type { LoadedPage } from "../domain/geometry.js";
import { inferForm } from "../pipeline/features.js";
import { errorCodeOf } from "../pipeline/errors.js";
import { selectPages } from "../pipeline/pages.js";
import { createDisposalScope, type DisposalScope } from "./disposal.js";
import { loaderAccepts, type DocumentLoader } from "./loader.js";

export type PageOcrQuality = { readonly kind: "intentional-blank" } | { readonly kind: "text"; readonly quality: number };

export interface OcrFallbackOptions {
  /** Caller-defined quality. Explicitly identify intentional blanks to leave them untouched. */
  readonly assess: (page: LoadedPage) => PageOcrQuality;
  /** A candidate must reach this quality and improve on the original. */
  readonly threshold: number;
  /** Required strict improvement beyond the original score. Default 0. */
  readonly minimumImprovement?: number;
}

export interface OcrFallbackWarning {
  readonly pageNumber: number;
  readonly code: "OCR_FAILED" | "OCR_PAGE_MISSING" | "NO_IMPROVEMENT" | "GEOMETRY_MISMATCH" | "OCR_NOT_ELIGIBLE";
  readonly message: string;
  readonly errorCode?: string;
}

interface PageSupplier {
  readonly pageNumber: number;
  supplier: "primary" | "ocr";
  readonly originalQuality?: number;
  candidateQuality?: number;
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
 * @remarks One OCR request is made per selected low-quality page. Custom loaders may ignore page hints and read the full document. Failures and insufficient improvements retain original pages with diagnostics. Quality is caller-defined, independently of inferForm. The composition owns both loaders through a shared disposal scope.
 * @example
 * ```ts
 * import { withOcrFallback } from "docture";
 * const loader = withOcrFallback(primary, ocr, {
 *   threshold: 20,
 *   assess: page => ({ kind: "text", quality: page.text.trim().length }),
 * });
 * ```
 */
export function withOcrFallback(primary: DocumentLoader, ocr: DocumentLoader, options: OcrFallbackOptions): DocumentLoader & { dispose(scope?: DisposalScope): Promise<void> } {
  const improvement = options.minimumImprovement ?? 0;
  if (!Number.isFinite(options.threshold) || options.threshold < 0 || !Number.isFinite(improvement) || improvement < 0) throw new TypeError("OCR thresholds must be finite and nonnegative.");
  const assess = options.assess;
  const threshold = options.threshold;
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
        meta: { ...loaded.meta, ocrFallback: { primary: primary.name, ocr: ocr.name, requestedPages, pages: suppliers, warnings, primaryMs, ocrMs, totalMs: Date.now() - started, externalCost: "not-reported" } },
      };
    },
    dispose(scope = createDisposalScope()) { disposed ??= scope.dispose(primary, ocr); return disposed; },
  };
}
