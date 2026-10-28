import { gitConfig } from "@/lib/shared";

/**
 * The claims this project makes that are checkable, next to the thing that checks
 * them.
 *
 * A marketing page can assert "interchangeable loaders" and nobody can tell. Here
 * each line names the file that would fail if it stopped being true, and the file
 * is a link, so the assertion costs the reader one click to disprove. That is the
 * only reason this section exists; without the paths it would be three adjectives.
 */
const source = `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}`;

const receipts = [
  {
    claim: "Four loaders, one suite.",
    body: "pdf.js, MuPDF, tesseract.js and PaddleOCR each run the same conformance suite against their own class. A text layer and an OCR pass held to the same invariants is what makes swapping them an import rather than a rewrite.",
    path: "packages/docture/src/testing/conformance/loader.ts",
    span: "lg:col-span-5",
  },
  {
    claim: "core stays light.",
    body: "A test walks the import graph and fails if a PDF library, a WASM bundle, ONNX or even the AI SDK becomes reachable from core.",
    path: "packages/docture/test/core/architecture.test.ts",
    span: "lg:col-span-4",
  },
  {
    claim: "Runnable examples, including offline paths.",
    body: "Run on real invoices and a real bank statement, not on fixtures written to pass.",
    path: "apps/examples",
    span: "lg:col-span-3",
  },
];

export function Proof() {
  return (
    <section className="border-b border-fd-border">
      <div className="site-container py-20 lg:py-28">
        <h2 className="reveal max-w-[22ch] text-3xl leading-[1.12] font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
          Every claim here has a file behind it.
        </h2>

        <div className="reveal mt-12 grid gap-px overflow-hidden border-y border-fd-border bg-fd-border lg:grid-cols-12">
          {receipts.map((receipt) => (
            <div key={receipt.path} className={`bg-fd-background py-7 lg:px-7 ${receipt.span}`}>
              <h3 className="text-lg font-medium text-balance">{receipt.claim}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-fd-muted-foreground">
                {receipt.body}
              </p>
              <a
                href={`${source}/${receipt.path}`}
                className="mt-5 inline-block font-mono text-xs break-all text-brand transition-colors duration-200 hover:underline"
              >
                {receipt.path}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
