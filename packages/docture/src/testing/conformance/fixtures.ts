import { deflateSync } from "node:zlib";
import type { DocumentForm } from "../../core/index.js";
import { makeInvoicePdf } from "../fixtures/invoice.js";

/** One document a suite loads or renders. */
export interface ConformanceDocument {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  /** Strings a text-reading loader must find. Distinct seeds give distinct strings. */
  readonly expectedText: readonly string[];
  /** Page count, when the fixture knows it. */
  readonly pageCount?: number;
  /** The form a text-reading loader must report, when the fixture knows it. */
  readonly form?: DocumentForm;
}

/**
 * Seeded documents of one media type for the loader and rasterizer suites.
 *
 * @example
 * ```ts
 * import { describeLoaderConformance, textFixtures } from "docture/testing/conformance";
 * import { DocumentLoaderData } from "docture";
 * describeLoaderConformance({ name: "DocumentLoaderData", create: () => new DocumentLoaderData(), fixtures: textFixtures });
 * ```
 */
export interface ConformanceFixtures {
  readonly mimeType: string;
  /** Whether loaded pages have a real size. False skips the positive page-size check. */
  readonly dimensions: boolean;
  /** A normal document. Distinct seeds give documents with distinct content. */
  document(seed: number): Promise<ConformanceDocument>;
  /** A document of several pages. Absent: multi-page checks are skipped. */
  readonly multiPage?: (seed: number) => Promise<ConformanceDocument & { readonly pageCount: number }>;
  /** A document with no text to find. Absent: the scanned-page check is skipped. */
  readonly scanned?: (seed: number) => Promise<ConformanceDocument>;
  /** Bytes labelled with `mimeType` that are not a document of that kind. Absent: skipped. */
  readonly invalid?: () => Promise<Pick<ConformanceDocument, "bytes" | "mimeType">>;
}

/**
 * Generated invoice PDFs with a text layer. The default for both suites.
 */
export const pdfFixtures: ConformanceFixtures = {
  mimeType: "application/pdf",
  dimensions: true,
  async document(seed) {
    const pdf = await makeInvoicePdf({ seed });
    return {
      bytes: pdf.bytes,
      mimeType: "application/pdf",
      expectedText: [pdf.expected.invoiceNumber, pdf.expected.sellerName],
      pageCount: pdf.pageCount,
      form: "digital",
    };
  },
  async multiPage(seed) {
    const pdf = await makeInvoicePdf({ seed, lineItemCount: 45 });
    return { bytes: pdf.bytes, mimeType: "application/pdf", expectedText: [pdf.expected.invoiceNumber], pageCount: pdf.pageCount };
  },
  async scanned(seed) {
    const pdf = await makeInvoicePdf({ seed, textless: true });
    return { bytes: pdf.bytes, mimeType: "application/pdf", expectedText: [], pageCount: pdf.pageCount, form: "scanned" };
  },
  async invalid() {
    return { bytes: new Uint8Array([1, 2, 3, 4, 5]), mimeType: "application/pdf" };
  },
};

function note(seed: number): string {
  return `Delivery note ${seed}\nReference TXT-${(seed * 7919) % 100_000}\nThree boxes left at the loading dock.`;
}

/**
 * UTF-8 plain text, pages separated by form feeds. Pages have no size, there is no
 * scan, and no text is invalid.
 */
export const textFixtures: ConformanceFixtures = {
  mimeType: "text/plain",
  dimensions: false,
  async document(seed) {
    const text = note(seed);
    return {
      bytes: new TextEncoder().encode(text),
      mimeType: "text/plain",
      expectedText: text.split("\n").slice(0, 2),
      pageCount: 1,
      form: "digital",
    };
  },
  async multiPage(seed) {
    const pages = [note(seed), note(seed + 1), note(seed + 2)];
    return { bytes: new TextEncoder().encode(pages.join("\f")), mimeType: "text/plain", expectedText: [`Delivery note ${seed}`], pageCount: 3 };
  },
};

/**
 * Single-page PNG images with no text: a seeded pattern, and a blank page as the scan.
 */
export const pngFixtures: ConformanceFixtures = {
  mimeType: "image/png",
  dimensions: true,
  async document(seed) {
    return { bytes: png(64, 48, seed), mimeType: "image/png", expectedText: [], pageCount: 1 };
  },
  async scanned() {
    return { bytes: png(64, 48, undefined), mimeType: "image/png", expectedText: [], pageCount: 1, form: "scanned" };
  },
  async invalid() {
    return { bytes: new Uint8Array([1, 2, 3, 4, 5]), mimeType: "image/png" };
  },
};

function png(width: number, height: number, seed: number | undefined): Uint8Array {
  const stride = width * 4;
  const scanlines = new Uint8Array((stride + 1) * height).fill(255);
  let state = (seed ?? 0) >>> 0;
  for (let row = 0; row < height; row += 1) {
    scanlines[row * (stride + 1)] = 0;
    if (seed === undefined) continue;
    for (let at = 0; at < stride; at += 1) {
      if (at % 4 === 3) continue;
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      scanlines[row * (stride + 1) + 1 + at] = state >>> 24;
    }
  }
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([8, 6], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  ];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((at, part) => (bytes.set(part, at), at + part.length), 0);
  return bytes;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([...type].map((char) => char.charCodeAt(0)), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
