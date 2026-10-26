import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { silentLogger } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { pngFromPdfJsImage } from "../../../src/loaders/pdfjs/png.js";

function pdfWithImage(width: number, height: number, rows: readonly (readonly number[])[]) {
  const img = Buffer.from(rows.flat());
  const content = Buffer.from(`q ${width * 10} 0 0 ${height * 10} 50 50 cm /Im1 Do Q`);
  const objs = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 1 /Length ${img.length} >>\nstream\n`), img, Buffer.from("\nendstream")]),
  ];
  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let pos = Buffer.byteLength("%PDF-1.4\n");
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from("\nendobj\n")]);
    offsets.push(pos); pos += b.length; parts.push(b);
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return new Uint8Array(Buffer.concat(parts));
}

function rowsOf(png: Uint8Array) {
  const buf = Buffer.from(png);
  let off = 8, w = 0, h = 0; const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => raw[y * (w * 4 + 1) + 1 + x * 4] === 255 ? 1 : 0));
}


it.each([
  { width: 10, expected: [[1,1,1,1,1,1,1,1,1,1], [1,0,0,0,0,0,0,0,0,0]] },
  { width: 16, expected: [[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]] },
])("decodes row-padded monochrome PDF image pixels at width $width", async ({ width, expected }) => {
  const loader = new DocumentLoaderPdfJs();
  const document = await loader.load({
    bytes: pdfWithImage(width, 2, [[0xff, width === 10 ? 0xc0 : 0xff], [0x80, 0]]),
    mimeType: "application/pdf",
  }, { signal: new AbortController().signal, logger: silentLogger, request: { layout: true, assets: true } });
  const asset = document.pages.flatMap((page) => page.assets ?? [])[0];
  expect(asset === undefined ? undefined : rowsOf(asset.bytes)).toEqual(expected);
});

it("detects row-padded monochrome data without an image kind", () => {
  const png = pngFromPdfJsImage({ width: 10, height: 2, data: new Uint8ClampedArray([0xff, 0xc0, 0x80, 0]) }, {
    GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3,
  });
  expect(png === undefined ? undefined : rowsOf(png)).toEqual([[1,1,1,1,1,1,1,1,1,1], [1,0,0,0,0,0,0,0,0,0]]);
});
