"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The install line, copyable.
 *
 * Three states, because the middle one is the whole point of the button: idle,
 * copied, and failed. A clipboard write can be refused (an insecure origin, a
 * denied permission) and silently doing nothing is the worst of the three.
 */
export function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <div className="flex h-[2.625rem] w-fit max-w-full min-w-0 items-center gap-2 rounded-control border border-fd-border bg-fd-card ps-4 pe-1">
      <code className="min-w-0 overflow-x-auto font-mono text-[0.8125rem] whitespace-nowrap text-fd-muted-foreground [scrollbar-width:none]">
        <span className="text-brand select-none">$ </span>
        {command}
      </code>
      <button
        type="button"
        aria-label={state === "copied" ? "Copied" : "Copy the install command"}
        onClick={() => {
          navigator.clipboard
            .writeText(command)
            .then(() => setState("copied"))
            .catch(() => setState("failed"));
        }}
        className="grid size-8 shrink-0 place-items-center rounded-[0.375rem] text-fd-muted-foreground transition-colors duration-200 hover:bg-fd-accent hover:text-fd-foreground active:scale-[0.94]"
      >
        {state === "copied" ? (
          <Check className="size-4 text-brand" strokeWidth={1.5} />
        ) : (
          <Copy className="size-4" strokeWidth={1.5} />
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? "Install command copied." : ""}
        {state === "failed" ? "Could not copy. Select the command and copy it manually." : ""}
      </span>
    </div>
  );
}
