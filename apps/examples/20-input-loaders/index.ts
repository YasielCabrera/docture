import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DocumentLoaderData } from "docture";
import { DocumentConverter } from "docture/node";
import { DocumentLoaderMammoth } from "docture/loaders/mammoth";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { expandEmail } from "docture/inputs/email";
import { makeInvoicePdf } from "docture/testing/fixtures";

const docx = new Uint8Array(await readFile(new URL("../../../packages/docture/test/loaders/mammoth/fixtures/heading-paragraph-table.docx", import.meta.url)));
const converter = new DocumentConverter({ loaders: [new DocumentLoaderMammoth()] });
try {
  const result = await converter.convert({ bytes: docx, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, { format: "text" });
  assert.match(result.content, /Quarterly report[\s\S]*Revenue grew[\s\S]*North[\s\S]*42/);
  console.log("DOCX text conversion passed on one logical page.");
} finally {
  await converter.dispose();
}

const pdf = await makeInvoicePdf({ seed: 121 });
const message = new TextEncoder().encode([
  "Message-ID: <input-example@docture.test>", "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="parts"', "",
  "--parts", "Content-Type: text/html; charset=utf-8", "", "<h1>Delivery notice</h1><p>See the invoice.</p>",
  "--parts", "Content-Type: application/pdf", 'Content-Disposition: attachment; filename="invoice.pdf"', "Content-Transfer-Encoding: base64", "",
  Buffer.from(pdf.bytes).toString("base64"), "--parts--", "",
].join("\r\n"));
const expanded = await expandEmail({ bytes: message, mimeType: "message/rfc822" });
assert.equal(expanded.parts.length, 2);
const emailConverter = new DocumentConverter({ loaders: [new DocumentLoaderData(), new DocumentLoaderPdfJs()] });
try {
  const converted = await Promise.all(expanded.parts.map((part) => emailConverter.convert(part.document, { format: "text" })));
  assert.match(converted[0]?.content ?? "", /Delivery notice/);
  assert.match(converted[1]?.content ?? "", new RegExp(pdf.expected.invoiceNumber));
  assert.deepEqual(expanded.parts[1]?.document.bytes, pdf.bytes);
  console.log("Email body and PDF attachment conversion passed with source provenance.");
} finally {
  await emailConverter.dispose();
}
