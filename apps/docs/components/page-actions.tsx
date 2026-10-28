"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, FileText } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "fumadocs-ui/components/ui/popover";

type CopyStatus = "idle" | "copying" | "copied" | "error";

const copyLabels: Record<CopyStatus, string> = {
  idle: "Copy page",
  copying: "Copying…",
  copied: "Copied!",
  error: "Copy failed. Retry",
};

export function PageActions({ markdownUrl }: { markdownUrl: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    if (status !== "copied" && status !== "error") return;
    const timeout = setTimeout(() => setStatus("idle"), 3000);
    return () => clearTimeout(timeout);
  }, [status]);

  async function copyPage() {
    setOpen(false);
    setStatus("copying");
    try {
      const text = fetch(markdownUrl).then((response) => {
        if (!response.ok) throw new Error("Markdown request failed");
        return response.text();
      });
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="docs-page-actions">
      <div className="docs-page-actions-buttons">
        <button
          type="button"
          className="docs-page-copy"
          disabled={status === "copying"}
          onClick={copyPage}
        >
          {status === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copyLabels[status]}
        </button>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className="docs-page-actions-trigger" aria-label="Page actions">
            <ChevronDown aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent align="end" className="docs-page-actions-popover" aria-label="Page actions">
            <button
              type="button"
              className="docs-page-action"
              disabled={status === "copying"}
              onClick={copyPage}
            >
              <Copy aria-hidden="true" />
              <span>
                <span className="docs-page-action-title">Copy page</span>
                <span className="docs-page-action-description">Copy page as Markdown for LLMs</span>
              </span>
            </button>
            <a href={markdownUrl} className="docs-page-action">
              <FileText aria-hidden="true" />
              <span>
                <span className="docs-page-action-title">View as Markdown</span>
                <span className="docs-page-action-description">Open this page as plain text</span>
              </span>
            </a>
          </PopoverContent>
        </Popover>
      </div>
      <span className="sr-only" role="status">
        {status === "copied" && "Page copied as Markdown."}
        {status === "error" && "Could not copy the page. Try again or open View as Markdown."}
      </span>
    </div>
  );
}
