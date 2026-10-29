import { MissingEngineError } from "docture";
import type { Browser } from "playwright-core";
import type { FieldLabel, PageInfo, SyntheticDocument } from "../document.js";
import { checkDrawn } from "../drawn.js";
import { TemplateError, type TemplateProblem } from "../errors.js";
import { formatter, type Formatter, type Locale } from "../format.js";
import { project, type PrintedMask } from "../mask.js";
import type { Sample } from "../model.js";
import { pageSizes, type PageSize, type TagValue } from "../template.js";

/** Supported optional engine of this entry. */
export const ENGINE_RANGES = { "playwright-core": "1.64.1" } as const;

/**
 * A template that renders HTML and prints it with Chromium. `render` returns the body: one
 * `<section class="page">` per page, each fixed to the page size, so pagination is explicit.
 * Every printed field sits in an element with `data-field="<concrete path>"`, or several
 * comma-separated paths, and is labeled with that element's box.
 */
export interface HtmlTemplate<T> {
  readonly key: string;
  readonly aliases: readonly string[];
  readonly family: string;
  readonly tags: Readonly<Record<string, TagValue>>;
  readonly page: { readonly size: PageSize };
  readonly locale: Locale;
  readonly printed: PrintedMask<T>;
  /**
   * Stylesheet added after the page rules. Embed fonts as data URLs; nothing is fetched.
   * Ligatures are off unless the template sets them `!important`: PDF.js reads a ligature glyph as its own span, so "final" would extract as "fi nal".
   */
  readonly css?: string;
  render(value: T, format: Formatter): string;
}

export interface HtmlTemplateDefinition<T> {
  readonly key: string;
  readonly aliases?: readonly string[];
  readonly family: string;
  readonly tags?: Readonly<Record<string, TagValue>>;
  readonly page?: { readonly size?: PageSize };
  readonly locale: Locale;
  readonly printed: PrintedMask<T>;
  readonly css?: string;
  render(value: T, format: Formatter): string;
}

/** Define an HTML template for values of type `T`: `defineHtmlTemplate<Invoice>()({ … })`. */
export function defineHtmlTemplate<T>(): (definition: HtmlTemplateDefinition<T>) => HtmlTemplate<T> {
  return (definition) => ({
    key: definition.key,
    aliases: definition.aliases ?? [],
    family: definition.family,
    tags: definition.tags ?? {},
    page: { size: definition.page?.size ?? pageSizes.A4 },
    locale: definition.locale,
    printed: definition.printed,
    ...(definition.css === undefined ? {} : { css: definition.css }),
    render: definition.render,
  });
}

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text for HTML content or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (char) => ESCAPES[char] as string);
}

export interface RenderHtmlPdfOptions {
  /** A Chromium browser to reuse. Without one, a browser is launched and closed for this render. */
  readonly browser?: Browser;
  /** Written as the PDF's creation and modification date. Fixed by default so equal inputs give equal bytes. */
  readonly createdAt?: string;
  /** Chromium to launch when no `browser` is given. Defaults to Playwright's installed build. */
  readonly executablePath?: string;
}

async function loadPlaywright(): Promise<typeof import("playwright-core")> {
  try {
    return await import("playwright-core");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND" && /^Cannot find package 'playwright-core' imported from /u.test(error.message)) {
      throw new MissingEngineError("playwright-core", ENGINE_RANGES["playwright-core"], "@docture/synthetic/html", { cause: error });
    }
    throw error;
  }
}

const FIXED_DATE = "2000-01-01T00:00:00Z";
const PRODUCER = "@docture/synthetic";
const PX_TO_PT = 72 / 96;
/** Layout rounding tolerance before a field counts as outside its page. */
const SLACK = 0.5;

interface Measured {
  readonly pages: number;
  readonly fields: readonly { readonly paths: string; readonly page: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly text: string }[];
}

const MEASURE = `(() => {
  const sections = [...document.querySelectorAll("section.page")];
  const fields = [...document.querySelectorAll("[data-field]")].map((element) => {
    const section = element.closest("section.page");
    // The text, not the element: a block or table cell spans its whole column.
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const box = text.width > 0 || text.height > 0 ? text : element.getBoundingClientRect();
    const origin = section === null ? { left: 0, top: 0 } : section.getBoundingClientRect();
    return { paths: element.getAttribute("data-field"), page: sections.indexOf(section) + 1, x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height, text: element.innerText };
  });
  return { pages: sections.length, fields };
})()`;

function documentHtml(template: Pick<HtmlTemplate<unknown>, "page" | "locale" | "css">, body: string): string {
  const { width, height } = template.page.size;
  return `<!doctype html><html lang="${escapeHtml(template.locale.code)}"><head><meta charset="utf-8"><style>
@page { size: ${width}pt ${height}pt; margin: 0 }
html, body { margin: 0; padding: 0 }
*, ::before, ::after { font-variant-ligatures: none !important }
section.page { position: relative; box-sizing: border-box; width: ${width}pt; height: ${height}pt; overflow: hidden; break-inside: avoid }
section.page:not(:last-child) { break-after: page }
</style><style>${template.css ?? ""}</style></head><body>${body}</body></html>`;
}

/**
 * Render `sample` with an HTML template, print it with Chromium, and label every printed field
 * with the page and box of its `data-field` element. Equal inputs give equal bytes on one Chromium build.
 * Fails with `TemplateError` when the marked fields and the printed mask disagree or a field leaves its page.
 */
export async function renderHtmlPdf<T>(template: HtmlTemplate<T>, sample: Sample<T>, options: RenderHtmlPdfOptions = {}): Promise<SyntheticDocument> {
  const createdAt = new Date(options.createdAt ?? FIXED_DATE);
  if (Number.isNaN(createdAt.getTime())) throw new RangeError(`createdAt "${options.createdAt}" is not a date`);
  const { expected, leaves } = project(template.printed, sample.value);
  let body: string;
  try {
    body = template.render(sample.value, formatter(template.locale));
  } catch (cause) {
    throw new TemplateError(template.key, [{ code: "invalid-template", path: "", message: cause instanceof Error ? cause.message : String(cause) }], { cause });
  }

  const { width, height } = template.page.size;
  const browser = options.browser ?? (await (await loadPlaywright()).chromium.launch(options.executablePath === undefined ? {} : { executablePath: options.executablePath }));
  const version = browser.version();
  let measured: Measured;
  let printed: Uint8Array;
  try {
    const page = await browser.newPage({ viewport: { width: Math.ceil(width / PX_TO_PT), height: Math.ceil(height / PX_TO_PT) } });
    try {
      await page.emulateMedia({ media: "print" });
      await page.setContent(documentHtml(template, body), { waitUntil: "load" });
      await page.evaluate("document.fonts.ready.then(() => undefined)");
      measured = await page.evaluate<Measured>(MEASURE);
      printed = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    } finally {
      await page.context().close();
    }
  } finally {
    if (options.browser === undefined) await browser.close();
  }

  const problems: TemplateProblem[] = [];
  const labels: FieldLabel[] = [];
  for (const field of measured.fields) {
    const paths = field.paths.split(",").map((path) => path.trim());
    const box = { x: field.x * PX_TO_PT, y: field.y * PX_TO_PT, width: field.width * PX_TO_PT, height: field.height * PX_TO_PT };
    if (field.page === 0) problems.push({ code: "invalid-template", path: paths.join(", "), message: 'is marked outside any <section class="page">' });
    else if (box.x < -SLACK || box.y < -SLACK || box.x + box.width > width + SLACK || box.y + box.height > height + SLACK) {
      problems.push({ code: "invalid-template", path: paths.join(", "), message: `lies outside page ${field.page} at x ${box.x.toFixed(1)}, y ${box.y.toFixed(1)}, ${box.width.toFixed(1)} × ${box.height.toFixed(1)}` });
    }
    for (const path of paths) labels.push({ path, value: leaves.get(path), text: field.text, pageNumber: field.page, box });
  }
  problems.push(...checkDrawn(leaves, labels));
  const pdfPages = pageCount(printed);
  if (pdfPages !== measured.pages) {
    problems.push({ code: "invalid-template", path: "", message: `prints ${pdfPages} pages from ${measured.pages} page sections; a section's content breaks across pages` });
  }
  if (problems.length > 0) throw new TemplateError(template.key, problems);

  const pages: PageInfo[] = Array.from({ length: measured.pages }, (_, index) => ({ pageNumber: index + 1, width, height }));
  return {
    bytes: await pinPdfInfo(printed, { date: pdfDate(createdAt), producer: PRODUCER }),
    mimeType: "application/pdf",
    pages,
    expected,
    labels,
    sample: { seed: sample.seed, scenario: sample.scenario, tags: sample.tags },
    template: { key: template.key, family: template.family, tags: { ...template.tags, locale: template.locale.code } },
    rendition: { kind: "digital" },
    provenance: { renderer: "chromium", browser: version, createdAt: createdAt.toISOString() },
  };
}

function pageCount(bytes: Uint8Array): number {
  return Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/gu)?.length ?? 0;
}

function pdfDate(date: Date): string {
  const two = (value: number): string => String(value).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}+00'00'`;
}

const PDF_STRING = String.raw`\((?:[^()\\]|\\.)*\)`;

/**
 * Chromium stamps the print time into the Info dictionary. Rewrite its dates and producer,
 * shift the classic cross-reference offsets behind it by the size change, and replace a
 * trailer `/ID` with a digest of the rewritten bytes, so equal input gives equal bytes.
 */
async function pinPdfInfo(bytes: Uint8Array, info: { readonly date: string; readonly producer: string }): Promise<Uint8Array> {
  let text = Buffer.from(bytes).toString("latin1");
  let trailerAt = text.lastIndexOf("trailer");
  const tail = /^trailer\s*(<<[\s\S]*?>>)\s*startxref\s+(\d+)\s+%%EOF\s*$/u.exec(text.slice(trailerAt));
  const trailer = tail?.[1];
  if (tail === null || trailer === undefined || /\/(?:Prev|XRefStm)\b/u.test(trailer) || !text.startsWith("xref", Number(tail[2]))) {
    throw new Error("Chromium printed a PDF without a single classic cross-reference table; its Info dictionary cannot be pinned");
  }
  const infoRef = /\/Info\s+(\d+)\s+0\s+R/u.exec(trailer);
  if (infoRef !== null) {
    const object = new RegExp(String.raw`(?:^|[\r\n])${infoRef[1]}\s+0\s+obj\s*(<<[\s\S]*?>>)\s*endobj`, "u").exec(text);
    const old = object?.[1];
    if (object === null || old === undefined) throw new Error(`Chromium's PDF names Info object ${infoRef[1]} but does not contain it`);
    const at = object.index + object[0].indexOf(old);
    let dict = old;
    for (const [key, value] of [["Producer", info.producer], ["CreationDate", info.date], ["ModDate", info.date]] as const) {
      const entry = new RegExp(String.raw`/${key}\s*${PDF_STRING}`, "u");
      dict = entry.test(dict) ? dict.replace(entry, `/${key} (${value})`) : dict.replace(/>>$/u, `\n/${key} (${value})>>`);
    }
    const delta = dict.length - old.length;
    const xrefAt = Number(tail[2]) + delta;
    text = text.slice(0, at) + dict + text.slice(at + old.length);
    trailerAt += delta;
    const table = text.slice(xrefAt, trailerAt).replace(/(\d{10}) (\d{5}) n/gu, (entry, offset: string, generation: string) =>
      Number(offset) > at ? `${String(Number(offset) + delta).padStart(10, "0")} ${generation} n` : entry,
    );
    text = text.slice(0, xrefAt) + table + text.slice(trailerAt).replace(/startxref\s+\d+/u, `startxref\n${xrefAt}`);
  }
  const id = /\/ID\s*\[\s*<([0-9A-Fa-f]*)>\s*<([0-9A-Fa-f]*)>\s*\]/u.exec(text.slice(trailerAt));
  if (id !== null) {
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(text.slice(0, trailerAt), "latin1"))).toString("hex").toUpperCase();
    const pinned = (hex: string): string => digest.repeat(Math.ceil(hex.length / digest.length)).slice(0, hex.length);
    text = text.slice(0, trailerAt) + text.slice(trailerAt).replace(id[0], `/ID [<${pinned(id[1] as string)}> <${pinned(id[2] as string)}>]`);
  }
  return new Uint8Array(Buffer.from(text, "latin1"));
}
