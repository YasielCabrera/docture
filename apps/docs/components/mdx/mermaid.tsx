"use client";

import { useEffect, useId, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Renders a Mermaid diagram.
 *
 * Client-only and lazily imported: mermaid is ~1MB and only pages that actually
 * draw something should pay for it. `remarkMdxMermaid` rewrites ```mermaid fences
 * into this component, so authors write plain markdown.
 */
export function Mermaid({ chart }: { chart: string }): React.ReactElement | null {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const mermaid = (await import("mermaid")).default;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        // Inherit the docs' typography rather than shipping a second font stack.
        fontFamily: "inherit",
        theme: resolvedTheme === "dark" ? "dark" : "default",
        themeVariables: { fontSize: "14px" },
        flowchart: { curve: "basis", useMaxWidth: true },
        sequence: { useMaxWidth: true },
      });

      try {
        // A fresh id per render: mermaid caches by id, and re-rendering after a
        // theme switch with the same id returns the stale SVG.
        const { svg: rendered } = await mermaid.render(`mermaid-${id}-${resolvedTheme}`, chart);
        if (!cancelled) {
          setSvg(rendered);
          setError(undefined);
        }
      } catch (cause) {
        // A malformed diagram should show its error, not blank the page.
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);

  if (error !== undefined) {
    return (
      <pre className="fd-codeblock text-fd-destructive text-sm">
        Mermaid could not render this diagram:{"\n"}
        {error}
      </pre>
    );
  }

  // Nothing until the client has rendered, to avoid a hydration mismatch. The
  // reserved height keeps the page from jumping when the diagram arrives.
  if (svg === undefined) return <div className="my-6 min-h-32" aria-busy="true" />;

  return (
    <div
      className="mermaid-diagram my-6"
      role="img"
      // Mermaid output is generated from our own content, not user input.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
