import assert from "node:assert/strict";
import { silentLogger, withOcrFallback, type DocumentLoader, type LoadedPage } from "docture";

const capabilities = { text: true, geometry: false, images: false, mimeTypes: ["application/pdf"] } as const;
const primaryPages: readonly LoadedPage[] = [
  { pageNumber: 1, width: 612, height: 792, text: "A good digital page with enough readable text." },
  { pageNumber: 2, width: 612, height: 792, text: "" },
  { pageNumber: 3, width: 612, height: 792, text: "" },
];
const requested: number[][] = [];
const primary: DocumentLoader = { name: "primary", capabilities, load: async () => ({ pages: primaryPages, text: primaryPages.map((page) => page.text).join("\f"), form: "mixed", loader: "primary" }) };
const ocr: DocumentLoader = { name: "ocr", capabilities, load: async (_raw, ctx) => {
  requested.push([...(ctx.request?.pages ?? [])]);
  const page = { pageNumber: 2, width: 612, height: 792, text: "A scanned page recovered by the configured OCR loader." };
  return { pages: [page], text: page.text, form: "digital", loader: "ocr" };
} };
const loader = withOcrFallback(primary, ocr, {
  threshold: 20,
  assess: (page) => page.pageNumber === 3 ? { kind: "intentional-blank" } : { kind: "text", quality: page.text.trim().length },
});
try {
  const document = await loader.load({ bytes: new TextEncoder().encode("%PDF-mock"), mimeType: "application/pdf" }, { signal: new AbortController().signal, logger: silentLogger });
  assert.deepEqual(requested, [[2]]);
  assert.equal(document.pages[0], primaryPages[0]);
  assert.equal(document.pages[2], primaryPages[2]);
  assert.match(document.pages[1]?.text ?? "", /recovered/);
  console.log("Selected-page OCR preserved digital text and the intentional blank.");
} finally {
  await loader.dispose();
}
