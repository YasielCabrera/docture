import type { LayoutBox } from "docture";
import type { SyntheticDocument } from "./document.js";
import type { Formatter, Locale } from "./format.js";
import type { PrintedMask } from "./mask.js";
import type { Sample } from "./model.js";
import { formatKey, type ConcretePath } from "./path.js";

/** A page size in PDF points. */
export interface PageSize {
  readonly width: number;
  readonly height: number;
}

export const pageSizes = {
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
} as const satisfies Readonly<Record<string, PageSize>>;

/** A standard PDF font name, or the bytes of a TrueType or OpenType font. */
export type FontSource = string | Uint8Array;

export interface TextStyle {
  /** A font name declared by the template, or `regular`, `bold`, `italic` or `mono`. */
  readonly font?: string;
  readonly size?: number;
  readonly color?: string;
  /** With `width`, aligns inside the box `[x, x + width]`; without it, `right` and `center` anchor at `x`. */
  readonly align?: "left" | "right" | "center";
  /** Wrap width. Text never wraps without one. */
  readonly width?: number;
  readonly lineGap?: number;
}

export interface At extends TextStyle {
  readonly x: number;
  /** Top of the text box. */
  readonly y: number;
}

/**
 * The drawing surface a template sees. Coordinates are PDF points with a top-left origin,
 * Docture's layout convention, so a drawn box is a label box without conversion.
 */
export interface Surface<T> {
  readonly pageNumber: number;
  readonly size: PageSize;
  /** Draw text that is not a field. */
  text(text: string, at: At): LayoutBox;
  /** Draw `text` for one or more fields and label each with the drawn box. */
  field(path: ConcretePath<T> | readonly ConcretePath<T>[], text: string, at: At): LayoutBox;
  rule(from: { readonly x: number; readonly y: number }, to: { readonly x: number; readonly y: number }, style?: { readonly width?: number; readonly color?: string }): void;
  rect(box: LayoutBox, style?: { readonly fill?: string; readonly stroke?: string; readonly width?: number }): void;
  image(bytes: Uint8Array, box: LayoutBox): void;
  /** The box `text` would occupy with `style`, without drawing. */
  measure(text: string, style?: TextStyle): { readonly width: number; readonly height: number };
  /** Start a new page; later draws land on it. */
  addPage(): void;
}

/** Tag values a template contributes to each case for slicing results. */
export type TagValue = string | number | boolean;

export interface Template<T> {
  readonly key: string;
  readonly aliases: readonly string[];
  readonly family: string;
  readonly tags: Readonly<Record<string, TagValue>>;
  readonly page: { readonly size: PageSize; readonly margin: number };
  readonly locale: Locale;
  /** Font names the template draws with. Unnamed defaults are the standard Helvetica and Courier faces. */
  readonly fonts: Readonly<Record<string, FontSource>>;
  readonly printed: PrintedMask<T>;
  draw(surface: Surface<T>, value: T, format: Formatter): void;
}

export interface TemplateDefinition<T> {
  readonly key: string;
  readonly aliases?: readonly string[];
  readonly family: string;
  readonly tags?: Readonly<Record<string, TagValue>>;
  readonly page?: { readonly size?: PageSize; readonly margin?: number };
  readonly locale: Locale;
  readonly fonts?: Readonly<Record<string, FontSource>>;
  readonly printed: PrintedMask<T>;
  draw(surface: Surface<T>, value: T, format: Formatter): void;
}

/**
 * A template that renders itself through an engine entry, such as `defineReactTemplate` from
 * `@docture/synthetic/react-pdf`. `writeCorpus`, `renderTemplate` and `docture synth` call
 * `renderDocument` instead of PDFKit, so they never import that engine themselves.
 */
export interface RenderingTemplate<T> {
  readonly key: string;
  readonly aliases: readonly string[];
  readonly family: string;
  readonly tags: Readonly<Record<string, TagValue>>;
  readonly locale: Locale;
  readonly printed: PrintedMask<T>;
  renderDocument(sample: Sample<T>, options?: { readonly createdAt?: string }): Promise<SyntheticDocument>;
}

/** Any template a corpus or `docture synth` renders: a PDFKit `Template` or a `RenderingTemplate`. */
export type SynthTemplate<T> = Template<T> | RenderingTemplate<T>;

export const defaultFonts = { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique", mono: "Courier" } as const;

/** Define a template for values of type `T`: `defineTemplate<Invoice>()({ … })`. */
export function defineTemplate<T>(): (definition: TemplateDefinition<T>) => Template<T> {
  return (definition) => ({
    key: definition.key,
    aliases: definition.aliases ?? [],
    family: definition.family,
    tags: definition.tags ?? {},
    page: { size: definition.page?.size ?? pageSizes.A4, margin: definition.page?.margin ?? 50 },
    locale: definition.locale,
    fonts: { ...defaultFonts, ...definition.fonts },
    printed: definition.printed,
    draw: definition.draw,
  });
}

/** Resolve templates by key, alias, family or `all`, keeping registry order and dropping duplicates. */
export function selectTemplates<Selected extends Pick<SynthTemplate<unknown>, "key" | "aliases" | "family">>(
  registry: readonly Selected[],
  selectors: readonly string[],
): readonly Selected[] {
  const norm = (text: string): string => text.trim().toLowerCase();
  const chosen = new Set<Selected>();
  for (const selector of selectors.map(norm)) {
    const matches =
      selector === "all" || selector === "*"
        ? registry
        : registry.filter((template) => norm(template.key) === selector || template.aliases.some((alias) => norm(alias) === selector));
    const found = matches.length > 0 ? matches : registry.filter((template) => norm(template.family) === selector);
    if (found.length === 0) {
      throw new RangeError(`No template matches "${selector}". Known: ${registry.map((template) => template.key).join(", ")}`);
    }
    for (const template of found) chosen.add(template);
  }
  return registry.filter((template) => chosen.has(template));
}

export interface TableColumn<Item> {
  readonly header: string;
  readonly width: number;
  readonly align?: "left" | "right" | "center";
  /** The item key this column prints. Cells of keyed columns are labeled as fields. */
  readonly key?: keyof Item & string;
  readonly text: (item: Item, index: number) => string;
}

export interface TableOptions<Item> {
  /** The concrete path of the array, such as `lineItems`. */
  readonly path: string;
  readonly items: readonly Item[];
  readonly columns: readonly TableColumn<Item>[];
  readonly x: number;
  readonly y: number;
  /** Bottom limit of rows on each page. Defaults to the page height minus the template margin. */
  readonly bottom: number;
  /** Space to keep free under the last row for a closing block; when it does not fit, the block starts on a new page. */
  readonly reserveAfter?: number;
  /** Top of rows on continuation pages. */
  readonly continueAt: number;
  readonly style?: TextStyle;
  readonly headerStyle?: TextStyle;
  readonly padding?: number;
  /** Called on each new page before the header repeats, for running headers. */
  readonly onPage?: () => void;
}

/**
 * Draw a paginated table from measured row heights. Rows never split across pages; the
 * header repeats on each page. Returns the y below the last row, on the page where the
 * closing block fits.
 */
export function drawTable<T, Item>(surface: Surface<T>, options: TableOptions<Item>): number {
  const padding = options.padding ?? 3;
  const header = (top: number): number => {
    let x = options.x;
    let height = 0;
    for (const column of options.columns) {
      const style = { ...options.style, ...options.headerStyle, width: column.width - padding * 2, align: column.align ?? "left" };
      surface.text(column.header, { ...style, x: x + padding, y: top + padding });
      height = Math.max(height, surface.measure(column.header, style).height);
      x += column.width;
    }
    const bottom = top + height + padding * 2;
    surface.rule({ x: options.x, y: bottom }, { x, y: bottom }, { width: 0.5 });
    return bottom;
  };
  const rowHeight = (item: Item, index: number): number =>
    Math.max(...options.columns.map((column) => surface.measure(column.text(item, index), { ...options.style, width: column.width - padding * 2 }).height)) + padding * 2;
  let y = header(options.y);
  options.items.forEach((item, index) => {
    const height = rowHeight(item, index);
    if (y + height > options.bottom) {
      surface.addPage();
      options.onPage?.();
      y = header(options.continueAt);
    }
    let x = options.x;
    for (const column of options.columns) {
      const at = { ...options.style, x: x + padding, y: y + padding, width: column.width - padding * 2, align: column.align ?? "left" };
      const text = column.text(item, index);
      if (column.key === undefined) surface.text(text, at);
      else surface.field(`${options.path}[${index}].${formatKey(column.key)}` as ConcretePath<T>, text, at);
      x += column.width;
    }
    y += height;
  });
  if (y + (options.reserveAfter ?? 0) > options.bottom) {
    surface.addPage();
    options.onPage?.();
    return options.continueAt;
  }
  return y;
}
