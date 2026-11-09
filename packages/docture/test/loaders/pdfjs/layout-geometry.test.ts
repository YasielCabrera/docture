import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { silentLogger, type LoadedDocument } from "docture";
import { DocumentLoaderMuPdf } from "../../../src/loaders/mupdf/index.js";
import { DocumentLoaderPdfJs } from "../../../src/loaders/pdfjs/index.js";

const layout = { signal: new AbortController().signal, logger: silentLogger, request: { layout: true } };

function pdfkit(draw: (doc: PDFKit.PDFDocument) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [300, 300], compress: false });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    draw(doc);
    doc.end();
  });
}

const stream = (dictionary: string, body: string): string =>
  `<< ${dictionary} /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;

/** A one-page PDF from numbered objects: 1 is the catalog, 2 the page tree, 3 the page. */
function rawPdf(page: string, objects: readonly string[]): Uint8Array {
  const all = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", page, ...objects];
  let pdf = "%PDF-1.4\n";
  const offsets = all.map((object, index) => {
    const offset = Buffer.byteLength(pdf, "latin1");
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${all.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

/** A page that paints a 1x1 image through a Form XObject whose /Matrix scales by two. */
function pdfWithImageInForm(): Uint8Array {
  return rawPdf(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /XObject << /Fm1 5 0 R >> >> /Contents 4 0 R >>",
    [
      stream("", "q 1 0 0 1 50 60 cm /Fm1 Do Q"),
      stream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Matrix [2 0 0 2 0 0] /Resources << /XObject << /Im1 6 0 R >> >>", "q 20 0 0 10 5 5 cm /Im1 Do Q"),
      stream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", "\x80"),
    ],
  );
}

/** One line per font, each font named the way embedded subsets abbreviate their style. */
function pdfWithFontNames(names: readonly string[]): Uint8Array {
  const fonts = names.map((_, index) => `/F${index + 1} ${index + 5} 0 R`).join(" ");
  const content = names.map((_, index) => `BT /F${index + 1} 12 Tf 20 ${260 - index * 30} Td (Line ${index + 1}) Tj ET`).join("\n");
  return rawPdf(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << ${fonts} >> >> /Contents 4 0 R >>`,
    [stream("", content), ...names.map((name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>`)],
  );
}

const round = (value: number): number => Math.round(value);

function lines(document: LoadedDocument) {
  return document.pages.flatMap((page) => page.lines ?? []);
}

function spans(document: LoadedDocument) {
  return lines(document).flatMap((line) => line.spans);
}

describe("DocumentLoaderPdfJs layout geometry and type", () => {
  it("reads weight, slant and the real font name in layout mode, matching MuPDF", async () => {
    const bytes = await pdfkit((doc) => {
      doc.font("Helvetica-Bold").fontSize(14).text("Total due", 20, 20);
      doc.font("Times-Italic").fontSize(12).text("note", 20, 60);
      doc.font("Helvetica").fontSize(12).text("plain", 20, 100);
      doc.font("Courier").fontSize(12).text("code", 20, 140);
    });
    const style = (document: LoadedDocument) =>
      lines(document).map((line) => [
        line.text,
        line.spans.every((span) => span.style?.bold === true),
        line.spans.every((span) => span.style?.italic === true),
        line.spans.every((span) => span.style?.monospace === true),
      ]);

    const pdfjs = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, layout);
    const mupdf = await new DocumentLoaderMuPdf().load({ bytes, mimeType: "application/pdf" }, layout);

    expect(style(pdfjs)).toEqual([
      ["Total due", true, false, false],
      ["note", false, true, false],
      ["plain", false, false, false],
      ["code", false, false, true],
    ]);
    expect(spans(pdfjs).map((span) => span.style?.fontFamily)).toEqual(["Helvetica-Bold", "Times-Italic", "Helvetica", "Courier"]);
    expect(style(mupdf)).toEqual(style(pdfjs));
  });

  it("reads the abbreviated style names of embedded subsets", async () => {
    const bytes = pdfWithFontNames([
      "TUFSTC+NimbusRomNo9L-Medi",
      "IBJADS+NimbusRomNo9L-ReguItal",
      "SJISBO+NimbusRomNo9L-MediItal",
      "PVUZGU+HelveticaNeueLTStd-BdIt",
      "ZKUMQA+HelveticaNeueLTStd-BlkCn",
      "MCXSQA+ITCFranklinGothicStd-Demi",
      "OKAJSW+HelveticaNeueLTStd-Roman",
      "Arial,BoldItalic",
      "Roboto-Medium",
    ]);
    const document = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, layout);
    expect(spans(document).map((span) => [span.style?.fontFamily, span.style?.bold, span.style?.italic])).toEqual([
      ["NimbusRomNo9L-Medi", true, false],
      ["NimbusRomNo9L-ReguItal", false, true],
      ["NimbusRomNo9L-MediItal", true, true],
      ["HelveticaNeueLTStd-BdIt", true, true],
      ["HelveticaNeueLTStd-BlkCn", true, false],
      ["ITCFranklinGothicStd-Demi", true, false],
      ["HelveticaNeueLTStd-Roman", false, false],
      ["Arial-BoldItalic", true, true],
      ["Roboto-Medium", false, false],
    ]);
  });

  it("does not report weight it never loaded outside layout mode", async () => {
    const bytes = await pdfkit((doc) => doc.font("Helvetica-Bold").fontSize(14).text("Total due", 20, 20));
    const document = await new DocumentLoaderPdfJs().load(
      { bytes, mimeType: "application/pdf" },
      { signal: new AbortController().signal, logger: silentLogger },
    );
    expect(spans(document).map((span) => span.style)).toEqual([{ fontFamily: "sans-serif", monospace: false, fontSize: 14 }]);
  });

  it("gives a run rotated 90 degrees a vertical box where MuPDF puts it", async () => {
    const bytes = await pdfkit((doc) => {
      doc.save().rotate(90, { origin: [150, 150] }).font("Helvetica").fontSize(14).text("rotated run", 150, 150).restore();
    });
    const box = (document: LoadedDocument) => {
      const line = lines(document).find((candidate) => candidate.text.includes("rotated"))!;
      const left = Math.min(...line.spans.map((span) => span.x));
      const top = Math.min(...line.spans.map((span) => span.y));
      const right = Math.max(...line.spans.map((span) => span.x + span.width));
      const bottom = Math.max(...line.spans.map((span) => span.y + span.height));
      return [left, top, right - left, bottom - top].map(round);
    };

    const pdfjs = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, layout);
    const mupdf = await new DocumentLoaderMuPdf().load({ bytes, mimeType: "application/pdf" }, layout);

    // MuPDF's glyph quads include the descender; pdf.js boxes run baseline to em top.
    expect({ pdfjs: box(pdfjs), mupdf: box(mupdf) }).toEqual({ pdfjs: [140, 150, 14, 68], mupdf: [136, 150, 19, 68] });
  });

  it("reports a run that reads down the page as rotated, one line in both loaders", async () => {
    const bytes = await pdfkit((doc) => {
      doc.font("Helvetica").fontSize(10).text("Body text runs across the page.", 40, 150);
      doc.save().rotate(90, { origin: [150, 120] }).font("Helvetica").fontSize(14).text("rotated run", 150, 120).restore();
    });
    const rotated = (document: LoadedDocument) => lines(document).map((line) => [line.text, line.spans.map((span) => span.rotation)]);

    const pdfjs = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, layout);
    const mupdf = await new DocumentLoaderMuPdf().load({ bytes, mimeType: "application/pdf" }, layout);

    expect(rotated(pdfjs)).toEqual([["rotated run", [-90]], ["Body text runs across the page.", [undefined]]]);
    expect(rotated(mupdf)).toEqual([
      ["rotated run", [-90, -90]],
      ["Body text runs across the page.", [undefined, undefined, undefined, undefined, undefined, undefined]],
    ]);
  });

  it("places an image painted inside a Form XObject through the form's matrix", async () => {
    const bytes = pdfWithImageInForm();
    const images = (document: LoadedDocument) =>
      (document.pages[0]!.blocks ?? [])
        .filter((block) => block.kind === "image")
        .map((block) => [block.x, block.y, block.width, block.height].map(round));

    const pdfjs = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, layout);
    const mupdf = await new DocumentLoaderMuPdf().load({ bytes, mimeType: "application/pdf" }, layout);

    expect(images(pdfjs)).toEqual([[60, 210, 40, 20]]);
    expect(images(mupdf)).toEqual([[60, 210, 40, 20]]);
  });
});
