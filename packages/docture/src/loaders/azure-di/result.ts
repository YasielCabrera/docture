import type { LayoutBox, LoadedDocument, LoadedPage, TextLine } from "../../core/domain/geometry.js";
import { inferForm } from "../../core/pipeline/features.js";
import { AzureReadError } from "./error.js";

interface Span { readonly offset: number; readonly length: number }
interface Word { readonly content: string; readonly span: Span; readonly polygon?: readonly number[]; readonly confidence?: number }
interface Line { readonly content: string; readonly spans: readonly Span[] }
interface Page { readonly pageNumber: number; readonly width?: number; readonly height?: number; readonly unit?: string; readonly angle?: number; readonly spans: readonly Span[]; readonly words: readonly Word[]; readonly lines: readonly Line[] }

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AzureReadError(`Malformed Azure Read ${label}.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new AzureReadError(`Malformed Azure Read ${label}.`);
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new AzureReadError(`Malformed Azure Read ${label}.`);
  return value;
}
function numeric(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) throw new AzureReadError(`Malformed Azure Read ${label}.`);
  return value;
}
function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = numeric(value, label, minimum);
  if (!Number.isSafeInteger(parsed)) throw new AzureReadError(`Malformed Azure Read ${label}.`);
  return parsed;
}
function span(value: unknown, content: string): Span {
  const raw = record(value, "span");
  const offset = integer(raw["offset"], "span offset");
  const length = integer(raw["length"], "span length");
  if (offset + length > content.length) throw new AzureReadError("Azure Read span exceeds UTF-16 content bounds.");
  return { offset, length };
}
function polygon(value: unknown): readonly number[] | undefined {
  if (value === undefined) return undefined;
  const points = array(value, "polygon").map((coordinate) => numeric(coordinate, "polygon coordinate"));
  if (points.length < 6 || points.length % 2 !== 0) throw new AzureReadError("Malformed Azure Read polygon.");
  return points;
}
function parsePage(value: unknown, content: string): Page {
  const page = record(value, "page");
  const parsed: Page = {
    pageNumber: integer(page["pageNumber"], "page number", 1),
    ...(page["width"] === undefined ? {} : { width: numeric(page["width"], "page width") }),
    ...(page["height"] === undefined ? {} : { height: numeric(page["height"], "page height") }),
    ...(page["unit"] === undefined ? {} : { unit: text(page["unit"], "page unit") }),
    ...(page["angle"] === undefined ? {} : { angle: numeric(page["angle"], "page angle", -360) }),
    spans: array(page["spans"] ?? [], "page spans").map((value) => span(value, content)),
    words: array(page["words"] ?? [], "page words").map((value) => {
      const word = record(value, "word");
      const bounds = span(word["span"], content);
      const valueText = text(word["content"], "word content");
      if (content.slice(bounds.offset, bounds.offset + bounds.length) !== valueText) throw new AzureReadError("Azure Read word span disagrees with its content.");
      const confidence = word["confidence"] === undefined ? undefined : numeric(word["confidence"], "word confidence");
      if (confidence !== undefined && confidence > 1) throw new AzureReadError("Malformed Azure Read word confidence.");
      const points = polygon(word["polygon"]);
      return { content: valueText, span: bounds, ...(points === undefined ? {} : { polygon: points }), ...(confidence === undefined ? {} : { confidence }) };
    }),
    lines: array(page["lines"] ?? [], "page lines").map((value) => {
      const line = record(value, "line");
      return { content: text(line["content"], "line content"), spans: array(line["spans"], "line spans").map((value) => span(value, content)) };
    }),
  };
  const inPage = (part: Span) => parsed.spans.length === 0 || parsed.spans.some((container) => part.offset >= container.offset && part.offset + part.length <= container.offset + container.length);
  if (parsed.words.some((word) => !inPage(word.span)) || parsed.lines.some((line) => line.spans.some((part) => !inPage(part)))) throw new AzureReadError("Azure Read evidence span belongs to another page.");
  if (parsed.lines.some((line) => line.spans.map((part) => content.slice(part.offset, part.offset + part.length)).join("") !== line.content)) throw new AzureReadError("Azure Read line spans disagree with their content.");
  return parsed;
}

function box(points: readonly number[], scale: number): LayoutBox {
  const x = points.filter((_, index) => index % 2 === 0);
  const y = points.filter((_, index) => index % 2 === 1);
  const left = Math.min(...x); const top = Math.min(...y);
  return { x: left * scale, y: top * scale, width: (Math.max(...x) - left) * scale, height: (Math.max(...y) - top) * scale };
}

function linesOf(page: Page, scale: number): readonly TextLine[] | undefined {
  const lines: TextLine[] = [];
  for (const line of page.lines) {
    const words = page.words.filter((word) => line.spans.some((part) => word.span.offset >= part.offset && word.span.offset + word.span.length <= part.offset + part.length)).sort((a, b) => a.span.offset - b.span.offset);
    if (words.length === 0 || words.some((word) => word.polygon === undefined)) return undefined;
    const spans = words.flatMap((word) => word.polygon === undefined ? [] : [{ text: word.content, ...box(word.polygon, scale), ...(word.confidence === undefined ? {} : { confidence: word.confidence }) }]);
    const top = Math.min(...spans.map((word) => word.y));
    const bottom = Math.max(...spans.map((word) => word.y + word.height));
    lines.push({ text: line.content, y: top, height: bottom - top, spans });
  }
  return lines.length === 0 ? undefined : lines;
}

export function azureReadResult(raw: unknown, imageDpi: number | undefined, selected: readonly number[] | undefined): LoadedDocument {
  const result = record(raw, "result");
  if (result["apiVersion"] !== "2024-11-30" || result["modelId"] !== "prebuilt-read" || result["stringIndexType"] !== "utf16CodeUnit") throw new AzureReadError("Unsupported Azure Read API, model or string-index contract.");
  const content = text(result["content"], "content");
  const parsed = array(result["pages"], "pages").map((page) => parsePage(page, content));
  if (parsed.length === 0 || new Set(parsed.map((page) => page.pageNumber)).size !== parsed.length) throw new AzureReadError("Azure Read returned empty or duplicate pages.");
  if (selected?.some((number) => !parsed.some((page) => page.pageNumber === number))) throw new AzureReadError("Azure Read omitted a selected page.");
  const diagnostics: { pageNumber: number; code: string }[] = [];
  const pages: LoadedPage[] = parsed.filter((page) => selected === undefined || selected.includes(page.pageNumber)).sort((a, b) => a.pageNumber - b.pageNumber).map((page) => {
    const scale = page.unit === "inch" ? 72 : page.unit === "pixel" && imageDpi !== undefined ? 72 / imageDpi : undefined;
    const sizeKnown = scale !== undefined && page.width !== undefined && page.height !== undefined && page.width > 0 && page.height > 0;
    const lines = sizeKnown ? linesOf(page, scale) : undefined;
    if (!sizeKnown) diagnostics.push({ pageNumber: page.pageNumber, code: page.unit === "pixel" && imageDpi === undefined ? "PIXEL_DPI_REQUIRED" : "PAGE_GEOMETRY_UNAVAILABLE" });
    else if (lines === undefined) diagnostics.push({ pageNumber: page.pageNumber, code: "TEXT_GEOMETRY_UNAVAILABLE" });
    const pageText = page.lines.length > 0 ? page.lines.map((line) => line.content).join("\n") : page.spans.map((part) => content.slice(part.offset, part.offset + part.length)).join("");
    return { pageNumber: page.pageNumber, width: sizeKnown ? page.width * scale : 0, height: sizeKnown ? page.height * scale : 0, text: pageText, ...(lines === undefined ? {} : { lines }) };
  });
  return {
    pages, text: pages.map((page) => page.text).join("\f"), form: inferForm(pages.map((page) => page.text.trim().length)), loader: "azure-read",
    meta: { apiVersion: "2024-11-30", modelId: "prebuilt-read", stringIndexType: "utf16CodeUnit", pagesRead: pages.length, diagnostics, pageUnits: parsed.map((page) => ({ pageNumber: page.pageNumber, unit: page.unit ?? "unknown", ...(page.angle === undefined ? {} : { angle: page.angle }) })) },
  };
}
