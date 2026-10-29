import { MissingEngineError, type LayoutBox } from "docture";
import type { FieldLabel, PageInfo, SyntheticDocument } from "../document.js";
import { checkDrawn } from "../drawn.js";
import { TemplateError, type TemplateProblem } from "../errors.js";
import { formatter } from "../format.js";
import { project } from "../mask.js";
import type { Sample } from "../model.js";
import type { At, Surface, SynthTemplate, Template, TextStyle } from "../template.js";

/** Supported optional engine of this entry. */
export const ENGINE_RANGES = { pdfkit: ">=0.17.2 <0.21.0" } as const;

export interface RenderPdfOptions {
  /** Written as the PDF's creation and modification date. Fixed by default so equal inputs give equal bytes. */
  readonly createdAt?: string;
  readonly producer?: string;
  readonly creator?: string;
  readonly title?: string;
  /** Deflate content streams. Default `true`. */
  readonly compress?: boolean;
}

interface PdfFont {
  readonly font: { characterToGlyph?(code: number): string; glyphForCodePoint?(codePoint: number): { readonly id: number } };
}

interface PdfDocument {
  _font: PdfFont;
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
  addPage(options: { size: [number, number]; margin: number }): void;
  registerFont(name: string, source: string | Uint8Array): void;
  font(name: string): PdfDocument;
  fontSize(size: number): PdfDocument;
  fillColor(color: string): PdfDocument;
  strokeColor(color: string): PdfDocument;
  lineWidth(width: number): PdfDocument;
  text(text: string, x: number, y: number, options: Record<string, unknown>): PdfDocument;
  widthOfString(text: string): number;
  heightOfString(text: string, options: Record<string, unknown>): number;
  currentLineHeight(includeGap?: boolean): number;
  moveTo(x: number, y: number): PdfDocument;
  lineTo(x: number, y: number): PdfDocument;
  stroke(): PdfDocument;
  rect(x: number, y: number, width: number, height: number): PdfDocument;
  fill(color?: string): PdfDocument;
  image(source: Uint8Array, x: number, y: number, options: Record<string, unknown>): PdfDocument;
  end(): void;
}

type PdfDocumentClass = new (options: Record<string, unknown>) => PdfDocument;

async function loadPdfKit(): Promise<PdfDocumentClass> {
  try {
    const module = (await import("pdfkit")) as unknown as { default: PdfDocumentClass };
    return module.default;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND" && /^Cannot find package 'pdfkit' imported from /u.test(error.message)) {
      throw new MissingEngineError("pdfkit", ENGINE_RANGES.pdfkit, "@docture/synthetic/pdfkit", { cause: error });
    }
    throw error;
  }
}

const FIXED_DATE = "2000-01-01T00:00:00Z";

/**
 * Render any synthesis template: a PDFKit `Template` with `renderPdf`, and a `RenderingTemplate`,
 * such as a React template, with its own renderer. Only `createdAt` reaches a rendering template.
 */
export async function renderTemplate<T>(template: SynthTemplate<T>, sample: Sample<T>, options: RenderPdfOptions = {}): Promise<SyntheticDocument> {
  if ("draw" in template) return renderPdf(template, sample, options);
  return template.renderDocument(sample, options.createdAt === undefined ? {} : { createdAt: options.createdAt });
}

/**
 * Render `sample` with `template` into a PDF and label every printed field with its page and box.
 * Fails with `TemplateError` when the drawing and the printed mask disagree, or a font lacks a glyph.
 */
export async function renderPdf<T>(template: Template<T>, sample: Sample<T>, options: RenderPdfOptions = {}): Promise<SyntheticDocument> {
  const PDFDocument = await loadPdfKit();
  const { expected, leaves } = project(template.printed, sample.value);
  const createdAt = new Date(options.createdAt ?? FIXED_DATE);
  const doc = new PDFDocument({
    autoFirstPage: false,
    compress: options.compress ?? true,
    info: {
      Title: options.title ?? `${template.key} ${sample.scenario} ${sample.seed}`,
      Producer: options.producer ?? "@docture/synthetic",
      Creator: options.creator ?? template.key,
      CreationDate: createdAt,
      ModDate: createdAt,
    },
  });
  const chunks: Uint8Array[] = [];
  const done = new Promise<void>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", resolve);
    doc.on("error", reject);
  });
  for (const [name, source] of Object.entries(template.fonts)) doc.registerFont(name, source);

  const problems: TemplateProblem[] = [];
  const labels: FieldLabel[] = [];
  const pages: PageInfo[] = [];
  const { width, height } = template.page.size;

  const apply = (style: TextStyle): void => {
    doc.font(style.font ?? "regular").fontSize(style.size ?? 10).fillColor(style.color ?? "#000000");
  };
  const missingGlyphs = (text: string): string[] => {
    const { font } = doc._font;
    const missing = new Set<string>();
    for (const char of text) {
      const code = char.codePointAt(0) as number;
      if (char === "\n") continue;
      const absent = font.characterToGlyph !== undefined ? font.characterToGlyph(code) === ".notdef" : font.glyphForCodePoint?.(code).id === 0;
      if (absent) missing.add(char);
    }
    return [...missing];
  };
  const measure = (text: string, style: TextStyle): { width: number; height: number } => {
    apply(style);
    const lines = text.split("\n");
    const natural = Math.max(...lines.map((line) => doc.widthOfString(line)));
    if (style.width === undefined || natural <= style.width) {
      return { width: natural, height: (lines.length - 1) * (doc.currentLineHeight(true) + (style.lineGap ?? 0)) + doc.currentLineHeight(false) };
    }
    return { width: style.width, height: doc.heightOfString(text, { width: style.width, lineGap: style.lineGap ?? 0 }) };
  };
  const draw = (text: string, at: At, owner: string): LayoutBox => {
    apply(at);
    const missing = missingGlyphs(text);
    if (missing.length > 0) {
      problems.push({ code: "missing-glyph", path: owner, message: `font "${at.font ?? "regular"}" cannot draw ${missing.map((char) => `"${char}" (U+${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")})`).join(", ")}` });
    }
    const size = measure(text, at);
    const align = at.align ?? "left";
    let x = at.x;
    if (at.width !== undefined) {
      if (size.width < at.width && align !== "left") x = align === "right" ? at.x + at.width - size.width : at.x + (at.width - size.width) / 2;
      doc.text(text, at.x, at.y, { width: at.width, align, lineGap: at.lineGap ?? 0, lineBreak: true });
    } else {
      if (align !== "left") x = align === "right" ? at.x - size.width : at.x - size.width / 2;
      // Without wrapping PDFKit drops "\n" and runs the lines together, so each line is drawn on its own.
      const advance = doc.currentLineHeight(true) + (at.lineGap ?? 0);
      text.split("\n").forEach((line, index) => {
        const offset = align === "left" ? 0 : (size.width - doc.widthOfString(line)) / (align === "right" ? 1 : 2);
        doc.text(line, x + offset, at.y + index * advance, { lineBreak: false });
      });
    }
    return { x, y: at.y, width: size.width, height: size.height };
  };

  let pageNumber = 0;
  const addPage = (): void => {
    doc.addPage({ size: [width, height], margin: 0 });
    pageNumber += 1;
    pages.push({ pageNumber, width, height });
  };
  addPage();
  const surface: Surface<T> = {
    get pageNumber() {
      return pageNumber;
    },
    size: template.page.size,
    text: (text, at) => draw(text, at, "(text)"),
    field(path, text, at) {
      const paths: readonly string[] = typeof path === "string" ? [path] : path;
      const box = draw(text, at, paths.join(", "));
      for (const one of paths) labels.push({ path: one, value: leaves.get(one), text, pageNumber, box });
      return box;
    },
    rule(from, to, style = {}) {
      doc.lineWidth(style.width ?? 1).strokeColor(style.color ?? "#000000").moveTo(from.x, from.y).lineTo(to.x, to.y).stroke();
    },
    rect(box, style = {}) {
      if (style.fill !== undefined) doc.rect(box.x, box.y, box.width, box.height).fill(style.fill);
      if (style.stroke !== undefined || style.fill === undefined) {
        doc.lineWidth(style.width ?? 1).strokeColor(style.stroke ?? "#000000").rect(box.x, box.y, box.width, box.height).stroke();
      }
    },
    image(bytes, box) {
      doc.image(Buffer.from(bytes), box.x, box.y, { width: box.width, height: box.height });
    },
    measure: (text, style = {}) => measure(text, style),
    addPage,
  };

  try {
    template.draw(surface, sample.value, formatter(template.locale));
  } catch (cause) {
    doc.end();
    await done.catch(() => undefined);
    throw new TemplateError(template.key, [{ code: "invalid-template", path: "", message: cause instanceof Error ? cause.message : String(cause) }], { cause });
  }
  problems.push(...checkDrawn(leaves, labels));
  doc.end();
  await done;
  if (problems.length > 0) throw new TemplateError(template.key, problems);

  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    bytes,
    mimeType: "application/pdf",
    pages,
    expected,
    labels,
    sample: { seed: sample.seed, scenario: sample.scenario, tags: sample.tags },
    template: { key: template.key, family: template.family, tags: { ...template.tags, locale: template.locale.code } },
    rendition: { kind: "digital" },
    provenance: { renderer: "pdfkit", createdAt: createdAt.toISOString(), compress: options.compress ?? true },
  };
}
