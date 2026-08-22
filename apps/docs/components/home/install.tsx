import {
  siAnthropic,
  siGooglegemini,
  siMistralai,
  siNodedotjs,
  siOllama,
  siTypescript,
  siZod,
} from "simple-icons";
import Link from "next/link";
import { CopyCommand } from "./copy-command";

export const installCommand = "npm install docture @docture/loader-pdfjs ai @ai-sdk/openai zod";

/**
 * What is already in your stack.
 *
 * Not social proof, which docture has not earned yet. These are the things it
 * plugs into: the AI SDK means any provider, and any schema library the SDK
 * accepts. OpenAI is missing only because Simple Icons no longer carries the mark.
 */
const worksWith = [
  siTypescript,
  siZod,
  siNodedotjs,
  siAnthropic,
  siGooglegemini,
  siMistralai,
  siOllama,
];

export function Install() {
  return (
    <section className="border-b border-fd-border">
      <div className="reveal mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
        <div className="flex min-w-0 flex-col gap-3">
          <CopyCommand command={installCommand} />
          <p className="max-w-[52ch] text-sm leading-relaxed text-fd-muted-foreground">
            Installing <code className="font-mono text-[0.8125rem]">@docture/core</code> on its own
            pulls one dependency. Every heavy library lives in the package that wraps it.{" "}
            <Link href="/docs/reference/packages" className="text-brand hover:underline">
              Why it is split up
            </Link>
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
          <span className="shrink-0 text-sm text-fd-muted-foreground">Works with</span>
          <ul className="flex flex-wrap items-center gap-x-7 gap-y-4">
            {worksWith.map((icon) => (
              <li key={icon.title}>
                <svg
                  role="img"
                  aria-label={icon.title}
                  viewBox="0 0 24 24"
                  className="size-[1.375rem] fill-fd-muted-foreground/70 transition-colors duration-200 hover:fill-fd-foreground"
                >
                  <path d={icon.path} />
                </svg>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
