import { highlight } from "fumadocs-core/highlight";
import { codeThemes } from "@/lib/code-themes";
import type { ReactNode } from "react";

/**
 * Shiki, at build time, with the same themes the MDX pages use.
 *
 * The home page shows a lot of code and every block of it is real. Highlighting it
 * for real matters for the same reason: hand-styled spans drift, and a reader who
 * copies a snippet should get the snippet the docs would give them.
 */
export async function Code({
  code,
  lang = "ts",
  className = "",
}: {
  code: string;
  lang?: string;
  className?: string;
}): Promise<ReactNode> {
  const rendered = await highlight(code, {
    lang,
    themes: codeThemes,
    components: {
      pre: ({ className: inner, ...props }) => (
        <pre
          {...props}
          className={`docs-home-code w-full max-w-full min-w-0 overflow-x-auto p-5 text-[0.8125rem] leading-[1.75] ${inner ?? ""} ${className}`}
        />
      ),
    },
  });

  return rendered;
}
