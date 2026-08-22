"use client";

import { useId, useRef, useState, type ReactNode } from "react";

export interface Panel {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly code: ReactNode;
}

/**
 * The examples, behind tabs.
 *
 * Every panel is highlighted on the server and handed here as a node, so the only
 * thing that ships to the browser is the switch.
 *
 * All panels occupy the SAME grid cell. The container is therefore as tall as the
 * longest example and clicking a tab moves nothing on the page. Toggling `hidden`
 * instead would swing the layout by a few hundred pixels between the longest and
 * the shortest, which is a bad trade for a little whitespace.
 */
export function ApiTabs({ panels }: { panels: readonly Panel[] }) {
  const [active, setActive] = useState(panels[0]?.id ?? "");
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving tabindex plus arrow keys, which is what `role="tablist"` promises a
  // screen reader. Without it, Tab walks through five buttons instead of one.
  function move(from: number, delta: number) {
    const next = (from + delta + panels.length) % panels.length;
    const panel = panels[next];
    if (!panel) return;
    setActive(panel.id);
    tabs.current[next]?.focus();
  }

  return (
    <div className="overflow-hidden rounded-surface border border-fd-border bg-fd-card">
      <div
        role="tablist"
        aria-label="Examples"
        className="flex overflow-x-auto border-b border-fd-border [scrollbar-width:none]"
      >
        {panels.map((panel, index) => {
          const selected = panel.id === active;
          return (
            <button
              key={panel.id}
              type="button"
              role="tab"
              id={`${base}-tab-${panel.id}`}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              aria-selected={selected}
              aria-controls={`${base}-panel-${panel.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(panel.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") move(index, 1);
                else if (event.key === "ArrowLeft") move(index, -1);
                else if (event.key === "Home") move(0, 0);
                else if (event.key === "End") move(panels.length - 1, 0);
                else return;
                event.preventDefault();
              }}
              className={`relative shrink-0 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
                selected
                  ? "text-fd-foreground"
                  : "text-fd-muted-foreground hover:text-fd-foreground"
              }`}
            >
              {panel.label}
              <span
                aria-hidden
                className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand transition-transform duration-200 ease-out-quint ${
                  selected ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="grid">
        {panels.map((panel) => {
          const selected = panel.id === active;
          return (
            <div
              key={panel.id}
              role="tabpanel"
              id={`${base}-panel-${panel.id}`}
              aria-labelledby={`${base}-tab-${panel.id}`}
              // Same cell, same stacking order. `invisible` also takes the inactive
              // panels out of the accessibility tree and out of the tab order.
              className={`col-start-1 row-start-1 transition-opacity duration-200 ${
                selected ? "opacity-100" : "invisible opacity-0"
              }`}
            >
              <div className="border-b border-fd-border px-5 py-3 text-sm text-fd-muted-foreground">
                {panel.note}
              </div>
              {panel.code}
            </div>
          );
        })}
      </div>
    </div>
  );
}
