import type {
  ConversionAsset,
  ConversionAssetMode,
  ConversionFormat,
  ConversionWarning,
  ConvertedPage,
  DocumentElement,
  InlineText,
  LayoutDocument,
} from "../domain/conversion.js";
import type { LoadedDocument } from "../domain/geometry.js";
import { anchorAt, flattenHeaderRows } from "./tables.js";

export interface ExportedDocument {
  readonly content: string;
  readonly mimeType: "text/plain" | "text/markdown" | "text/html" | "application/json";
  readonly pages: readonly ConvertedPage[];
  readonly assets: readonly ConversionAsset[];
  readonly warnings: readonly ConversionWarning[];
}

interface RenderContext {
  readonly mode: ConversionAssetMode;
  readonly assets: ReadonlyMap<string, ConversionAsset>;
  readonly warnings: ConversionWarning[];
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/tiff": ".tiff",
  "image/webp": ".webp",
};

function assetExtension(mimeType: string): string | undefined {
  return MIME_EXTENSIONS[mimeType.toLowerCase()];
}

/** Copy loader assets into stable, document-relative names before exporting. */
export function conversionAssets(
  document: LoadedDocument,
  directory: string,
  mode: ConversionAssetMode,
): { assets: readonly ConversionAsset[]; warnings: readonly ConversionWarning[] } {
  if (mode === "omit") return { assets: [], warnings: [] };

  const assets: ConversionAsset[] = [];
  const warnings: ConversionWarning[] = [];
  const seen = new Set<string>();

  for (const page of document.pages) {
    for (const [index, asset] of (page.assets ?? []).entries()) {
      if (seen.has(asset.id)) {
        warnings.push({
          code: "UNSUPPORTED_ASSET",
          message: `Asset id "${asset.id}" is duplicated; only its first value is exportable.`,
          pageNumber: page.pageNumber,
        });
        continue;
      }
      seen.add(asset.id);

      const extension = assetExtension(asset.mimeType);
      if (!asset.mimeType.toLowerCase().startsWith("image/") || extension === undefined) {
        warnings.push({
          code: "UNSUPPORTED_ASSET",
          message: `Asset "${asset.id}" has unsupported media type "${asset.mimeType}".`,
          pageNumber: page.pageNumber,
        });
        continue;
      }

      assets.push({
        ...asset,
        reference: `${directory}/page-${page.pageNumber}-image-${index + 1}${extension}`,
      });
    }
  }

  return { assets, warnings };
}

function warnOnce(
  warnings: ConversionWarning[],
  warning: ConversionWarning,
): void {
  if (
    warnings.some(
      (existing) =>
        existing.code === warning.code &&
        existing.message === warning.message &&
        existing.pageNumber === warning.pageNumber,
    )
  ) {
    return;
  }
  warnings.push(warning);
}

function isSafeLink(href: string): boolean {
  const value = href.trim();
  if (/^(?:#|\/|\.\/|\.\.\/)/u.test(value)) return true;
  return /^(?:https?|mailto|tel|ftp):/iu.test(value);
}

function safeHref(
  href: string,
  pageNumber: number,
  warnings: ConversionWarning[],
): string | undefined {
  if (isSafeLink(href)) return href;
  warnOnce(warnings, {
    code: "UNSAFE_LINK",
    message: `Page ${pageNumber} contains an unsafe link target; its text was kept without the link.`,
    pageNumber,
  });
  return undefined;
}

function markdownText(value: string): string {
  return value
    .replace(/([\\`*_[\]<>])/gu, "\\$1")
    .replace(/^([\t ]{0,3})([#>+-])(?=\s)/gmu, "$1\\$2")
    .replace(/^([\t ]{0,3})(\d+)([.)])(?=\s)/gmu, "$1$2\\$3")
    .replace(/^([\t ]{0,3})(-{3,}|~{3,})(\s*)$/gmu, "$1\\$2$3");
}

function markdownRuns(
  runs: readonly InlineText[],
  pageNumber: number,
  warnings: ConversionWarning[],
): string {
  return runs
    .map((run) => {
      const text = markdownText(run.text);
      if (run.href === undefined) return text;
      const href = safeHref(run.href, pageNumber, warnings);
      return href === undefined ? text : `[${text}](${href.replace(/[()\\]/gu, "\\$&")})`;
    })
    .join("");
}

function htmlText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function htmlRuns(
  runs: readonly InlineText[],
  pageNumber: number,
  warnings: ConversionWarning[],
): string {
  return runs
    .map((run) => {
      const text = htmlText(run.text).replace(/\n/gu, "<br>\n");
      if (run.href === undefined) return text;
      const href = safeHref(run.href, pageNumber, warnings);
      return href === undefined ? text : `<a href="${htmlText(href)}">${text}</a>`;
    })
    .join("");
}

function plainElement(element: DocumentElement): string {
  switch (element.kind) {
    case "heading":
    case "paragraph":
    case "code":
    case "page-header":
    case "page-footer":
      return element.text;
    case "list":
      return element.items
        .map((item, index) =>
          item.marker === undefined
            ? `${element.ordered ? `${index + 1}.` : "•"} ${item.text}`
            : `${item.marker}${item.text}`,
        )
        .join("\n");
    case "table":
      return element.sourceText ?? element.rows.map((row) => row.join("\t")).join("\n");
    case "figure":
    case "page-break":
      return "";
  }
}

function markdownTable(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const cells = rows.map((row) =>
    Array.from({ length: width }, (_unused, index) =>
      markdownText(row[index] ?? "").replace(/\|/gu, "\\|").replace(/\n/gu, "<br>"),
    ),
  );
  const header = cells[0] ?? [];
  const body = cells.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function assetUrl(asset: ConversionAsset, mode: ConversionAssetMode): string {
  if (mode === "embedded") {
    return `data:${asset.mimeType};base64,${Buffer.from(asset.bytes).toString("base64")}`;
  }
  return encodeURI(asset.reference);
}

function missingAsset(
  element: Extract<DocumentElement, { kind: "figure" }>,
  warnings: ConversionWarning[],
): void {
  warnOnce(warnings, {
    code: "UNSUPPORTED_ASSET",
    message: `Figure "${element.id}" references missing asset "${element.assetId}".`,
    pageNumber: element.provenance.pageNumber,
  });
}

function markdownElement(element: DocumentElement, ctx: RenderContext): string {
  const pageNumber = element.provenance.pageNumber;
  switch (element.kind) {
    case "heading":
      return `${"#".repeat(element.level)} ${markdownRuns(element.runs, pageNumber, ctx.warnings)}`;
    case "paragraph":
      return markdownRuns(element.runs, pageNumber, ctx.warnings);
    case "code": {
      const fence = element.text.includes("```") ? "````" : "```";
      return `${fence}\n${element.text}\n${fence}`;
    }
    case "list":
      return element.items
        .map(
          (item, index) =>
            `${element.ordered ? `${index + 1}.` : "-"} ${markdownRuns(item.runs, pageNumber, ctx.warnings)}`,
        )
        .join("\n");
    case "table":
      return markdownTable(flattenHeaderRows(element));
    case "page-header":
    case "page-footer":
      return "";
    case "figure": {
      if (ctx.mode === "omit") return "";
      const asset = ctx.assets.get(element.assetId);
      if (asset === undefined) {
        missingAsset(element, ctx.warnings);
        return "";
      }
      const alt = markdownText(element.alt ?? asset.alt ?? "");
      const image = `![${alt}](${assetUrl(asset, ctx.mode)})`;
      return element.caption === undefined
        ? image
        : `${image}\n\n${markdownText(element.caption)}`;
    }
    case "page-break":
      return "";
  }
}

/** One element as Markdown, without assets or warnings. Figures and page furniture render as `""`. */
export function markdownBlock(element: DocumentElement): string {
  return markdownElement(element, { mode: "omit", assets: new Map(), warnings: [] });
}

function htmlElement(element: DocumentElement, ctx: RenderContext): string {
  const pageNumber = element.provenance.pageNumber;
  switch (element.kind) {
    case "heading":
      return `<h${element.level}>${htmlRuns(element.runs, pageNumber, ctx.warnings)}</h${element.level}>`;
    case "paragraph":
      return `<p>${htmlRuns(element.runs, pageNumber, ctx.warnings)}</p>`;
    case "code":
      return `<pre><code>${htmlText(element.text)}</code></pre>`;
    case "list": {
      const tag = element.ordered ? "ol" : "ul";
      const items = element.items
        .map((item) => `<li>${htmlRuns(item.runs, pageNumber, ctx.warnings)}</li>`)
        .join("\n");
      return `<${tag}>\n${items}\n</${tag}>`;
    }
    case "table": {
      const rows = element.rows.map((row, rowIndex) => {
        const tag = rowIndex < element.headerRows ? "th" : "td";
        return `<tr>${row.map((cell, colIndex) => {
          const anchor = anchorAt(element, rowIndex, colIndex);
          if (anchor.row !== rowIndex || anchor.col !== colIndex) return "";
          const span = element.spans?.find((item) => item.row === rowIndex && item.col === colIndex);
          const attributes = span === undefined
            ? ""
            : `${span.rowSpan > 1 ? ` rowspan="${span.rowSpan}"` : ""}${span.colSpan > 1 ? ` colspan="${span.colSpan}"` : ""}`;
          return `<${tag}${attributes}>${htmlText(cell)}</${tag}>`;
        }).join("")}</tr>`;
      });
      const head = rows.slice(0, element.headerRows);
      const body = rows.slice(element.headerRows);
      return `<table>${head.length === 0 ? "" : `<thead>${head.join("")}</thead>`}${body.length === 0 ? "" : `<tbody>${body.join("")}</tbody>`}</table>`;
    }
    case "figure": {
      if (ctx.mode === "omit") return "";
      const asset = ctx.assets.get(element.assetId);
      if (asset === undefined) {
        missingAsset(element, ctx.warnings);
        return "";
      }
      const alt = htmlText(element.alt ?? asset.alt ?? "");
      const caption = element.caption === undefined ? "" : `<figcaption>${htmlText(element.caption)}</figcaption>`;
      return `<figure><img src="${htmlText(assetUrl(asset, ctx.mode))}" alt="${alt}">${caption}</figure>`;
    }
    case "page-header":
    case "page-footer":
    case "page-break":
      return "";
  }
}

function nonEmpty(parts: readonly string[]): string[] {
  return parts.filter((part) => part.length > 0);
}

/** Export one normalized layout without changing its source text. */
export function exportDocument(
  document: LayoutDocument,
  format: Exclude<ConversionFormat, "json">,
  mode: ConversionAssetMode,
  assets: readonly ConversionAsset[],
): ExportedDocument {
  const warnings: ConversionWarning[] = [];
  const ctx: RenderContext = {
    mode,
    assets: new Map(assets.map((asset) => [asset.id, asset])),
    warnings,
  };

  if (format === "text") {
    const pages = document.pages.map((page) => ({
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      content: nonEmpty(page.elements.map(plainElement)).join("\n\n"),
      elements: page.elements,
    }));
    return {
      content: pages.map((page) => page.content).join("\f"),
      mimeType: "text/plain",
      pages,
      assets,
      warnings,
    };
  }

  if (format === "markdown") {
    const pages = document.pages.map((page) => ({
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      content: `<!-- page: ${page.pageNumber} -->${
        page.elements.length === 0
          ? ""
          : `\n\n${nonEmpty(page.elements.map((element) => markdownElement(element, ctx))).join("\n\n")}`
      }`,
      elements: page.elements,
    }));
    return {
      content: pages.map((page) => page.content).join("\n\n"),
      mimeType: "text/markdown",
      pages,
      assets,
      warnings,
    };
  }

  const pages = document.pages.map((page) => ({
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    content: `<section id="page-${page.pageNumber}" data-page-number="${page.pageNumber}">\n${nonEmpty(
      page.elements.map((element) => htmlElement(element, ctx)),
    ).join("\n")}\n</section>`,
    elements: page.elements,
  }));
  const title = htmlText(document.metadata?.title ?? "Converted document");
  return {
    content: `<!doctype html>\n<html lang="${htmlText(document.metadata?.language ?? "en")}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n</head>\n<body>\n${pages.map((page) => page.content).join("\n")}\n</body>\n</html>\n`,
    mimeType: "text/html",
    pages,
    assets,
    warnings,
  };
}
