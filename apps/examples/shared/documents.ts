/**
 * The sample corpus: what we read, where it came from, and what it should look like
 * on arrival.
 *
 * Downloaded rather than committed, for the same reason the library's own fixtures are
 * generated: a repo should not carry third-party documents it does not own.
 * `documents/` is gitignored and `pnpm fetch` fills it.
 *
 * Every entry records what `docture inspect` should report. A sample replaced upstream
 * fails on download, loudly, rather than confusingly three examples later.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** What a document is, for the purpose of picking one to read. */
export type DocumentKind = "invoice" | "statement" | "page-image" | "text";

export interface SampleDocument {
  /** How examples ask for it. Stable; the filename is not. */
  readonly id: string;
  readonly file: string;
  readonly url: string;
  readonly kind: DocumentKind;
  readonly about: string;
  /**
   * Published ground truth, alongside the document in the same repository.
   *
   * invoice2data ships a `.json` beside each of its samples. That is what makes
   * example 12 an eval rather than a demo — see `shared/truth/published.ts` for the
   * mapping, and for why it is scored against a NARROW contract.
   */
  readonly truthUrl?: string;
  readonly truthFile?: string;
  /**
   * What a correct download looks like. `pages` and `minChars` are checked for
   * anything with a text layer; `minWidth`/`minHeight` for a page image.
   */
  readonly expect: {
    readonly pages?: number;
    readonly minChars?: number;
    readonly minWidth?: number;
    readonly minHeight?: number;
  };
}

const INVOICE2DATA = "https://raw.githubusercontent.com/invoice-x/invoice2data/master/tests/compare";

/**
 * An invoice2data sample plus its published truth, which always sit side by side
 * under the same stem.
 */
function invoice2data(
  id: string,
  stem: string,
  about: string,
  expect: SampleDocument["expect"],
  extension = "pdf",
): SampleDocument {
  return {
    id,
    file: `${id}.${extension}`,
    url: `${INVOICE2DATA}/${stem}.${extension}`,
    kind: extension === "png" ? "page-image" : extension === "txt" ? "text" : "invoice",
    about,
    truthUrl: `${INVOICE2DATA}/${stem}.json`,
    truthFile: `${id}.truth.json`,
    expect,
  };
}

/**
 * The corpus.
 *
 * Two origins, both already trusted: invoice2data's test corpus, which publishes
 * ground truth beside every sample, and Carson Bank's own specimen statement. None
 * contain real personal data — the bank statement is made out to "JOHN TEST", the
 * Azure Interior invoice is Odoo demo data, and the Sammy Maystone invoice says so on
 * its own last line: "All names are fictitious".
 */
export const DOCUMENTS: readonly SampleDocument[] = [
  // ── The two layouts we have hand-written parsers for ──────────────────────────
  invoice2data(
    "invoice-odoo",
    "AzureInterior",
    "A one-page Odoo invoice: four line items in two sections, mixed units (kg, Units, " +
      "L, g), a per-line discount and tax, and a wrapped description.",
    { pages: 1, minChars: 938 },
  ),
  invoice2data(
    "invoice-services",
    "SammyMaystoneLinesTest",
    "A one-page services invoice: two line items, each followed by indented " +
      "Description / Notes / Parts / Tax detail lines.",
    { pages: 1, minChars: 563 },
  ),

  // ── The layouts nothing here can parse. This is the point of them. ────────────
  invoice2data(
    "invoice-aws",
    "AmazonWebServices",
    "An AWS invoice. Per-service charges, no quantity column.",
    { pages: 1, minChars: 1667 },
  ),
  invoice2data("invoice-flipkart", "FlipkartInvoice", "An Indian retail tax invoice.", {
    pages: 1,
    minChars: 1737,
  }),
  invoice2data("invoice-quality-hosting", "QualityHosting", "A two-page German hosting invoice.", {
    pages: 2,
    minChars: 2728,
  }),
  invoice2data("invoice-netpresse", "NetpresseInvoice", "A French press-service invoice.", {
    pages: 1,
    minChars: 1184,
  }),
  invoice2data("invoice-free-fiber", "free_fiber", "A two-page French telecom invoice.", {
    pages: 2,
    minChars: 2124,
  }),
  invoice2data("invoice-oyo", "oyo", "An OYO hotel folio.", { pages: 1, minChars: 1039 }),
  invoice2data("invoice-saeco", "saeco", "A retail receipt-style invoice.", { pages: 1, minChars: 747 }),

  // Same vendor twice — the case where one parser should generalise to both.
  invoice2data("invoice-coolblue-1", "coolblue1", "A Coolblue invoice.", { pages: 1, minChars: 975 }),
  invoice2data("invoice-coolblue-2", "coolblue2", "A second Coolblue invoice, same layout.", {
    pages: 1,
    minChars: 1174,
  }),

  // ── An invoice that was never a PDF ──────────────────────────────────────────
  invoice2data(
    "invoice-orlen",
    "Orlen",
    "A Polish fuel invoice that is ALREADY TEXT. `DocumentLoaderData` reads it with no " +
      "PDF library involved at all.",
    { minChars: 1522 },
    "txt",
  ),

  // ── Page images: real glyphs, no text layer ──────────────────────────────────
  invoice2data(
    "scan-services",
    "SammyMaystoneLinesTest",
    "A full-page raster of `invoice-services`. No text layer, real glyphs — so OCR and " +
      "the text-layer path can be scored against the SAME published truth.",
    // 1700x2200 — US Letter at 200 DPI. Measured on download, not guessed.
    { minWidth: 1530, minHeight: 1980 },
    "png",
  ),
  invoice2data(
    "scan-aws",
    "AmazonWebServices",
    "A full-page raster of `invoice-aws`, at 350 DPI.",
    { minWidth: 2677, minHeight: 3465 },
    "png",
  ),

  // ── The bundle ───────────────────────────────────────────────────────────────
  {
    id: "statement",
    file: "statement.pdf",
    url: "https://www.carsonbank.com/wp-content/uploads/2021/01/Sample-Statement.pdf",
    kind: "statement",
    about:
      "Six pages holding TWO accounts: a checking account with 48 transactions across " +
      "pages 1 to 3, a revolving credit line on pages 4 to 5, and a blank " +
      "reconciliation form on page 6 that belongs to neither.",
    expect: { pages: 6, minChars: 12_152 },
  },
];

export const DOCUMENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "documents");

export function documentOf(id: string): SampleDocument {
  const document = DOCUMENTS.find((d) => d.id === id);
  if (document === undefined) {
    throw new Error(
      `No sample document called "${id}". Known ids: ${DOCUMENTS.map((d) => d.id).join(", ")}`,
    );
  }
  return document;
}

export function pathOf(id: string): string {
  return join(DOCUMENTS_DIR, documentOf(id).file);
}

/** Where the published ground truth for `id` landed, if it has any. */
export function truthPathOf(id: string): string | undefined {
  const truthFile = documentOf(id).truthFile;
  return truthFile === undefined ? undefined : join(DOCUMENTS_DIR, truthFile);
}

/** Every id of a given kind, in manifest order. */
export function idsOfKind(kind: DocumentKind): string[] {
  return DOCUMENTS.filter((d) => d.kind === kind).map((d) => d.id);
}

/**
 * True when every sample has been downloaded.
 *
 * Synchronous on purpose: the test file needs the answer while Vitest is COLLECTING
 * tests, and `it.runIf` is evaluated then. An async check resolves after collection,
 * by which point every test has already been marked skipped.
 */
export function documentsPresent(): boolean {
  return DOCUMENTS.every((d) => existsSync(join(DOCUMENTS_DIR, d.file)));
}

/** True when these specific ids are on disk. Cheaper than requiring the whole corpus. */
export function present(...ids: readonly string[]): boolean {
  return ids.every((id) => existsSync(pathOf(id)));
}
