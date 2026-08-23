/**
 * `PdfJsLoader` — read a PDF's text layer, with positions, using Mozilla's PDF.js.
 *
 * The library is in the class name on purpose. Swapping to MuPDF is
 * `new MuPdfLoader()`, and the conformance suite both classes pass is what makes
 * that a guarantee rather than a hope.
 *
 * This loader does NOT render pages — that is a rasterizer's job. Compose them when
 * you need both:
 *
 * ```ts
 * withRasterizer(new PdfJsLoader(), new NapiCanvasRasterizer())
 * ```
 */

import {
  inferForm,
  linesFromWords,
  textFromLines,
  type DocumentLoader,
  type DocumentMetadata,
  type ImageLayoutBlock,
  type LayoutBlock,
  type LayoutRoleHint,
  type LoadContext,
  type LoadedAsset,
  type LoadedDocument,
  type LoadedPage,
  type LoaderCapabilities,
  type PositionedWord,
  type RawDocument,
  type TextLine,
} from "@docture/core";
import {
  loadPdfJs,
  type PdfJsImageData,
  type PdfJsMarkedContent,
  type PdfJsPage,
  type PdfJsTextItem,
  type PdfJsStructTree,
  type PdfJsViewport,
} from "./pdfjs.js";
import { pngFromPdfJsImage } from "./png.js";

export interface PdfJsLoaderOptions {
  /** Password for an encrypted PDF. */
  readonly password?: string;
  /** Stop after this many pages. Useful for a cheap classification pass. */
  readonly maxPages?: number;
  /**
   * Vertical band tolerance for grouping text runs into lines, as a fraction of
   * median run height. Raise it for loose leading, lower it for dense tables.
   */
  readonly lineTolerance?: number;
}

/** pdf.js emits `TextMarkedContent` entries too; only items with `str` are text. */
function isTextItem(item: PdfJsTextItem | PdfJsMarkedContent): item is PdfJsTextItem & {
  str: string;
  transform: readonly number[];
} {
  return "str" in item && typeof item.str === "string" && Array.isArray(item.transform);
}

function isMarkedContent(item: PdfJsTextItem | PdfJsMarkedContent): item is PdfJsMarkedContent {
  return "type" in item && typeof item.type === "string";
}

export class PdfJsLoader implements DocumentLoader<LoaderCapabilities<true, true, false>> {
  readonly name = "pdfjs";

  readonly capabilities = {
    text: true,
    geometry: true,
    images: false,
    mimeTypes: ["application/pdf"],
  } as const;

  constructor(private readonly options: PdfJsLoaderOptions = {}) {}

  async load(document: RawDocument, ctx: LoadContext): Promise<LoadedDocument> {
    ctx.signal.throwIfAborted();
    const { pdfjs, standardFontDataUrl } = await loadPdfJs();

    const task = pdfjs.getDocument({
      // pdf.js takes ownership of the buffer it is given, so hand it a copy —
      // otherwise the caller's bytes come back detached and a second loader in the
      // fallback chain receives an empty array.
      data: new Uint8Array(document.bytes),
      standardFontDataUrl,
      isEvalSupported: false,
      // Fonts installed on the host would make extraction machine-dependent.
      useSystemFonts: false,
      ...(this.options.password === undefined ? {} : { password: this.options.password }),
    });

    let pdf;
    try {
      pdf = await task.promise;
    } catch (error) {
      await task.destroy().catch(() => {});
      throw new Error(`pdfjs could not open the document: ${describe(error)}`, { cause: error });
    }

    try {
      const limit = Math.min(pdf.numPages, this.options.maxPages ?? pdf.numPages);
      const pages: LoadedPage[] = [];

      for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
        ctx.signal.throwIfAborted();
        const page = await pdf.getPage(pageNumber);
        try {
          pages.push(await this.readPage(pdfjs, page, pageNumber, ctx));
        } finally {
          page.cleanup();
        }
      }

      const documentMetadata =
        ctx.request?.layout === true
          ? await pdf.getMetadata().then(metadataFrom).catch(() => undefined)
          : undefined;
      const tagged =
        ctx.request?.layout === true
          ? await pdf.getMarkInfo().then((info) => info?.Marked === true).catch(() => false)
          : false;

      return {
        pages,
        // Form feed between pages: a page break is not a line break, and a parser
        // looking for a page boundary should be able to find one.
        text: pages.map((p) => p.text).join("\f"),
        form: inferForm(pages.map((p) => p.text.trim().length)),
        loader: this.name,
        ...(documentMetadata === undefined ? {} : { metadata: documentMetadata }),
        meta: { pageCount: pdf.numPages, pagesRead: pages.length, ...(tagged ? { tagged } : {}) },
      };
    } finally {
      // Frees the worker and the parsed document. Without it a long batch leaks.
      await task.destroy().catch(() => {});
    }
  }

  private async readPage(
    pdfjs: Awaited<ReturnType<typeof loadPdfJs>>["pdfjs"],
    page: PdfJsPage,
    pageNumber: number,
    ctx: LoadContext,
  ): Promise<LoadedPage> {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent(
      ctx.request?.layout === true
        ? { includeMarkedContent: true, disableNormalization: true }
        : { disableNormalization: true },
    );
    const taggedRoles =
      ctx.request?.layout === true
        ? await page.getStructTree().then(rolesFromTree).catch(() => new Map())
        : new Map<string, TaggedRole>();
    const links =
      ctx.request?.layout === true
        ? await page.getAnnotations().then((annotations) => linksFrom(annotations, viewport))
        : [];

    const words: PositionedWord[] = [];
    const taggedAreas: TaggedArea[] = [];
    const activeTags: (TaggedRole | undefined)[] = [];
    for (const item of content.items) {
      if (isMarkedContent(item)) {
        if (item.type === "endMarkedContent") activeTags.pop();
        else if (item.type.startsWith("beginMarkedContent")) {
          activeTags.push(item.id === undefined ? undefined : taggedRoles.get(item.id));
        }
        continue;
      }
      if (!isTextItem(item) || item.str.trim() === "") continue;

      // `viewport.transform` maps PDF user space (bottom-left origin) into device
      // space (top-left origin), which is the convention this library standardises
      // on. Composing it with the item's own matrix is the only correct way to get
      // there — reading `transform[4]`/`[5]` raw ignores page rotation.
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      const x = tx[4] ?? 0;
      const baseline = tx[5] ?? 0;
      // Scaled font size, from the matrix's vertical component.
      const fontHeight = Math.hypot(tx[2] ?? 0, tx[3] ?? 0) || (item.height ?? 0);
      const width = item.width ?? 0;
      const box = [x, baseline - fontHeight, x + width, baseline] as const;
      const family =
        item.fontName === undefined ? undefined : content.styles[item.fontName]?.fontFamily;
      const href = links.find((link) => intersects(box, link.box))?.href;
      const tagged = [...activeTags].reverse().find((value) => value !== undefined);
      if (tagged !== undefined) taggedAreas.push({ box, ...tagged });
      const direction =
        item.dir === "ltr" || item.dir === "rtl" || item.dir === "ttb" ? item.dir : undefined;

      words.push({
        text: item.str,
        // Baseline minus font height is the top edge, near enough for banding —
        // and exact relative ordering is all line grouping needs.
        box,
        ...(direction === undefined ? {} : { direction }),
        style: {
          ...(family === undefined ? {} : { fontFamily: family }),
          fontSize: fontHeight,
          ...(family === undefined
            ? {}
            : {
                bold: /(?:bold|black|heavy|semibold)/iu.test(family),
                italic: /(?:italic|oblique)/iu.test(family),
                monospace: /(?:mono|courier|consolas|menlo)/iu.test(family),
              }),
        },
        ...(href === undefined ? {} : { href }),
      });
    }

    const lines = linesFromWords(words, {
      ...(this.options.lineTolerance === undefined
        ? {}
        : { lineTolerance: this.options.lineTolerance }),
    });

    const richImages =
      ctx.request?.layout === true
        ? await imagesFrom(pdfjs, page, viewport, pageNumber, ctx.request?.assets === true)
        : { blocks: [], assets: [] };
    const blocks: LayoutBlock[] = [
      ...lines.map((line, index) => {
        const tagged = tagForLine(line, taggedAreas);
        return {
          id: `p${pageNumber}-text-${index + 1}`,
          kind: "text" as const,
          ...boxFromLine(line),
          lines: [line],
          ...(tagged?.role === undefined ? {} : { role: tagged.role }),
          ...(tagged?.level === undefined ? {} : { level: tagged.level }),
        };
      }),
      ...richImages.blocks,
    ];

    return {
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      text: textFromLines(lines),
      lines,
      ...(ctx.request?.layout === true ? { blocks } : {}),
      ...(ctx.request?.assets === true ? { assets: richImages.assets } : {}),
    };
  }
}

interface LinkArea {
  readonly box: readonly [number, number, number, number];
  readonly href: string;
}

interface TaggedRole {
  readonly role?: LayoutRoleHint;
  readonly level?: number;
}

interface TaggedArea extends TaggedRole {
  readonly box: readonly [number, number, number, number];
}

function normalizedRole(value: string): TaggedRole {
  const role = value.toLowerCase();
  const heading = /^h([1-6])$/u.exec(role);
  if (heading !== null) return { role: "heading", level: Number(heading[1]) };
  if (role === "p" || role === "paragraph") return { role: "paragraph" };
  if (role === "li" || role === "lbl" || role === "lbody") return { role: "list-item" };
  if (role === "table" || role === "tr" || role === "th" || role === "td") return { role: "table" };
  if (role === "code") return { role: "code" };
  if (role === "figure") return { role: "figure" };
  if (role === "header") return { role: "header" };
  if (role === "footer") return { role: "footer" };
  return {};
}

function rolesFromTree(tree: PdfJsStructTree | null): Map<string, TaggedRole> {
  const roles = new Map<string, TaggedRole>();
  const visit = (node: PdfJsStructTree, inherited: TaggedRole): void => {
    const own = normalizedRole(node.role);
    const role = own.role === undefined ? inherited : own;
    for (const child of node.children) {
      if ("role" in child) visit(child, role);
      else if (role.role !== undefined) roles.set(child.id, role);
    }
  };
  if (tree !== null) visit(tree, {});
  return roles;
}

function tagForLine(line: TextLine, areas: readonly TaggedArea[]): TaggedRole | undefined {
  const counts = new Map<string, { tagged: TaggedRole; count: number }>();
  for (const span of line.spans) {
    const box = [span.x, span.y, span.x + span.width, span.y + span.height] as const;
    const area = areas.find((candidate) => intersects(box, candidate.box));
    if (area?.role === undefined) continue;
    const key = `${area.role}:${area.level ?? ""}`;
    const current = counts.get(key);
    counts.set(key, { tagged: area, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.tagged;
}

function linksFrom(
  annotations: readonly Readonly<Record<string, unknown>>[],
  viewport: PdfJsViewport,
): LinkArea[] {
  return annotations.flatMap((annotation) => {
    if (annotation.subtype !== "Link" || !Array.isArray(annotation.rect)) return [];
    const href =
      typeof annotation.url === "string"
        ? annotation.url
        : typeof annotation.unsafeUrl === "string"
          ? annotation.unsafeUrl
          : undefined;
    if (href === undefined) return [];
    const rect = annotation.rect.filter((value): value is number => typeof value === "number");
    if (rect.length < 4) return [];
    const first = viewport.convertToViewportPoint(rect[0] ?? 0, rect[1] ?? 0);
    const second = viewport.convertToViewportPoint(rect[2] ?? 0, rect[3] ?? 0);
    const transformed = [first[0] ?? 0, first[1] ?? 0, second[0] ?? 0, second[1] ?? 0];
    return [
      {
        box: [
          Math.min(transformed[0] ?? 0, transformed[2] ?? 0),
          Math.min(transformed[1] ?? 0, transformed[3] ?? 0),
          Math.max(transformed[0] ?? 0, transformed[2] ?? 0),
          Math.max(transformed[1] ?? 0, transformed[3] ?? 0),
        ] as const,
        href,
      },
    ];
  });
}

function intersects(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function boxFromLine(line: TextLine): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const x = line.spans.length === 0 ? 0 : Math.min(...line.spans.map((span) => span.x));
  const right =
    line.spans.length === 0
      ? 0
      : Math.max(...line.spans.map((span) => span.x + span.width));
  return { x, y: line.y, width: right - x, height: line.height };
}

interface PageImages {
  readonly blocks: readonly ImageLayoutBlock[];
  readonly assets: readonly LoadedAsset[];
}

async function imageObject(page: PdfJsPage, id: string): Promise<PdfJsImageData | undefined> {
  try {
    const immediate = page.objs.get(id);
    if (immediate != null) return immediate;
  } catch {
    // The callback form below waits for an operator-list dependency still in flight.
  }
  return new Promise((resolve) => {
    try {
      const immediate = page.objs.get(id, (value) => resolve(value ?? undefined));
      if (immediate != null) resolve(immediate);
    } catch {
      resolve(undefined);
    }
  });
}

function unitBox(
  pdfjs: Awaited<ReturnType<typeof loadPdfJs>>["pdfjs"],
  viewport: PdfJsViewport,
  transform: readonly number[],
): { x: number; y: number; width: number; height: number } {
  const matrix = pdfjs.Util.transform(viewport.transform, transform);
  const point = (x: number, y: number): readonly [number, number] => [
    (matrix[0] ?? 1) * x + (matrix[2] ?? 0) * y + (matrix[4] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[3] ?? 1) * y + (matrix[5] ?? 0),
  ];
  const points = [point(0, 0), point(1, 0), point(0, 1), point(1, 1)];
  const x = Math.min(...points.map((value) => value[0]));
  const y = Math.min(...points.map((value) => value[1]));
  const right = Math.max(...points.map((value) => value[0]));
  const bottom = Math.max(...points.map((value) => value[1]));
  return { x, y, width: right - x, height: bottom - y };
}

async function imagesFrom(
  pdfjs: Awaited<ReturnType<typeof loadPdfJs>>["pdfjs"],
  page: PdfJsPage,
  viewport: PdfJsViewport,
  pageNumber: number,
  includeAssets: boolean,
): Promise<PageImages> {
  const operators = await page.getOperatorList();
  const blocks: ImageLayoutBlock[] = [];
  const assets: LoadedAsset[] = [];
  const stack: number[][] = [];
  let transform = [1, 0, 0, 1, 0, 0];

  for (const [index, operation] of operators.fnArray.entries()) {
    const args = operators.argsArray[index] ?? [];
    if (operation === pdfjs.OPS.save) {
      stack.push([...transform]);
      continue;
    }
    if (operation === pdfjs.OPS.restore) {
      transform = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (operation === pdfjs.OPS.transform) {
      const matrix = args.filter((value): value is number => typeof value === "number");
      if (matrix.length >= 6) transform = pdfjs.Util.transform(transform, matrix);
      continue;
    }

    const isObject = operation === pdfjs.OPS.paintImageXObject;
    const isInline = operation === pdfjs.OPS.paintInlineImageXObject;
    if (!isObject && !isInline) continue;

    const number = blocks.length + 1;
    const id = `p${pageNumber}-image-${number}`;
    const box = unitBox(pdfjs, viewport, transform);
    blocks.push({ id, kind: "image", assetId: id, ...box });
    if (!includeAssets) continue;

    const image = isInline
      ? (args[0] as PdfJsImageData | null | undefined)
      : typeof args[0] === "string"
        ? await imageObject(page, args[0])
        : undefined;
    if (image == null) continue;
    const bytes = pngFromPdfJsImage(image, pdfjs.ImageKind);
    if (bytes === undefined) continue;
    assets.push({
      id,
      pageNumber,
      name: `${id}.png`,
      mimeType: "image/png",
      bytes,
      ...box,
      widthPx: image.width,
      heightPx: image.height,
    });
  }
  return { blocks, assets };
}

function metadataFrom(value: { info: Readonly<Record<string, unknown>> }): DocumentMetadata | undefined {
  const text = (key: string): string | undefined =>
    typeof value.info[key] === "string" && value.info[key] !== "" ? value.info[key] as string : undefined;
  const title = text("Title");
  const author = text("Author");
  const subject = text("Subject");
  const rawKeywords = text("Keywords");
  const language = text("Language");
  if (
    title === undefined &&
    author === undefined &&
    subject === undefined &&
    rawKeywords === undefined &&
    language === undefined
  ) {
    return undefined;
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(author === undefined ? {} : { author }),
    ...(subject === undefined ? {} : { subject }),
    ...(rawKeywords === undefined
      ? {}
      : { keywords: rawKeywords.split(/[,;]/u).map((keyword) => keyword.trim()).filter(Boolean) }),
    ...(language === undefined ? {} : { language }),
  };
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
