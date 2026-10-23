import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Code } from "./code";

/**
 * The claim that is hardest to make and easiest to check.
 *
 * Both snippets were compiled before they were pasted here, and the error text is
 * what `tsc` actually printed for the first one. `capabilities.images` is a type
 * parameter rather than a runtime flag, which is the only reason this is possible.
 */
const broken = `import { type ImageLoader } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";

const loader = new DocumentLoaderPdfJs();
new VisionStrategy({
  loader,
});`;

const fixed = `import { withRasterizer } from "docture";
import { NapiCanvasRasterizer } from "docture/raster/canvas";

const rasterizer = new NapiCanvasRasterizer();
new VisionStrategy({
  loader: withRasterizer(new DocumentLoaderPdfJs(), rasterizer),
});`;

const error = `Type 'PdfJsLoader' is not assignable to type 'ImageLoader'.
  The types of 'capabilities.images' are incompatible between these types.
    Type 'false' is not assignable to type 'true'.`;

export async function TypedWiring() {
  const [brokenCode, fixedCode] = await Promise.all([
    Code({ code: broken, lang: "ts" }),
    Code({ code: fixed, lang: "ts" }),
  ]);

  return (
    <section className="border-b border-fd-border">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
        <div className="reveal max-w-2xl">
          <h2 className="text-3xl leading-[1.12] font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
            A wiring mistake is a compile error.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-fd-muted-foreground">
            A strategy that needs page images will not accept a loader that cannot render
            them. You find out on the line where you wired it, not on page 200 of a run
            you are paying for.
          </p>
        </div>

        <div className="reveal mt-12 grid gap-4 xl:grid-cols-2">
          <div className="flex flex-col overflow-hidden rounded-surface border border-brand/40 bg-fd-card">
            <p className="border-b border-brand/40 bg-brand/[0.07] px-5 py-2.5 text-sm font-medium text-brand">
              Does not compile
            </p>
            {brokenCode}
            <pre className="mt-auto flex min-h-20 items-center border-t border-brand/40 bg-brand/[0.07] px-5 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-brand">
              {error}
            </pre>
          </div>

          <div className="flex flex-col overflow-hidden rounded-surface border border-fd-border bg-fd-card">
            <p className="border-b border-fd-border px-5 py-2.5 text-sm font-medium">Compiles</p>
            {fixedCode}
            <p className="mt-auto flex min-h-20 items-center border-t border-fd-border px-5 py-2.5 text-sm text-fd-muted-foreground">
              <span>
                <code className="font-mono text-[0.8125rem]">withRasterizer</code> turns{" "}
                <code className="font-mono text-[0.8125rem]">images</code> into{" "}
                <code className="font-mono text-[0.8125rem]">true</code> in the type, so the
                same call now compiles.
              </span>
            </p>
          </div>
        </div>

        <Link
          href="/docs/concepts/rasterizers"
          className="reveal group mt-8 inline-flex items-center gap-2 text-sm font-medium text-brand"
        >
          How capabilities compose
          <ArrowRight
            className="size-4 transition-transform duration-200 ease-out-quint group-hover:translate-x-0.5"
            strokeWidth={1.5}
          />
        </Link>
      </div>
    </section>
  );
}
