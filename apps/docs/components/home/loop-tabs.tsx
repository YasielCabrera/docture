"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface LoopTab {
  readonly id: string;
  readonly title: string;
  readonly packageName: string;
  readonly description: string;
  readonly panel: ReactNode;
}

const keyMoves: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

/**
 * The panels arrive highlighted from the server; only the switch ships to the browser.
 * They share one grid cell, so the column is as tall as the longest snippet and
 * switching tabs never moves the page.
 */
export function LoopTabs({ tabs }: { tabs: readonly LoopTab[] }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    const move = keyMoves[event.key];
    if (!move) return;
    event.preventDefault();
    const next = move(index, tabs.length);
    setActive(next);
    buttons.current[next]?.focus();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,4.5fr)_minmax(0,7.5fr)] lg:items-start lg:gap-10">
      <div role="tablist" aria-label="The loop" aria-orientation="vertical" className="flex min-w-0 flex-col border-t border-fd-border">
        {tabs.map((tab, index) => {
          const selected = index === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`relative grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-b border-fd-border py-5 ps-[1.125rem] pe-4 text-start transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
                selected ? "bg-fd-card" : "hover:bg-fd-card/60"
              }`}
            >
              <span className="text-xl leading-[1.3] font-semibold tracking-[-0.01em]">{tab.title}</span>
              <span className="self-center font-mono text-xs text-brand">{tab.packageName}</span>
              <span className="col-span-full max-w-[46ch] text-sm leading-[1.6] text-fd-muted-foreground">
                {tab.description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid min-w-0">
        {tabs.map((tab, index) => {
          const selected = index === active;
          return (
            <div
              key={tab.id}
              role="tabpanel"
              id={`${base}-panel-${tab.id}`}
              aria-labelledby={`${base}-tab-${tab.id}`}
              tabIndex={0}
              // `invisible` also removes the inactive panels from the accessibility tree and tab order.
              className={`col-start-1 row-start-1 min-w-0 transition-[opacity,translate] duration-300 ease-out-quint motion-reduce:transition-none ${
                selected ? "opacity-100" : "invisible translate-y-1 opacity-0"
              }`}
            >
              {tab.panel}
            </div>
          );
        })}
      </div>
    </div>
  );
}
