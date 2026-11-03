---
"docture": minor
---

Convert scanned PDFs to Markdown with a vision model. `llmOcr()` from `docture/llm/ocr` renders each page with a rasterizer and asks an AI SDK model for its headings, paragraphs, lists, tables, and code, which conversion exports as they are. It works on its own or as the OCR loader of `withOcrFallback`. A page whose answer does not fit the layout schema fails with `MODEL_OUTPUT_FAILED` naming the page.

Test model layout and model OCR without a provider. `docture/testing/llm` exports `mockLayoutModel()` and `mockOcrModel()`, which answer with the annotations or page elements you give. The entry has no runtime imports, so `docture/testing/doubles` still needs no model packages.
