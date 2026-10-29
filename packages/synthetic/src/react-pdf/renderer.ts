import { MissingEngineError, type LayoutBox } from "docture";
import type { DocumentProps, TextProps } from "@react-pdf/renderer";
import type { ReactElement, ReactNode } from "react";
import type { FieldLabel, PageInfo, SyntheticDocument } from "../document.js";
import { checkDrawn } from "../drawn.js";
import { TemplateError, type TemplateProblem } from "../errors.js";
import { formatter, type Formatter, type Locale } from "../format.js";
import { project, type PrintedMask } from "../mask.js";
import type { Sample } from "../model.js";
import type { ConcretePath } from "../path.js";
import type { FontSource, RenderingTemplate, TagValue } from "../template.js";

/** Supported optional engines of this entry. */
export const ENGINE_RANGES = { react: ">=18.3.1 <20.0.0", "@react-pdf/renderer": "4.9.0" } as const;

const ENTRY = "@docture/synthetic/react-pdf";

/** The concrete paths a `<Field>` labels: one path, or several that print as the same text. Untyped templates accept any string. */
export type FieldPath<T> = unknown extends T ? string | readonly string[] : ConcretePath<T> | readonly ConcretePath<T>[];

/** The props of `<Field>`: every react-pdf `<Text>` prop except `render`, plus the path it labels. */
export type FieldProps<T> = Omit<TextProps, "render"> & {
  readonly path: FieldPath<T>;
  readonly children?: ReactNode;
};

/** `<Field>` typed for the values of one template. Pass it to components that print fields. */
export type FieldComponent<T> = (props: FieldProps<T>) => ReactElement;

/** What a React template's `render` receives. */
export interface ReactTemplateProps<T> {
  readonly value: T;
  /** Locale formatting for the template's locale. */
  readonly format: Formatter;
  /** `<Field>` with `path` typed for `T`. */
  readonly Field: FieldComponent<T>;
}

/** A font face the template draws with, registered with react-pdf before rendering. */
export interface ReactFont {
  /** The `fontFamily` styles name. Families are process-wide in react-pdf, so give each distinct face set its own name. */
  readonly family: string;
  /** A standard PDF font name, a file path, a URL, a data URL, or the font bytes. */
  readonly src: FontSource;
  readonly fontWeight?: number;
  readonly fontStyle?: "normal" | "italic" | "oblique";
}

/**
 * A template drawn with React and `@react-pdf/renderer`. `render` returns one or more `<Page>`
 * elements; the renderer supplies the `<Document>`. Every printed field is a `<Field path>`,
 * labeled with the box of its laid-out text.
 */
export interface ReactTemplate<T> extends RenderingTemplate<T> {
  readonly fonts: readonly ReactFont[];
  render(props: ReactTemplateProps<T>): ReactNode | Promise<ReactNode>;
}

export interface ReactTemplateDefinition<T> {
  readonly key: string;
  readonly aliases?: readonly string[];
  readonly family: string;
  readonly tags?: Readonly<Record<string, TagValue>>;
  readonly locale: Locale;
  readonly printed: PrintedMask<T>;
  readonly fonts?: readonly ReactFont[];
  /** Return `<Page>` elements. It may be async, to prepare images such as QR codes before layout. */
  render(props: ReactTemplateProps<T>): ReactNode | Promise<ReactNode>;
}

export interface RenderReactPdfOptions {
  /** Written as the PDF's creation and modification date. Fixed by default so equal inputs give equal bytes. */
  readonly createdAt?: string;
  readonly producer?: string;
  readonly creator?: string;
  readonly title?: string;
}

/** Define a React template for values of type `T`: `defineReactTemplate<Invoice>()({ … })`. */
export function defineReactTemplate<T>(): (definition: ReactTemplateDefinition<T>) => ReactTemplate<T> {
  return (definition) => {
    const template: ReactTemplate<T> = {
      key: definition.key,
      aliases: definition.aliases ?? [],
      family: definition.family,
      tags: definition.tags ?? {},
      locale: definition.locale,
      printed: definition.printed,
      fonts: definition.fonts ?? [],
      render: definition.render,
      renderDocument: (sample, options) => renderReactPdf(template, sample, options),
    };
    return template;
  };
}

type ReactModule = typeof import("react");
type RendererModule = typeof import("@react-pdf/renderer");

interface Engines {
  readonly react: ReactModule;
  readonly renderer: RendererModule;
}

let loaded: Engines | undefined;

async function engine<T>(name: keyof typeof ENGINE_RANGES, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND" && error.message.startsWith(`Cannot find package '${name}' imported from `)) {
      throw new MissingEngineError(name, ENGINE_RANGES[name], ENTRY, { cause: error });
    }
    throw error;
  }
}

async function loadEngines(): Promise<Engines> {
  const react = await engine("react", async () => {
    const module = await import("react");
    return (module as { default?: ReactModule }).default ?? module;
  });
  const renderer = await engine("@react-pdf/renderer", () => import("@react-pdf/renderer"));
  loaded = { react, renderer };
  return loaded;
}

/** The layout prop that carries a field's paths from `<Field>` to the laid-out text node. */
const FIELD_PROP = "data-docture-field";
const keepWords = (word: string): string[] => [word];

/**
 * Print a field: a react-pdf `<Text>` whose laid-out lines become the label box. Words do not
 * hyphenate unless `hyphenationCallback` says so, so the label text matches the value.
 * Renders only during `renderReactPdf`, which loads React and react-pdf.
 */
export function Field<T = unknown>(props: FieldProps<T>): ReactElement {
  if (loaded === undefined) throw new Error(`<Field> renders inside renderReactPdf from ${ENTRY}, which loads React and @react-pdf/renderer`);
  const { path, children, ...text } = props;
  const paths: readonly string[] = typeof path === "string" ? [path] : path;
  const marked: TextProps = { hyphenationCallback: keepWords, ...text, ...{ [FIELD_PROP]: paths } };
  return loaded.react.createElement(loaded.renderer.Text, marked, children);
}

const FIXED_DATE = "2000-01-01T00:00:00Z";
const PRODUCER = "@docture/synthetic";
/** Layout rounding tolerance before a field counts as outside its page. */
const SLACK = 0.5;
/** The standard PDF font families react-pdf draws without registration. */
const STANDARD_FONTS = new Set(["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique", "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique", "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Symbol", "ZapfDingbats"]);
/** Hebrew, Arabic, Syriac, Thaana, NKo and their presentation forms. */
const RIGHT_TO_LEFT = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/u;

/**
 * Render `sample` with a React template, lay it out with react-pdf, and label every `<Field>` with
 * the page and box of its laid-out text. Equal inputs give equal bytes on one installed set of
 * react-pdf packages; `@react-pdf/renderer` takes its layout and font packages by caret range.
 * Fails with `TemplateError` when the fields and the printed mask disagree, a font lacks a glyph,
 * or a field cannot be boxed.
 */
export async function renderReactPdf<T>(template: ReactTemplate<T>, sample: Sample<T>, options: RenderReactPdfOptions = {}): Promise<SyntheticDocument> {
  const createdAt = new Date(options.createdAt ?? FIXED_DATE);
  if (Number.isNaN(createdAt.getTime())) throw new RangeError(`createdAt "${options.createdAt}" is not a date`);
  const { react, renderer } = await loadEngines();
  const invalid = (cause: unknown, message = cause instanceof Error ? cause.message : String(cause)): TemplateError =>
    new TemplateError(template.key, [{ code: "invalid-template", path: "", message }], { cause });

  const fontProblem = registerFonts(renderer.Font, template.fonts);
  if (fontProblem !== undefined) throw new TemplateError(template.key, [fontProblem]);
  const { expected, leaves } = project(template.printed, sample.value);
  let pages: ReactNode;
  try {
    pages = await template.render({ value: sample.value, format: formatter(template.locale), Field: Field<T> });
  } catch (cause) {
    throw invalid(cause);
  }
  if (react.Children.toArray(pages).some((page) => react.isValidElement(page) && page.type === renderer.Document)) {
    throw invalid(undefined, "returns a <Document>; return <Page> elements and renderReactPdf supplies the document");
  }

  let layout: LayoutNode | undefined;
  const document: ReactElement<DocumentProps> = react.createElement(
    renderer.Document,
    {
      title: options.title ?? `${template.key} ${sample.scenario} ${sample.seed}`,
      producer: options.producer ?? PRODUCER,
      creator: options.creator ?? template.key,
      language: template.locale.code,
      creationDate: createdAt,
      modificationDate: createdAt,
      // react-pdf hands the layout it rendered to onRender; labels read that same layout.
      onRender: (rendered) => {
        layout = (rendered as { readonly _INTERNAL__LAYOUT__DATA_?: LayoutNode })._INTERNAL__LAYOUT__DATA_;
      },
    },
    pages,
  );
  let bytes: Uint8Array;
  try {
    bytes = await streamBytes((await renderer.pdf(document).toBuffer()) as unknown as ByteStream);
  } catch (cause) {
    throw invalid(cause);
  }
  if (layout === undefined) {
    throw new Error(`@react-pdf/renderer ${renderer.version} did not report its layout; ${ENTRY} supports ${ENGINE_RANGES["@react-pdf/renderer"]}`);
  }

  const read = readLayout(layout, leaves, new Set(template.fonts.map((font) => font.family)));
  const problems = [...read.problems, ...checkDrawn(leaves, read.labels)];
  if (problems.length > 0) throw new TemplateError(template.key, problems);
  return {
    bytes,
    mimeType: "application/pdf",
    pages: read.pages,
    expected,
    labels: read.labels,
    sample: { seed: sample.seed, scenario: sample.scenario, tags: sample.tags },
    template: { key: template.key, family: template.family, tags: { ...template.tags, locale: template.locale.code } },
    rendition: { kind: "digital" },
    provenance: { renderer: "react-pdf", reactPdf: renderer.version, react: react.version, createdAt: createdAt.toISOString() },
  };
}

interface ByteStream {
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
}

function streamBytes(stream: ByteStream): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => {
      const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(bytes);
    });
  });
}

type FontStore = RendererModule["Font"];

/** Families this entry registered, so each registers once and a conflicting redefinition is reported. */
const registered = new Map<string, readonly ReactFont[]>();

function registerFonts(store: FontStore, fonts: readonly ReactFont[]): TemplateProblem | undefined {
  const families = new Map<string, ReactFont[]>();
  for (const font of fonts) families.set(font.family, [...(families.get(font.family) ?? []), font]);
  for (const [family, faces] of families) {
    const known = registered.get(family);
    if (known !== undefined) {
      if (sameFaces(known, faces)) continue;
      return { code: "invalid-template", path: "", message: `registers font family "${family}" with other faces than an earlier template; react-pdf font families are process-wide, so give each face set its own family name` };
    }
    if (store.getRegisteredFontFamilies().includes(family)) {
      return { code: "invalid-template", path: "", message: `registers font family "${family}", which react-pdf already has as a standard font or from Font.register; give the template's faces their own family name` };
    }
    store.register({
      family,
      fonts: faces.map((face) => ({
        src: typeof face.src === "string" ? face.src : dataUrl(face.src),
        ...(face.fontWeight === undefined ? {} : { fontWeight: face.fontWeight }),
        ...(face.fontStyle === undefined ? {} : { fontStyle: face.fontStyle }),
      })),
    });
    registered.set(family, faces);
  }
  return undefined;
}

function sameFaces(a: readonly ReactFont[], b: readonly ReactFont[]): boolean {
  return a.length === b.length && a.every((face, index) => {
    const other = b[index] as ReactFont;
    return face.fontWeight === other.fontWeight && face.fontStyle === other.fontStyle && sameSource(face.src, other.src);
  });
}

function sameSource(a: FontSource, b: FontSource): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a === b || (a.length === b.length && a.every((byte, index) => byte === b[index]));
}

function dataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:font/ttf;base64,${btoa(binary)}`;
}

/** The parts of react-pdf's laid-out tree this entry reads. */
interface LayoutNode {
  readonly type?: string;
  readonly box?: {
    readonly left?: number;
    readonly top?: number;
    readonly width?: number;
    readonly height?: number;
    readonly paddingLeft?: number;
    readonly paddingTop?: number;
  };
  readonly style?: { readonly transform?: unknown; readonly display?: string; readonly overflow?: string; readonly fontFamily?: string | readonly string[] };
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children?: readonly LayoutNode[];
  readonly lines?: readonly LayoutLine[];
  readonly alignOffset?: number;
  /** The string of a `TEXT_INSTANCE` node. */
  readonly value?: unknown;
}

interface LayoutLine {
  readonly string: string;
  readonly box: { readonly x: number; readonly y: number; readonly height: number };
  readonly xAdvance?: number;
  /** The baseline's distance below the line's top; react-pdf draws glyphs from the top of the line box. */
  readonly ascent?: number;
  /** Advance of the leading whitespace a line hangs before its box. */
  readonly overflowLeft?: number;
  /** Advance of the trailing whitespace a wrapped line hangs past its box. */
  readonly overflowRight?: number;
  readonly runs: readonly {
    readonly start: number;
    readonly end: number;
    readonly ascent?: number;
    /** Negative: the glyphs' extent below the baseline. */
    readonly descent?: number;
    readonly attributes: { readonly font?: LayoutFont | readonly LayoutFont[]; readonly characterSpacing?: number };
  }[];
}

interface LayoutFont {
  readonly postscriptName?: string;
  hasGlyphForCodePoint?(codePoint: number): boolean;
}

interface Read {
  readonly pages: PageInfo[];
  readonly labels: FieldLabel[];
  readonly problems: TemplateProblem[];
}

interface Context {
  readonly inText: boolean;
  readonly inSvg: boolean;
  /** Under a transform other than a translation. */
  readonly transformed: boolean;
  /** The sum of the translations of the node's ancestors. react-pdf draws a node and its children after its own transform. */
  readonly shift: { readonly x: number; readonly y: number };
  /** Under `display: none`, which react-pdf lays out at no size but still draws. */
  readonly hidden: boolean;
  /** The area left visible by ancestors with `overflow: hidden`. Clipped text stays in the text layer, so only this check sees it. */
  readonly clip: LayoutBox | undefined;
}

/**
 * Walk the laid-out pages. Each box is relative to its parent, so offsets accumulate; text starts
 * inside the padding, shifted by its alignment offset, as react-pdf draws it (borders do not move
 * text). Each line spans its advance without the whitespace it hangs past the edge. A field split
 * across pages, or repeated with `fixed`, is one node per page and so one label per page.
 *
 * react-pdf drops the lines that do not fit a fixed height or `maxLines` without an error, so the
 * pieces of each field are followed until together they print its whole text.
 */
function readLayout(document: LayoutNode, leaves: ReadonlyMap<string, unknown>, declared: ReadonlySet<string>): Read {
  const read: Read = { pages: [], labels: [], problems: [] };
  /**
   * Text printed so far by a field whose pieces have not yet shown all of it. react-pdf gives the
   * pieces of a split text, and the copies of a fixed one, the props object of their element.
   */
  const pending = new Map<object, { readonly owner: string; readonly content: string; printed: string }>();
  const undeclared = new Set<string>();
  const cutOff = (owner: string, content: string, printed: string): void =>
    void read.problems.push({
      code: "invalid-template",
      path: owner,
      message: `prints ${quote(printed)} of ${quote(content)}; a fixed height, maxLines or a clipping container cuts it off, so give the text room or leave the value out of the printed mask`,
    });
  const follow = (key: object, owner: string, content: string, lines: readonly LayoutLine[]): void => {
    const piece = pending.get(key) ?? { owner, content, printed: "" };
    piece.printed += lines.map((line) => line.string).join("");
    if (condense(piece.printed) === condense(content)) pending.delete(key);
    else if (condense(content).startsWith(condense(piece.printed))) pending.set(key, piece);
    else {
      pending.delete(key);
      cutOff(owner, content, piece.printed);
    }
  };
  (document.children ?? []).forEach((page, index) => {
    const pageNumber = index + 1;
    const size = { width: page.box?.width ?? 0, height: page.box?.height ?? 0 };
    read.pages.push({ pageNumber, ...size });
    const visit = (node: LayoutNode, x: number, y: number, context: Context): void => {
      const left = x + (node.box?.left ?? 0);
      const top = y + (node.box?.top ?? 0);
      const translation = translationOf(node);
      const transformed = context.transformed || translation === undefined;
      const hidden = context.hidden || node.style?.display === "none";
      // A node clips before its own transform, so its clip moves with its ancestors' translations only.
      const clip = node.style?.overflow === "hidden" ? intersect(context.clip, { x: left + context.shift.x, y: top + context.shift.y, width: node.box?.width ?? 0, height: node.box?.height ?? 0 }) : context.clip;
      const shift = { x: context.shift.x + (translation?.x ?? 0), y: context.shift.y + (translation?.y ?? 0) };
      const paths = node.props?.[FIELD_PROP] as readonly string[] | undefined;
      const owner = paths?.join(", ") ?? "(text)";
      const lines = node.type === "TEXT" ? (node.lines ?? []) : [];
      if (node.type === "TEXT") {
        // Style helpers can leave a family that is not a string, such as NaN; react-pdf ignores it.
        for (const family of [node.style?.fontFamily ?? []].flat()) if (typeof family === "string" && family !== "" && !declared.has(family) && !STANDARD_FONTS.has(family)) undeclared.add(family);
      }
      const missing = missingGlyphs(lines);
      if (missing.size > 0) read.problems.push({ code: "missing-glyph", path: owner, message: describeMissing(missing) });
      if (paths !== undefined) {
        const problem = (message: string): void => void read.problems.push({ code: "invalid-template", path: owner, message });
        const content = contentOf(node);
        if (paths.length === 0) problem("has an empty path list; name at least one path");
        else if (context.inSvg) problem("is inside <Svg>, whose text react-pdf does not lay out in lines; put the field outside the drawing");
        else if (context.inText) problem("is a <Field> nested inside <Text>; put the field beside the surrounding text in a <View>, since nested text has no box of its own");
        else if (hidden) problem("is hidden with display: none, which react-pdf lays out at no size but still draws; leave hidden values out of the template and the printed mask");
        else if (transformed) problem("is rotated, scaled, skewed or otherwise transformed; labels need upright boxes, so only translate() is allowed");
        else if (condense(content) === "") problem("draws no text; leave it out of the printed mask when it is empty");
        else if (RIGHT_TO_LEFT.test(content)) problem("contains right-to-left text, which react-pdf stores in display order; @docture/synthetic/react-pdf labels left-to-right text only");
        else {
          follow(node.props ?? node, owner, content, lines);
          // A piece with no lines is the empty start of a text react-pdf moved to the next page.
          if (lines.length > 0) {
            const box = textBox(node, lines, left + shift.x, top + shift.y);
            if (box.x < -SLACK || box.y < -SLACK || box.x + box.width > size.width + SLACK || box.y + box.height > size.height + SLACK) {
              problem(`lies outside page ${pageNumber} at x ${box.x.toFixed(1)}, y ${box.y.toFixed(1)}, ${box.width.toFixed(1)} × ${box.height.toFixed(1)}`);
            } else if (clip !== undefined && !contains(clip, box)) {
              problem("is cut off by an ancestor with overflow: hidden; give the container room for the text or leave the value out of the printed mask");
            }
            const text = lines.map((line) => line.string.trim()).join("\n");
            for (const path of paths) read.labels.push({ path, value: leaves.get(path), text, pageNumber, box });
          }
        }
      }
      const inner: Context = { inText: context.inText || node.type === "TEXT", inSvg: context.inSvg || node.type === "SVG", transformed, shift, hidden, clip };
      for (const child of node.children ?? []) visit(child, left, top, inner);
    };
    const pageShift = translationOf(page);
    const start: Context = { inText: false, inSvg: false, transformed: pageShift === undefined, shift: pageShift ?? { x: 0, y: 0 }, hidden: false, clip: undefined };
    for (const child of page.children ?? []) visit(child, page.box?.left ?? 0, page.box?.top ?? 0, start);
  });
  for (const piece of pending.values()) cutOff(piece.owner, piece.content, piece.printed);
  for (const family of undeclared) {
    read.problems.push({
      code: "invalid-template",
      path: "",
      message: `uses font family "${family}" without declaring it in fonts; react-pdf families are process-wide, so the template would render only after another template registers it`,
    });
  }
  return read;
}

/** The text a `<Text>` was given, before line breaking, hyphenation and case transforms. */
function contentOf(node: LayoutNode): string {
  if (node.type === "TEXT_INSTANCE") return String(node.value ?? "");
  return (node.children ?? []).map(contentOf).join("");
}

/** Text compared without what layout adds or changes: whitespace, hyphens at breaks, soft hyphens and case, upper-cased so "ß" matches its "SS". */
function condense(text: string): string {
  return text.replace(/[\s\u00ad-]/gu, "").toUpperCase();
}

function quote(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return JSON.stringify(flat.length > 60 ? `${flat.slice(0, 57)}...` : flat);
}

function intersect(a: LayoutBox | undefined, b: LayoutBox): LayoutBox {
  if (a === undefined) return b;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

function contains(outer: LayoutBox, inner: LayoutBox): boolean {
  return inner.x >= outer.x - SLACK && inner.y >= outer.y - SLACK && inner.x + inner.width <= outer.x + outer.width + SLACK && inner.y + inner.height <= outer.y + outer.height + SLACK;
}

/** The offset of a node's transform when it only translates, `{ 0, 0 }` without one, and `undefined` for any other transform. */
function translationOf(node: LayoutNode): { readonly x: number; readonly y: number } | undefined {
  const transform = node.style?.transform;
  if (transform === undefined || transform === null || transform === "none") return { x: 0, y: 0 };
  if (!Array.isArray(transform)) return undefined;
  let x = 0;
  let y = 0;
  for (const step of transform as readonly { readonly operation?: unknown; readonly value?: unknown }[]) {
    const value = step.value;
    if (step.operation !== "translate" || !Array.isArray(value) || typeof value[0] !== "number" || typeof value[1] !== "number") return undefined;
    x += value[0];
    y += value[1];
  }
  return { x, y };
}

function textBox(node: LayoutNode, lines: readonly LayoutLine[], left: number, top: number): LayoutBox {
  const originX = left + (node.box?.paddingLeft ?? 0) - (node.alignOffset ?? 0);
  const originY = top + (node.box?.paddingTop ?? 0) - (lines[0]?.box.y ?? 0);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const line of lines) {
    const x = originX + line.box.x + (line.overflowLeft ?? 0);
    const y = originY + line.box.y;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + inkAdvance(line));
    y1 = Math.max(y1, y + glyphHeight(line));
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** A line's advance from its first to its last glyph: without hanging whitespace, and without the letter spacing after the last glyph. */
function inkAdvance(line: LayoutLine): number {
  const trailing = /\s$/u.test(line.string) ? 0 : (line.runs.at(-1)?.attributes.characterSpacing ?? 0);
  return Math.max(0, (line.xAdvance ?? 0) - (line.overflowLeft ?? 0) - (line.overflowRight ?? 0) - trailing);
}

/** From the top of the line to the bottom of its lowest glyph. Line spacing beyond that lies below the glyphs, outside the label. */
function glyphHeight(line: LayoutLine): number {
  const ascent = line.ascent ?? Math.max(0, ...line.runs.map((run) => run.ascent ?? 0));
  const descent = Math.max(0, ...line.runs.map((run) => -(run.descent ?? 0)));
  return ascent + descent > 0 ? ascent + descent : line.box.height;
}

/** Characters no font of their run can draw. react-pdf falls back through a run's fonts, and draws a wrong glyph when none has one. */
function missingGlyphs(lines: readonly LayoutLine[]): Map<string, string> {
  const missing = new Map<string, string>();
  for (const line of lines) {
    for (const run of line.runs) {
      const font = run.attributes.font;
      const fonts: readonly LayoutFont[] = font === undefined ? [] : Array.isArray(font) ? font : [font as LayoutFont];
      if (fonts.length === 0) continue;
      for (const char of line.string.slice(run.start, run.end)) {
        if (/[\n\r\t\u00ad]/u.test(char)) continue;
        const codePoint = char.codePointAt(0) as number;
        if (!fonts.some((face) => face.hasGlyphForCodePoint?.(codePoint) ?? true)) missing.set(char, fonts[0]?.postscriptName ?? "font");
      }
    }
  }
  return missing;
}

function describeMissing(missing: ReadonlyMap<string, string>): string {
  const byFont = new Map<string, string[]>();
  for (const [char, font] of missing) byFont.set(font, [...(byFont.get(font) ?? []), `"${char}" (U+${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")})`]);
  return [...byFont].map(([font, chars]) => `font "${font}" cannot draw ${chars.join(", ")}`).join("; ");
}
