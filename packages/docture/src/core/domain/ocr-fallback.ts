/** Diagnostics of a `withOcrFallback` load, carried from the loaded document to `ConversionResult.ocrFallback`. */

export interface OcrFallbackWarning {
  readonly pageNumber: number;
  readonly code: "OCR_FAILED" | "OCR_PAGE_MISSING" | "NO_IMPROVEMENT" | "GEOMETRY_MISMATCH" | "OCR_NOT_ELIGIBLE";
  readonly message: string;
  readonly errorCode?: string;
}

/** Which loader supplied one page, with the qualities that decided it. */
export interface OcrFallbackPage {
  readonly pageNumber: number;
  readonly supplier: "primary" | "ocr";
  /** Absent for an intentional blank. */
  readonly originalQuality?: number;
  /** Present when the OCR page replaced the original. */
  readonly candidateQuality?: number;
}

/** What one `withOcrFallback` load did, page by page. Times are in ms. */
export interface OcrFallbackReport {
  readonly primary: string;
  readonly ocr: string;
  /** Pages sent to the OCR loader, in page order. */
  readonly requestedPages: readonly number[];
  readonly pages: readonly OcrFallbackPage[];
  readonly warnings: readonly OcrFallbackWarning[];
  readonly primaryMs: number;
  readonly ocrMs: number;
  readonly totalMs: number;
  readonly externalCost: "not-reported";
}
