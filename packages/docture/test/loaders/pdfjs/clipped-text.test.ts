import { describe, expect, it } from "vitest";
import { silentLogger } from "docture";
import { DocumentLoaderPdfJs } from "../../../src/loaders/pdfjs/index.js";
import { rawPdf, stream } from "./raw-pdf.js";

const layout = { signal: new AbortController().signal, logger: silentLogger, request: { layout: true } };

/**
 * A page whose content stream shows text the page never paints: overflow below a
 * frame's clip, a stale value clipped away on the same baseline as a printed line,
 * and a line placed below the page. An invisible OCR layer sits inside the clip.
 */
function pdfWithClippedText(): Uint8Array {
  const content = [
    "BT /F1 12 Tf 20 260 Td (Printed heading) Tj ET",
    "BT /F1 12 Tf 20 230 Td (Printed line that runs long) Tj ET",
    "BT /F1 12 Tf 20 -40 Td (Below the page) Tj ET",
    "q 0 0 300 150 re W n",
    "BT /F1 12 Tf 20 100 Td (Inside the frame) Tj ET",
    "BT 3 Tr /F1 12 Tf 20 40 Td (Invisible OCR layer) Tj ET",
    "BT /F1 12 Tf 20 200 Td (Overflow past the frame) Tj ET",
    "BT /F1 12 Tf 60 230 Td (STALE 09/13/2023) Tj ET",
    "Q",
  ].join("\n");
  return rawPdf(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    [stream("", content), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
  );
}

describe("DocumentLoaderPdfJs clipped text", () => {
  it("keeps text set with a negative font size, which hangs below its baseline inside the clip", async () => {
    const bytes = rawPdf(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      [stream("", "q 0 0 300 105 re W n BT /F1 -12 Tf 150 110 Td (UPSIDE DOWN TOTAL 42) Tj ET Q"), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
    );
    const document = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, layout);
    expect(document.text).toContain("UPSIDE DOWN TOTAL 42");
  });

  it("leaves out text the page clips away and keeps the text it paints", async () => {
    const document = await new DocumentLoaderPdfJs().load(
      { bytes: pdfWithClippedText(), mimeType: "application/pdf" },
      layout,
    );
    const lines = document.pages.flatMap((page) => page.lines ?? []).map((line) => line.text);

    expect(lines).toEqual([
      "Printed heading",
      "Printed line that runs long",
      "Inside the frame",
      "Invisible OCR layer",
    ]);
    const blocks = document.pages.flatMap((page) => page.blocks ?? []);
    expect(JSON.stringify(blocks)).not.toMatch(/STALE|Overflow|Below the page/u);
  });

  it("keeps visible text that pdf.js merges into one item with a clipped run beside it", async () => {
    const content = [
      "q 0 0 100 300 re W n",
      "BT /F1 12 Tf 150 200 Td (Hidden) Tj ET",
      "Q",
      "BT /F1 12 Tf 188.016 200 Td (Visible) Tj ET",
    ].join("\n");
    const bytes = rawPdf(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      [stream("", content), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
    );
    const document = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, layout);
    expect(document.pages.flatMap((page) => page.lines ?? []).map((line) => line.text).join(" ")).toContain("Visible");
  });
});
