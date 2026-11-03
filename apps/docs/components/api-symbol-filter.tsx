"use client";

import { useId, useState } from "react";
import type { ApiSymbolRecord } from "../lib/api-symbol-markdown";

export function ApiSymbolFilter({ symbols }: { readonly symbols: readonly ApiSymbolRecord[] }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [packageName, setPackageName] = useState("");
  const packages = [...new Set(symbols.map((item) => item.packageName))].sort();
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = symbols.filter((item) =>
    (packageName === "" || item.packageName === packageName) && terms.every((term) =>
      [item.symbol, item.packageName, ...item.importPaths].some((value) => value.toLowerCase().includes(term))));

  return (
    <div className="not-prose my-6" role="region" aria-label="API symbol lookup">
      <div className="flex flex-wrap gap-4">
        <label htmlFor={`${id}-query`} className="flex min-w-48 flex-1 flex-col gap-2 text-sm">
          Symbol or import path
          <input
            id={`${id}-query`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="createExtractor or docture/llm"
            className="rounded-control border border-fd-border bg-fd-background px-3 py-2 text-base"
          />
        </label>
        <label htmlFor={`${id}-package`} className="flex flex-col gap-2 text-sm">
          Package
          <select id={`${id}-package`} value={packageName} onChange={(event) => setPackageName(event.target.value)} className="rounded-control border border-fd-border bg-fd-background px-3 py-2 text-base">
            <option value="">All packages</option>
            {packages.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
      <p role="status" className="my-4 text-sm text-fd-muted-foreground">{matches.length} of {symbols.length} symbol references</p>
      {matches.length === 0 ? <p>No matching symbols. Try a function name, import path, or another package.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-fd-border"><th scope="col" className="p-3">Symbol</th><th scope="col" className="p-3">Import paths</th><th scope="col" className="p-3">Description</th></tr></thead>
            <tbody>
              {matches.map((item) => (
                <tr key={`${item.packageName}:${item.symbol}:${item.url}`} className="border-b border-fd-border align-top">
                  <td className="p-3"><a href={item.url} className="font-mono break-all underline underline-offset-4">{item.symbol}</a></td>
                  <td className="p-3">{item.importPaths.map((path) => <code key={path} className="mb-1 block break-all">{path}</code>)}</td>
                  <td className="p-3">{item.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
