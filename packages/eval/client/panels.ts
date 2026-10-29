import type { PanelData, SectionData } from "../src/reporters/html/view.js";
import { el } from "./dom.js";

function tiles(panel: Extract<PanelData, { kind: "tiles" }>): HTMLElement {
  const grid = el("div", "tiles");
  for (const item of panel.items) {
    const tile = el("div", `tile tone-${item.tone}`);
    tile.append(el("span", "tile-label", item.label), el("strong", "tile-value", item.text));
    if (item.detail !== undefined) tile.append(el("span", "tile-detail", item.detail));
    grid.append(tile);
  }
  return grid;
}

function bars(panel: Extract<PanelData, { kind: "bars" }>): HTMLElement {
  const list = el("div", "bars");
  for (const item of panel.items) {
    const row = el("div", "bar");
    const track = el("div", "bar-track");
    const fill = el("div", `bar-fill tone-${item.tone}`);
    const share = item.value === null || panel.max <= 0 ? 0 : Math.max(0, Math.min(1, item.value / panel.max));
    fill.style.width = `${(share * 100).toFixed(2)}%`;
    track.append(fill);
    row.append(el("span", "bar-label", item.label), track, el("span", "bar-text", item.text));
    list.append(row);
  }
  return list;
}

/** A table of preformatted text cells. */
export function textTable(columns: readonly string[], numeric: readonly boolean[], rows: readonly (readonly string[])[]): HTMLTableElement {
  const table = el("table", "data");
  const head = el("tr");
  columns.forEach((column, index) => head.append(el("th", numeric[index] ? "num" : "", column)));
  table.createTHead().append(head);
  const body = table.createTBody();
  for (const row of rows) {
    const tr = el("tr");
    row.forEach((cell, index) => {
      const tone = columns[index] !== "Verdict" ? "" : cell === "IMPROVED" ? " verdict-improved" : cell === "REGRESSED" ? " verdict-regressed" : "";
      tr.append(el("td", `${numeric[index] ? "num" : ""}${tone}`, cell));
    });
    body.append(tr);
  }
  return table;
}

function panelElement(panel: PanelData): HTMLElement {
  const box = el("div", `panel panel-${panel.kind}`);
  if (panel.title !== "") box.append(el("h3", "", panel.title));
  if (panel.kind === "tiles") box.append(tiles(panel));
  else if (panel.kind === "bars") box.append(bars(panel));
  else {
    const scroll = el("div", "scroll");
    scroll.append(textTable(panel.columns, panel.numeric, panel.rows));
    box.append(scroll);
    for (const note of panel.notes) box.append(el("p", "note", note));
  }
  return box;
}

/** A section heading and its panels. */
export function sectionElement(section: SectionData): HTMLElement {
  const node = el("section", "section");
  node.id = `section-${section.id}`;
  if (section.title !== "") node.append(el("h2", "", section.title));
  for (const panel of section.panels) node.append(panelElement(panel));
  return node;
}
