/**
 * Download the sample corpus.
 *
 *     pnpm --filter @docture/examples run fetch
 *
 * Every arrival is verified against the manifest before it is written: a PDF must parse
 * and carry the recorded page count and text length, a page image must be a real PNG of
 * plausible page size, a text file must decode. A sample quietly replaced upstream
 * should fail HERE, loudly, rather than confusingly three examples later.
 *
 * `DOCTURE_RECORD=1` prints what it actually found in manifest form, which is how you
 * add a document without guessing its numbers.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageSize, silentLogger, type DocumentLoader } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { DOCUMENTS, DOCUMENTS_DIR, type SampleDocument } from "./documents.js";

const RECORD = process.env["DOCTURE_RECORD"] === "1";

interface Checked {
  /** One line for the console. */
  readonly summary: string;
  /** What the manifest would say, for `DOCTURE_RECORD=1`. */
  readonly recorded: string;
}

async function checkPdf(
  bytes: Uint8Array,
  document: SampleDocument,
  loader: DocumentLoader,
): Promise<Checked> {
  const head = new TextDecoder().decode(bytes.slice(0, 4));
  if (head !== "%PDF") throw new Error(`not a PDF (starts with ${JSON.stringify(head)})`);

  const loaded = await loader.load(
    { bytes, mimeType: "application/pdf" },
    { signal: AbortSignal.timeout(60_000), logger: silentLogger },
  );
  const pages = loaded.pages.length;
  const chars = loaded.text.trim().length;

  const { pages: wantPages, minChars } = document.expect;
  if (wantPages !== undefined && pages !== wantPages) {
    throw new Error(`expected ${wantPages} pages, got ${pages}`);
  }
  if (minChars !== undefined && chars < minChars) {
    throw new Error(`expected at least ${minChars} chars of text, got ${chars}`);
  }

  return {
    summary: `${pages} page(s), ${chars.toLocaleString()} chars, form=${loaded.form}`,
    recorded: `{ pages: ${pages}, minChars: ${Math.floor(chars * 0.9)} }`,
  };
}

/**
 * A page image. This is the check the plan called for: the manifest CLAIMS these PNGs
 * are full-page rasters of their invoices, and a claim about a downloaded file belongs
 * in the verifier rather than in a comment.
 *
 * `imageSize` is `docture`'s own header reader — exported precisely because an
 * OCR loader handed a bare image has no page size to report and must read one from the
 * bytes.
 */
function checkImage(bytes: Uint8Array, document: SampleDocument): Checked {
  const size = imageSize(bytes);
  if (size === undefined) throw new Error("not a PNG or JPEG this library can measure");

  const { minWidth, minHeight } = document.expect;
  if (minWidth !== undefined && size.widthPx < minWidth) {
    throw new Error(`expected width >= ${minWidth}px, got ${size.widthPx}px`);
  }
  if (minHeight !== undefined && size.heightPx < minHeight) {
    throw new Error(`expected height >= ${minHeight}px, got ${size.heightPx}px`);
  }
  // A page is taller than it is wide. A logo or an icon swapped in here would clear a
  // size floor and fail this.
  if (size.heightPx <= size.widthPx) {
    throw new Error(`${size.widthPx}x${size.heightPx} is not portrait — is this a page image?`);
  }

  return {
    summary: `${size.widthPx}x${size.heightPx} px image, no text layer`,
    recorded: `{ minWidth: ${Math.floor(size.widthPx * 0.9)}, minHeight: ${Math.floor(size.heightPx * 0.9)} }`,
  };
}

function checkText(bytes: Uint8Array, document: SampleDocument): Checked {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  const { minChars } = document.expect;
  if (minChars !== undefined && text.length < minChars) {
    throw new Error(`expected at least ${minChars} chars, got ${text.length}`);
  }
  const pages = text.split("\f").length;
  return {
    summary: `${text.length.toLocaleString()} chars of text, ${pages} page(s)`,
    recorded: `{ minChars: ${Math.floor(text.length * 0.9)} }`,
  };
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function main(): Promise<void> {
  await mkdir(DOCUMENTS_DIR, { recursive: true });
  // Typed as the interface, so the optional `dispose` is reachable. The pdf.js loader
  // has nothing to release, but a loader swapped in here might.
  const loader: DocumentLoader = new DocumentLoaderPdfJs();
  let failures = 0;
  const recorded: string[] = [];

  for (const document of DOCUMENTS) {
    process.stdout.write(`${document.id.padEnd(24)} `);

    try {
      const bytes = await download(document.url);

      const checked =
        document.kind === "page-image"
          ? checkImage(bytes, document)
          : document.kind === "text"
            ? checkText(bytes, document)
            : await checkPdf(bytes, document, loader);

      await writeFile(join(DOCUMENTS_DIR, document.file), bytes);

      // The published ground truth, when there is any. A missing truth file is a
      // warning and not a failure: it costs example 12 one row, not the download.
      let truth = "";
      if (document.truthUrl !== undefined && document.truthFile !== undefined) {
        try {
          const raw = await download(document.truthUrl);
          JSON.parse(new TextDecoder().decode(raw));
          await writeFile(join(DOCUMENTS_DIR, document.truthFile), raw);
          truth = ", + truth";
        } catch (error) {
          truth = `, NO truth (${error instanceof Error ? error.message : String(error)})`;
        }
      }

      console.log(`ok  ${checked.summary}${truth}`);
      recorded.push(`  ${document.id.padEnd(24)} ${checked.recorded}`);
    } catch (error) {
      failures += 1;
      console.log(`FAILED  ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await loader.dispose?.();

  if (RECORD) {
    console.log("\nWhat the manifest should say:\n");
    console.log(recorded.join("\n"));
  }

  if (failures > 0) {
    console.error(
      `\n${failures} of ${DOCUMENTS.length} downloads failed. Examples that need a ` +
        "missing document will say so and skip, so the rest still run.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `\nAll ${DOCUMENTS.length} samples are in documents/.\n` +
      "Start with: pnpm --filter @docture/examples quick-start",
  );
}

await main();
