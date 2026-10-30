import { Code } from "./code";
import { ArrowLink, CodeWindow, Section } from "./section";
import { engineGroups } from "@/lib/engines";

const customComponents = `import { defineLoader, defineStrategy } from "docture";
import { createExtractor } from "docture/node";

const csvLoader = defineLoader({
  name: "invoice-csv",
  capabilities: {
    text: true,
    geometry: false,
    images: false,
    mimeTypes: ["text/csv"],
  },
  async load(raw) {
    const text = new TextDecoder().decode(raw.bytes);
    const page = { pageNumber: 1, width: 0, height: 0, text };
    return { pages: [page], text, form: "digital", loader: "invoice-csv" };
  },
});

const csvInvoice = defineStrategy({
  name: "invoice-csv",
  async extract({ document }) {
    const row = document.text.trim().split("\\n").at(-1) ?? "";
    const [number, total] = row.split(",");
    return { data: { number, total: Number(total) } };
  },
});

const extractor = createExtractor({
  loaders: [csvLoader],
  strategies: [csvInvoice],
});`;

export async function Engines() {
  const customCode = await Code({ code: customComponents, lang: "ts" });

  return (
    <Section
      id="engines-heading"
      title="Use the engines you trust. Plug in the ones we do not ship."
      body="Every built-in engine is an optional peer that loads when you use its integration. Anything else becomes a loader or strategy with one function."
    >
      <div className="grid divide-y divide-fd-border overflow-hidden rounded-surface border border-fd-border bg-fd-card lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {engineGroups.map((group) => (
          <div key={group.title} className="flex min-w-0 flex-col gap-4 p-6">
            <h3 className="text-[0.9375rem] font-semibold">{group.title}</h3>
            <ul className="flex flex-col gap-3">
              {group.engines.map((engine) => (
                <li
                  key={engine.specifier}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5"
                >
                  <span className="text-sm font-medium">{engine.name}</span>
                  {engine.note ? (
                    <span className="text-end text-xs text-fd-muted-foreground">{engine.note}</span>
                  ) : null}
                  <code className="row-start-2 font-mono text-xs break-all text-brand">{engine.specifier}</code>
                </li>
              ))}
            </ul>
            {group.note ? (
              <p className="mt-auto border-t border-dashed border-fd-border pt-3.5 text-[0.8125rem] leading-[1.55] text-fd-muted-foreground">
                {group.note}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-7 rounded-surface border border-fd-border p-7 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:items-center lg:gap-12 lg:p-10">
        <div className="flex min-w-0 flex-col items-start gap-3">
          <h3 className="text-lg leading-[1.3] font-semibold tracking-[-0.01em]">Not on the list? Write it.</h3>
          <p className="max-w-[58ch] text-[0.9375rem] leading-[1.65] text-fd-muted-foreground">
            A loader turns bytes into pages. A strategy turns pages into data. Define either with a name and a
            function, and the extractor runs it exactly like a built-in engine.
          </p>
          <ArrowLink href="/docs/resources/custom-components">Custom components guide</ArrowLink>
        </div>
        <CodeWindow file="csv-loader.ts" lang="TypeScript">
          {customCode}
        </CodeWindow>
      </div>
    </Section>
  );
}
