import Link from "next/link";
import { appName, appTagline } from "@/lib/shared";

const highlights = [
  {
    title: "Typed to the leaves",
    body: "result.data is inferred from your schema. No casts, no opaque contract class.",
  },
  {
    title: "Your model, from the AI SDK",
    body: "model: openai(\"gpt-5\") — a provider instance, a gateway string, or your own.",
  },
  {
    title: "The library is in the name",
    body: "PdfJsLoader, MuPdfLoader, TesseractJsLoader. Swapping one is swapping an import.",
  },
  {
    title: "Nothing you did not ask for",
    body: "Installing core pulls no PDF library, no WASM, no ONNX. A test proves it.",
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-20">
      <div className="w-full max-w-3xl">
        <p className="text-fd-muted-foreground font-mono text-sm">{appName}</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{appTagline}</h1>
        <p className="text-fd-muted-foreground mt-5 text-lg">
          Point it at a PDF, hand it a schema, get typed data back — with no native
          binaries anywhere in the stack.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/docs"
            className="bg-fd-primary text-fd-primary-foreground rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            Read the docs
          </Link>
          <Link
            href="/docs/quick-start"
            className="border-fd-border hover:bg-fd-accent rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors"
          >
            Quick start
          </Link>
        </div>

        <pre className="fd-codeblock border-fd-border bg-fd-card mt-12 overflow-x-auto rounded-xl border p-5 text-sm leading-relaxed">
          <code>{`const extractor = createExtractor({
  loaders: [new PdfJsLoader()],
  strategies: [llm({ model: openai("gpt-5") })],
});

const { data } = await extractor.extract("invoice.pdf", Invoice);
data.lineItems[0].amount;  // number`}</code>
        </pre>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {highlights.map((item) => (
            <div key={item.title} className="border-fd-border rounded-xl border p-5">
              <h2 className="font-semibold">{item.title}</h2>
              <p className="text-fd-muted-foreground mt-1.5 text-sm">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
