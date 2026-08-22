import Link from "next/link";

interface CatalogueEntry {
  readonly name: string;
  readonly role: string;
  readonly description: string;
}

interface Category {
  readonly name: string;
  readonly job: string;
  readonly href: string;
  readonly columns: 2 | 3;
  readonly entries: readonly CatalogueEntry[];
}

/**
 * The concrete choices and extension hooks behind the five pipeline seams.
 *
 * This is deliberately a catalogue rather than a set of illustrations: the useful
 * comparison is which exported APIs fill each role, not what a PDF looks like.
 */
const categories: readonly Category[] = [
  {
    name: "Loader",
    job: "Turn bytes into pages of text, geometry, or OCR.",
    href: "/docs/concepts/loaders",
    columns: 3,
    entries: [
      {
        name: "DocumentLoaderPdfJs",
        role: "text + geometry",
        description: "Read PDF text with PDF.js.",
      },
      {
        name: "DocumentLoaderMuPdf",
        role: "text + geometry",
        description: "Read PDF text with MuPDF.",
      },
      {
        name: "DocumentLoaderTesseract",
        role: "OCR",
        description: "Recognize scanned pages in WASM.",
      },
      {
        name: "DocumentLoaderPaddleOcr",
        role: "OCR",
        description: "Recognize scanned pages with ONNX.",
      },
      {
        name: "DocumentLoaderData",
        role: "preloaded",
        description: "Start from document data already in memory.",
      },
      {
        name: "defineLoader",
        role: "extension",
        description: "Add a typed source adapter of your own.",
      },
    ],
  },
  {
    name: "Strategy",
    job: "Turn loaded pages into data that satisfies your contract.",
    href: "/docs/concepts/strategies",
    columns: 3,
    entries: [
      {
        name: "LlmStrategy",
        role: "text",
        description: "Extract from the document text with a model.",
      },
      {
        name: "VisionStrategy",
        role: "images",
        description: "Extract from rendered pages with a vision model.",
      },
      {
        name: "defineStrategy",
        role: "extension",
        description: "Add deterministic or custom extraction logic.",
      },
    ],
  },
  {
    name: "Rasterizer",
    job: "Give any compatible loader lazy page images.",
    href: "/docs/concepts/rasterizers",
    columns: 2,
    entries: [
      {
        name: "NapiCanvasRasterizer",
        role: "native canvas",
        description: "Render PDF.js pages onto a native canvas.",
      },
      {
        name: "MuPdfRasterizer",
        role: "WASM",
        description: "Render and encode pages inside MuPDF.",
      },
      {
        name: "withRasterizer",
        role: "composition",
        description: "Add image capability to an existing loader.",
      },
      {
        name: "defineRasterizer",
        role: "extension",
        description: "Wrap another rendering engine behind the contract.",
      },
    ],
  },
  {
    name: "Classifier",
    job: "Choose a document kind and the contract that goes with it.",
    href: "/docs/concepts/classification",
    columns: 2,
    entries: [
      {
        name: "LlmClassifier",
        role: "model",
        description: "Choose from candidates using a text excerpt.",
      },
      {
        name: "defineClassifier",
        role: "extension",
        description: "Add deterministic classification rules.",
      },
      {
        name: "classificationTree",
        role: "routing",
        description: "Route through typed families of document kinds.",
      },
      {
        name: "defineClassification",
        role: "declaration",
        description: "Bind a document kind to its own schema.",
      },
    ],
  },
  {
    name: "Splitter",
    job: "Cut one multi-document file into typed page groups.",
    href: "/docs/concepts/bundles-and-splitters",
    columns: 2,
    entries: [
      {
        name: "TextSplitter",
        role: "text",
        description: "Find boundaries from adjacent page text.",
      },
      {
        name: "ImageSplitter",
        role: "images",
        description: "Find boundaries from rendered page images.",
      },
      {
        name: "defineSplitter",
        role: "extension",
        description: "Add custom page-boundary logic.",
      },
      {
        name: "runSplitter",
        role: "runner",
        description: "Execute any splitter outside the process builder.",
      },
    ],
  },
];

export function Pieces() {
  return (
    <section aria-labelledby="pieces-heading" className="border-b border-fd-border">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
        <div className="max-w-2xl">
          <h2
            id="pieces-heading"
            className="max-w-[14ch] text-4xl leading-[1.08] font-semibold tracking-[-0.03em] text-balance sm:text-5xl"
          >
            Five extension points. Pick what fills them.
          </h2>
          <p className="mt-5 max-w-[60ch] text-base leading-relaxed text-fd-muted-foreground">
            Use a shipped implementation, compose two together, or implement the contract. The
            rest of the pipeline stays unchanged.
          </p>
        </div>

        <ol className="mt-14 divide-y divide-fd-border border-y border-fd-border lg:mt-16">
          {categories.map((category) => (
            <li
              key={category.name}
              className="grid gap-8 py-10 lg:grid-cols-12 lg:gap-10 lg:py-12"
            >
              <div className="lg:col-span-3 lg:pr-6">
                <h3 className="text-2xl leading-tight font-medium tracking-[-0.02em]">
                  <Link
                    href={category.href}
                    className="inline-block rounded-control underline decoration-fd-border decoration-1 underline-offset-[0.35em] transition-[color,text-decoration-color,transform] duration-200 ease-out-quint hover:text-brand hover:decoration-brand focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-4 active:scale-[0.98]"
                  >
                    {category.name}
                  </Link>
                </h3>
                <p className="mt-3 max-w-[28ch] text-sm leading-relaxed text-fd-muted-foreground">
                  {category.job}
                </p>
              </div>

              <ul
                className={`grid min-w-0 gap-x-10 gap-y-7 lg:col-span-9 ${
                  category.columns === 3
                    ? "sm:grid-cols-2 xl:grid-cols-3"
                    : "sm:grid-cols-2"
                }`}
              >
                {category.entries.map((entry) => (
                  <li key={entry.name} className="min-w-0 border-l border-fd-border pl-4">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <code className="font-mono text-[0.8125rem] leading-relaxed font-medium text-brand [overflow-wrap:anywhere]">
                        {entry.name}
                      </code>
                      <span className="text-xs text-fd-muted-foreground">{entry.role}</span>
                    </div>
                    <p className="mt-2 max-w-[36ch] text-sm leading-relaxed text-fd-muted-foreground">
                      {entry.description}
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
