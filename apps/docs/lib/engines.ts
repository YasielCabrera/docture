export interface Engine {
  readonly name: string;
  readonly specifier: `docture/${string}` | `@docture/${string}`;
  readonly note?: string;
}

export interface EngineGroup {
  readonly title: string;
  readonly note?: string;
  readonly engines: readonly Engine[];
}

/** The integrations the home page lists, by the import a reader would write. */
export const engineGroups: readonly EngineGroup[] = [
  {
    title: "Read the document",
    engines: [
      { name: "PDF.js", specifier: "docture/loaders/pdfjs", note: "text layer" },
      { name: "MuPDF", specifier: "docture/loaders/mupdf", note: "text and render" },
      { name: "Tesseract", specifier: "docture/loaders/tesseract", note: "OCR" },
      { name: "PaddleOCR", specifier: "docture/loaders/paddleocr", note: "OCR" },
      { name: "Azure Document Intelligence", specifier: "docture/loaders/azure-di", note: "cloud OCR" },
      { name: "Docling", specifier: "docture/loaders/docling", note: "layout" },
      { name: "Mammoth", specifier: "docture/loaders/mammoth", note: "Word files" },
    ],
  },
  {
    title: "Understand it",
    note: "Runs on any AI SDK provider: OpenAI, Anthropic, Google, and the rest.",
    engines: [
      { name: "Text extraction", specifier: "docture/llm/text" },
      { name: "Vision", specifier: "docture/llm/vision" },
      { name: "Layout", specifier: "docture/llm/layout" },
      { name: "Classifier", specifier: "docture/llm/classifier" },
      { name: "Splitter", specifier: "docture/llm/split" },
    ],
  },
  {
    title: "Move it in and out",
    engines: [
      { name: "Email", specifier: "docture/inputs/email", note: ".eml files" },
      { name: "Paperless-ngx", specifier: "docture/sources/paperless", note: "read" },
      { name: "Paperless-ngx", specifier: "docture/sinks/paperless", note: "write back" },
      { name: "Docling import", specifier: "docture/import/docling" },
      { name: "MCP server", specifier: "@docture/cli" },
    ],
  },
];
