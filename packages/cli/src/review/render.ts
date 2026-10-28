import { createHash } from "node:crypto";
import {
  provenanceSegments,
  type CitationStatus,
  type DocumentElement,
  type LayoutBox,
  type LayoutPage,
  type SourceLine,
  type TableElement,
} from "docture";
import type { ReviewedExtraction } from "./input.js";
import type { PageImage } from "./pages.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const percent = (value: number, total: number): string => `${Number(((value / total) * 100).toFixed(4))}%`;

function boxStyle(box: LayoutBox, page: { readonly width: number; readonly height: number }): string {
  return `left:${percent(box.x, page.width)};top:${percent(box.y, page.height)};width:${percent(box.width, page.width)};height:${percent(box.height, page.height)}`;
}

const STYLE = `
:root{color-scheme:light;font:14px/1.45 system-ui,sans-serif;--verified:#15803d;--unverified:#b45309;--uncited:#b91c1c;--none:#6b7280}
body{margin:0;background:#f4f4f5;color:#18181b}
header{padding:12px 20px;background:#fff;border-bottom:1px solid #e4e4e7}
h1{font-size:16px;margin:0}h2{font-size:14px;margin:0 0 8px}
.layout{display:flex;align-items:flex-start;gap:20px;padding:20px}
main{flex:1;min-width:0;display:flex;flex-direction:column;gap:24px}
.page{background:#fff;border:1px solid #e4e4e7;padding:12px}
.sheet{position:relative;max-width:900px;outline:1px solid #d4d4d8}
.sheet img{position:absolute;inset:0;width:100%;height:100%}
.box,.line{position:absolute;box-sizing:border-box}
.box{border:1.5px solid var(--kind,#2563eb);background:color-mix(in srgb,var(--kind,#2563eb) 8%,transparent)}
.box:hover{background:color-mix(in srgb,var(--kind,#2563eb) 22%,transparent);z-index:2}
.box:hover::after{content:attr(data-label);position:absolute;left:0;bottom:100%;white-space:nowrap;background:#18181b;color:#fff;font-size:11px;padding:1px 4px}
.box[data-segment]{border-style:dashed}
.kind-heading{--kind:#7c3aed}.kind-table{--kind:#0891b2}.kind-list{--kind:#16a34a}.kind-code{--kind:#4b5563}
.kind-figure{--kind:#db2777}.kind-page-header,.kind-page-footer{--kind:#ea580c}
.elements{margin:12px 0 0;padding-left:20px}.elements li{margin:4px 0}
.elements code,.fields .path{font:12px ui-monospace,monospace}
.kind{display:inline-block;padding:0 6px;border-radius:8px;background:#e4e4e7;font-size:11px}
.elements p{margin:2px 0;white-space:pre-wrap}
table{border-collapse:collapse;margin:4px 0}td,th{border:1px solid #d4d4d8;padding:2px 6px}
.line{border:1px solid color-mix(in srgb,#2563eb 35%,transparent)}
.line.selected{border:2px solid #2563eb;background:color-mix(in srgb,#2563eb 25%,transparent)}
aside{position:sticky;top:20px;width:340px;max-height:calc(100vh - 40px);overflow:auto;background:#fff;border:1px solid #e4e4e7;padding:12px}
.fields{list-style:none;margin:0;padding:0}
.field{display:grid;grid-template-columns:1fr auto;gap:2px 8px;width:100%;text-align:left;font:inherit;background:none;border:0;border-left:4px solid var(--status);padding:6px 8px;margin:2px 0;cursor:pointer}
.field:hover,.field[aria-pressed=true]{background:#eff6ff}.field:focus-visible{outline:2px solid #2563eb}
.field .value{grid-column:1/3;overflow-wrap:anywhere}.field .status{color:var(--status);font-size:12px}
.status-verified{--status:var(--verified)}.status-cited-unverified{--status:var(--unverified)}
.status-uncited{--status:var(--uncited)}.status-not-requested{--status:var(--none)}
.notice{background:#fef3c7;padding:8px;margin:0 0 8px}
`;

function htmlDocument(title: string, body: string, script?: string): string {
  const scriptPolicy = script === undefined ? "" : `; script-src 'sha256-${createHash("sha256").update(script).digest("base64")}'`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'${scriptPolicy}">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    body,
    ...(script === undefined ? [] : [`<script>${script}</script>`]),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function sheet(page: { readonly width: number; readonly height: number }, image: PageImage, overlays: readonly string[]): string {
  const source = `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;
  return [
    `<div class="sheet" style="aspect-ratio:${page.width}/${page.height}">`,
    `<img src="${source}" alt="Page ${image.pageNumber}">`,
    ...overlays,
    "</div>",
  ].join("\n");
}

function elementText(element: DocumentElement): string | undefined {
  switch (element.kind) {
    case "heading":
    case "paragraph":
    case "code":
    case "page-header":
    case "page-footer":
      return element.text;
    case "list":
      return element.items.map((item) => `${item.marker ?? (element.ordered ? "1." : "•")} ${item.text}`).join("\n");
    case "figure":
      return [element.alt, element.caption].filter((part) => part !== undefined).join(" · ") || element.assetId;
    case "table":
    case "page-break":
      return undefined;
  }
}

function tableHtml(table: TableElement): string {
  const covered = new Set<string>();
  const spans = new Map<string, { rowSpan: number; colSpan: number }>();
  for (const span of table.spans ?? []) {
    spans.set(`${span.row}:${span.col}`, span);
    for (let r = span.row; r < span.row + span.rowSpan; r += 1) {
      for (let c = span.col; c < span.col + span.colSpan; c += 1) {
        if (r !== span.row || c !== span.col) covered.add(`${r}:${c}`);
      }
    }
  }
  const rows = table.rows.map((cells, r) => {
    const tag = r < table.headerRows ? "th" : "td";
    const html = cells.flatMap((cell, c) => {
      if (covered.has(`${r}:${c}`)) return [];
      const span = spans.get(`${r}:${c}`);
      const attributes =
        (span !== undefined && span.rowSpan > 1 ? ` rowspan="${span.rowSpan}"` : "") +
        (span !== undefined && span.colSpan > 1 ? ` colspan="${span.colSpan}"` : "");
      return [`<${tag}${attributes}>${escapeHtml(cell)}</${tag}>`];
    });
    return `<tr>${html.join("")}</tr>`;
  });
  return `<table>${rows.join("")}</table>`;
}

interface Placed {
  readonly element: DocumentElement;
  readonly box: LayoutBox;
  readonly segment?: string;
  readonly startPage: number;
}

export interface ConversionReview {
  readonly title: string;
  readonly pages: readonly LayoutPage[];
  /** One image per page number in `pages`. */
  readonly images: ReadonlyMap<number, PageImage>;
}

/** Every element drawn on each page it covers: one box per provenance segment, never a union across pages. */
export function conversionReviewHtml(review: ConversionReview): string {
  const placed = new Map<number, Placed[]>();
  for (const page of review.pages) {
    for (const element of page.elements) {
      if (element.kind === "page-break") continue;
      const segments = provenanceSegments(element.provenance);
      segments.forEach((segment, index) => {
        const list = placed.get(segment.pageNumber) ?? [];
        list.push({
          element,
          box: segment.box,
          startPage: page.pageNumber,
          ...(segments.length > 1 ? { segment: `${index + 1}/${segments.length}` } : {}),
        });
        placed.set(segment.pageNumber, list);
      });
    }
  }

  const sections = review.pages.map((page) => {
    const image = review.images.get(page.pageNumber);
    const here = placed.get(page.pageNumber) ?? [];
    const overlays = here.map(({ element, box, segment }) => {
      const label = `${element.id} · ${element.kind}${segment === undefined ? "" : ` · part ${segment}`}`;
      return (
        `<div class="box kind-${element.kind}" data-element="${escapeHtml(element.id)}" data-kind="${element.kind}"` +
        `${segment === undefined ? "" : ` data-segment="${segment}"`} data-label="${escapeHtml(label)}"` +
        ` style="${boxStyle(box, page)}" title="${escapeHtml(label)}"></div>`
      );
    });
    const items = here.map(({ element, segment, startPage }) => {
      const head = `<code>${escapeHtml(element.id)}</code> <span class="kind">${element.kind}</span>`;
      if (startPage !== page.pageNumber) {
        return `<li data-element="${escapeHtml(element.id)}">${head} continued from page ${startPage} (part ${segment ?? ""})</li>`;
      }
      const text = elementText(element);
      const body = element.kind === "table" ? tableHtml(element) : text === undefined ? "" : `<p>${escapeHtml(text)}</p>`;
      const evidence = element.kind === "page-header" || element.kind === "page-footer" ? ` <span class="kind">${element.evidence}</span>` : "";
      const continues = segment === undefined ? "" : ` continues across ${segment.split("/")[1]} pages`;
      return `<li data-element="${escapeHtml(element.id)}">${head}${evidence}${continues}${body}</li>`;
    });
    return [
      `<section class="page" data-page="${page.pageNumber}" aria-label="Page ${page.pageNumber}">`,
      `<h2>Page ${page.pageNumber}</h2>`,
      image === undefined ? "" : sheet(page, image, overlays),
      `<ol class="elements">${items.join("\n")}</ol>`,
      "</section>",
    ].join("\n");
  });

  const count = review.pages.reduce((sum, page) => sum + page.elements.filter((e) => e.kind !== "page-break").length, 0);
  const body = [
    `<header><h1>${escapeHtml(review.title)}</h1><p>${review.pages.length} pages, ${count} elements. Hover a box for its id and kind.</p></header>`,
    `<div class="layout"><main>${sections.join("\n")}</main></div>`,
  ].join("\n");
  return htmlDocument(`Review: ${review.title}`, body);
}

type FieldStatus = CitationStatus | "not-requested";

interface ReviewField {
  readonly path: string;
  readonly value: string;
  readonly status: FieldStatus;
  readonly ids: readonly string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function displayValue(value: unknown): string {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : String(value);
}

/** The leaves core asks citations for: a Date or other non-plain object is one leaf, and a blank string is absent. */
function leaves(value: unknown, path: readonly string[]): { path: string; value: string }[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, [...path, String(index)]));
  if (isPlainRecord(value)) return Object.entries(value).flatMap(([key, item]) => leaves(item, [...path, key]));
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return [];
  return [{ path: path.join("."), value: displayValue(value) }];
}

function reviewFields(extraction: ReviewedExtraction): readonly ReviewField[] {
  const byPath = new Map(extraction.cited?.citations.map((citation) => [citation.path, citation]));
  return leaves(extraction.data, []).map((leaf): ReviewField => {
    if (extraction.cited === undefined) return { ...leaf, status: "not-requested", ids: [] };
    const citation = byPath.get(leaf.path);
    return citation === undefined
      ? { ...leaf, status: "uncited", ids: [] }
      : { ...leaf, status: citation.status, ids: citation.ids };
  });
}

const SELECT_SCRIPT = `const fields=[...document.querySelectorAll("button.field")];
const lines=[...document.querySelectorAll(".line[data-line]")];
function select(button){
const ids=new Set((button.getAttribute("data-targets")||"").split(" ").filter(Boolean));
for(const field of fields)field.setAttribute("aria-pressed",String(field===button));
let first;
for(const line of lines){const on=ids.has(line.getAttribute("data-line"));line.classList.toggle("selected",on);if(on&&!first)first=line;}
if(first&&first.scrollIntoView)first.scrollIntoView({block:"center"});
}
fields.forEach((field,index)=>{
field.addEventListener("click",()=>select(field));
field.addEventListener("keydown",(event)=>{const next=event.key==="ArrowDown"?fields[index+1]:event.key==="ArrowUp"?fields[index-1]:undefined;if(next){event.preventDefault();next.focus();select(next);}});
});`;

export interface ExtractionReview {
  readonly title: string;
  /** Every rendered page; each cited line's page is among them. */
  readonly images: readonly PageImage[];
  readonly extraction: ReviewedExtraction;
}

/** The field list beside the pages. Selecting a field highlights exactly the lines it cites. */
export function extractionReviewHtml(review: ExtractionReview): string {
  const fields = reviewFields(review.extraction);
  const sources: readonly SourceLine[] = review.extraction.cited?.sources ?? [];
  const buttons = fields.map((field) => {
    const targets = field.ids.length === 0 ? "" : ` data-targets="${escapeHtml(field.ids.join(" "))}"`;
    const status = field.status === "not-requested" ? "not requested" : field.status;
    return (
      `<li><button type="button" class="field status-${field.status}" aria-pressed="false" data-path="${escapeHtml(field.path)}"` +
      ` data-status="${field.status}"${targets}><span class="path">${escapeHtml(field.path || "(value)")}</span>` +
      `<span class="status">${status}</span><span class="value">${escapeHtml(field.value)}</span></button></li>`
    );
  });
  const counts = (["verified", "cited-unverified", "uncited"] as const)
    .map((status) => `${fields.filter((field) => field.status === status).length} ${status}`)
    .join(", ");
  const notice =
    review.extraction.cited === undefined
      ? '<p class="notice">This result has no citations. Extract with --citations --full, or review with --schema and --model, to see which lines each value came from.</p>'
      : "";

  const sections = review.images.map((image) => {
    const overlays = sources
      .filter((line) => line.pageNumber === image.pageNumber)
      .map(
        (line) =>
          `<div class="line" data-line="${escapeHtml(line.id)}" style="${boxStyle(line.box, image)}" title="${escapeHtml(`${line.id}: ${line.text}`)}"></div>`,
      );
    return [
      `<section class="page" data-page="${image.pageNumber}" aria-label="Page ${image.pageNumber}">`,
      `<h2>Page ${image.pageNumber}</h2>`,
      sheet(image, image, overlays),
      "</section>",
    ].join("\n");
  });

  const body = [
    `<header><h1>${escapeHtml(review.title)}</h1><p>${fields.length} fields${review.extraction.cited === undefined ? "" : `: ${counts}`}. Select a field, or move with the arrow keys, to highlight its cited lines.</p></header>`,
    '<div class="layout">',
    `<aside aria-label="Extracted fields">${notice}<ul class="fields">${buttons.join("\n")}</ul></aside>`,
    `<main>${sections.join("\n")}</main>`,
    "</div>",
  ].join("\n");
  return htmlDocument(`Review: ${review.title}`, body, SELECT_SCRIPT);
}
