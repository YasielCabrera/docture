export const stream = (dictionary: string, body: string): string =>
  `<< ${dictionary} /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;

/** A one-page PDF from numbered objects: 1 is the catalog, 2 the page tree, 3 the page. */
export function rawPdf(page: string, objects: readonly string[]): Uint8Array {
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
