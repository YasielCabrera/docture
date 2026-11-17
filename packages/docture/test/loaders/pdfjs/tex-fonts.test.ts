import { describe, expect, it } from "vitest";
import { silentLogger } from "docture";
import { DocumentLoaderPdfJs } from "../../../src/loaders/pdfjs/index.js";
import { rawPdf, stream } from "./raw-pdf.js";

const layout = { signal: new AbortController().signal, logger: silentLogger, request: { layout: true } };

const fonts = ["CMR10", "CMBX10", "CMBXTI10", "CMMIB10", "CMSSI10", "CMITT10", "SFBI1000", "ECSX1000", "CMBR10"];

describe("DocumentLoaderPdfJs TeX font names", () => {
  it("reads bold and italic from the style code in the family name", async () => {
    const content = fonts.map((_font, index) => `BT /F${index} 12 Tf 20 ${280 - index * 20} Td (Word${index}) Tj ET`).join("\n");
    const resources = fonts.map((_font, index) => `/F${index} ${5 + index} 0 R`).join(" ");
    const bytes = rawPdf(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << ${resources} >> >> /Contents 4 0 R >>`,
      [stream("", content), ...fonts.map((font) => `<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`)],
    );
    const document = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, layout);
    const styles = Object.fromEntries(document.pages.flatMap((page) => page.lines ?? []).flatMap((line) => line.spans)
      .map((span) => [fonts[Number(span.text.replace("Word", ""))], `${span.style?.bold === true ? "b" : ""}${span.style?.italic === true ? "i" : ""}`]));
    expect(styles).toEqual({
      CMR10: "", CMBX10: "b", CMBXTI10: "bi", CMMIB10: "bi", CMSSI10: "i", CMITT10: "i", SFBI1000: "bi", ECSX1000: "b", CMBR10: "",
    });
  });
});
