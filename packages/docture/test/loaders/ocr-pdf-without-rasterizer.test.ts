import { expect, it } from "vitest";
import { z } from "zod";
import { createDocumentConverter, createExtractor, isDoctureError } from "docture";
import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";

const pdf = { bytes: new TextEncoder().encode("%PDF-1.7\n"), mimeType: "application/pdf" };

it("tells a caller how to let Tesseract read a PDF", async () => {
  const failure: unknown = await createExtractor({ loaders: [new DocumentLoaderTesseract()] })
    .extract(pdf, z.object({})).catch((error: unknown) => error);
  expect(isDoctureError(failure, "NO_ELIGIBLE_LOADER") ? { gaps: failure.gaps, message: failure.message } : failure).toEqual({
    gaps: [{
      name: "tesseract",
      reason: "pass { rasterizer } to DocumentLoaderTesseract to read PDFs, e.g. new DocumentLoaderTesseract({ rasterizer: new NapiCanvasRasterizer() })",
    }],
    message: 'No loader accepts "application/pdf". tesseract: pass { rasterizer } to DocumentLoaderTesseract to read PDFs, ' +
      'e.g. new DocumentLoaderTesseract({ rasterizer: new NapiCanvasRasterizer() }). Register a loader for "application/pdf" with loadDocumentLoader(...).',
  });
});

it("tells a caller how to let PaddleOCR read a PDF", async () => {
  const failure: unknown = await createDocumentConverter({ loaders: [new DocumentLoaderPaddleOcr()] })
    .convert(pdf).catch((error: unknown) => error);
  expect(isDoctureError(failure, "NO_ELIGIBLE_LOADER") ? failure.gaps : failure).toEqual([{
    name: "paddleocr",
    reason: "pass { rasterizer } to DocumentLoaderPaddleOcr to read PDFs, e.g. new DocumentLoaderPaddleOcr({ rasterizer: new NapiCanvasRasterizer() })",
  }]);
});
