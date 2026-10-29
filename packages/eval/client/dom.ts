import { HTML_IDS } from "../src/reporters/html/view.js";

/** An element with an optional class and text. Data from the result is only ever set as text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className !== "") node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** An element the page shell must contain. */
export function mustFind(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`The report page has no #${id} element.`);
  return node;
}

/** Parse a `<script type="application/json">` element. */
export function readJson<T>(id: string): T {
  return JSON.parse(mustFind(id).textContent ?? "null") as T;
}

/** Interface copy from the page's `<template>`, so wording lives in the shell rather than the bundle. */
export function copy(key: string): string {
  const template = mustFind(HTML_IDS.copy);
  const root = template instanceof HTMLTemplateElement ? template.content : template;
  return root.querySelector(`[data-copy="${key}"]`)?.textContent ?? key;
}
