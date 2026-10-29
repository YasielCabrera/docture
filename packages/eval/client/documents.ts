import type { HtmlView } from "../src/reporters/html/view.js";
import type { CellValue } from "../src/reporters/shared/columns.js";
import { assertionFailures, describeRows, fieldDiffs, rowDefects } from "../src/reporters/shared/diffs.js";
import type { CaseResult, EvalResult } from "../src/result/types.js";
import { copy, el } from "./dom.js";
import { textTable } from "./panels.js";

type Row = HtmlView["documents"]["rows"][number];

function compareValues(a: CellValue, b: CellValue): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function detail(row: CaseResult): HTMLElement {
  const box = el("div", "case-detail");
  if (row.outcome === "errored") {
    box.append(el("h4", "", copy("error")), el("pre", "error", `${row.error.name}${row.error.code === undefined ? "" : ` [${row.error.code}]`}: ${row.error.message}`));
    return box;
  }
  if (row.outcome === "skipped") {
    box.append(el("h4", "", copy("skipped")), el("p", "", row.reason));
    return box;
  }
  const diffs = fieldDiffs(row);
  if (diffs.length === 0) box.append(el("p", "note", copy("all-matched")));
  else {
    box.append(el("h4", "", copy("field-diffs")));
    const table = textTable(
      [copy("path"), copy("status"), copy("expected"), copy("actual"), copy("hint")],
      [false, false, false, false, false],
      diffs.map((diff) => [diff.path, diff.status, diff.expected, diff.actual, [diff.hint, diff.note].filter((part) => part !== undefined).join("; ")]),
    );
    table.classList.add("diffs");
    box.append(table);
  }
  for (const [title, lines] of [[copy("row-diffs"), rowDefects(row).map(describeRows)], [copy("assertions"), assertionFailures(row)]] as const) {
    if (lines.length === 0) continue;
    const list = el("ul");
    for (const line of lines) list.append(el("li", "", line));
    box.append(el("h4", "", title), list);
  }
  return box;
}

/** The sortable, filterable documents table with expandable field and row diffs. */
export function documentsElement(result: EvalResult, view: HtmlView): HTMLElement {
  const { columns, rows } = view.documents;
  const state = { sort: -1, direction: 1, filter: "", failuresOnly: false, open: new Set<number>() };
  const section = el("section", "section");
  section.id = "section-cases";
  const search = el("input", "filter");
  search.type = "search";
  search.placeholder = copy("filter");
  search.setAttribute("aria-label", copy("filter"));
  const toggle = el("input");
  toggle.type = "checkbox";
  const toggleLabel = el("label", "toggle");
  toggleLabel.append(toggle, document.createTextNode(` ${copy("failures-only")}`));
  const count = el("span", "count");
  const controls = el("div", "controls");
  controls.append(search, toggleLabel, count);
  const table = el("table", "data documents");
  const head = el("tr");
  const body = table.createTBody();
  const headers = columns.map((column, index) => {
    const th = el("th", column.numeric ? "num" : "");
    const button = el("button", "sort", column.header);
    button.type = "button";
    button.title = copy("sort");
    button.addEventListener("click", () => {
      state.direction = state.sort === index ? -state.direction : 1;
      state.sort = index;
      render();
    });
    th.append(button);
    head.append(th);
    return th;
  });
  table.createTHead().append(head);
  const scroll = el("div", "scroll");
  scroll.append(table);
  section.append(el("h2", "", copy("cases")), controls, scroll);

  const visible = (): Row[] => {
    const needle = state.filter.toLowerCase();
    const shown = rows.filter((row) => (!state.failuresOnly || row.failed) && (needle === "" || row.text.some((text) => text.toLowerCase().includes(needle))));
    if (state.sort < 0) return shown;
    return shown.slice().sort((a, b) => {
      const x = a.values[state.sort] ?? null;
      const y = b.values[state.sort] ?? null;
      if (x === null || y === null) return compareValues(x, y);
      return state.direction * compareValues(x, y) || a.index - b.index;
    });
  };

  function render(): void {
    headers.forEach((th, index) => th.setAttribute("aria-sort", index !== state.sort ? "none" : state.direction > 0 ? "ascending" : "descending"));
    const shown = visible();
    count.textContent = `${shown.length} / ${rows.length} ${copy("shown")}`;
    const lines: HTMLTableRowElement[] = [];
    for (const row of shown) {
      const tr = el("tr", row.failed ? "case failed" : "case");
      tr.tabIndex = 0;
      tr.dataset["index"] = String(row.index);
      tr.setAttribute("aria-expanded", String(state.open.has(row.index)));
      row.text.forEach((text, index) => tr.append(el("td", columns[index]?.numeric ? "num" : "", text)));
      const flip = (): void => {
        if (state.open.has(row.index)) state.open.delete(row.index);
        else state.open.add(row.index);
        render();
      };
      tr.addEventListener("click", flip);
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          flip();
        }
      });
      lines.push(tr);
      const caseRow = result.cases[row.index];
      if (state.open.has(row.index) && caseRow !== undefined) {
        const open = el("tr", "detail");
        const cell = el("td");
        cell.colSpan = columns.length;
        cell.append(detail(caseRow));
        open.append(cell);
        lines.push(open);
      }
    }
    if (lines.length === 0) {
      const empty = el("tr", "empty");
      const cell = el("td", "", copy("no-rows"));
      cell.colSpan = columns.length;
      empty.append(cell);
      lines.push(empty);
    }
    body.replaceChildren(...lines);
  }

  search.addEventListener("input", () => {
    state.filter = search.value;
    render();
  });
  toggle.addEventListener("change", () => {
    state.failuresOnly = toggle.checked;
    render();
  });
  render();
  return section;
}
