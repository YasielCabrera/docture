/**
 * `DocumentLoaderData` — the loader for text you already have.
 *
 * It lives in core and requires no optional engine. Plain text, Markdown, CSV and
 * JSON are decoded bytes. HTML and XHTML load pure JavaScript parsers and remove
 * markup, head content, scripts, styles, templates, noscript and comments.
 * Visible headings, lists and table cells retain plain-text hints. That makes
 * `docture` usable on its own for the case where the document was never a PDF,
 * and gives every test a real loader that installs nothing.
 *
 * ```ts
 * const extractor = new Extractor()
 *   .loadDocumentLoader(new DocumentLoaderData())
 *   .loadLlm(new LLM(openai("gpt-5")));
 *
 * await extractor.extract("notes.md", Summary);
 * ```
 */

import { inferForm } from "../pipeline/features.js";
import type { RawDocument } from "../domain/document.js";
import type { LoadedDocument, LoadedPage } from "../domain/geometry.js";
import type { DocumentLoader, LoadContext, LoaderCapabilities } from "../contracts/loader.js";

export interface DataLoaderConfig {
  /** Override the loader's id. Useful when two are wired with different splits. */
  readonly name?: string;
  /**
   * Text encoding for every document. When unset, the charset the source declared
   * (`text/plain; charset=windows-1252`, an HTTP `Content-Type`) is used, and
   * UTF-8 when none was declared or the label is unknown.
   */
  readonly encoding?: string;
  /**
   * Split the text into pages on this delimiter. Default is the form feed `\f`,
   * which is what this library uses to join pages back together, so a round trip
   * through `document.text` preserves the page boundaries.
   */
  readonly pageDelimiter?: string | RegExp;
  /** Extra media types to accept, on top of the text family. */
  readonly mimeTypes?: readonly string[];
}

const DEFAULT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/xhtml+xml",
  "application/json",
  "application/xml",
  "text/xml",
] as const;

type DataCapabilities = LoaderCapabilities<true, false, false>;

export class DocumentLoaderData implements DocumentLoader<DataCapabilities> {
  readonly name: string;
  readonly capabilities: DataCapabilities;
  readonly #encoding: string | undefined;
  readonly #delimiter: string | RegExp;

  constructor(config: DataLoaderConfig = {}) {
    this.name = config.name ?? "DocumentLoaderData";
    this.#encoding = config.encoding;
    this.#delimiter = config.pageDelimiter ?? "\f";
    this.capabilities = {
      text: true,
      geometry: false,
      images: false,
      mimeTypes: [...DEFAULT_TYPES, ...(config.mimeTypes ?? [])],
    };
  }

  async load(document: RawDocument, ctx?: LoadContext): Promise<LoadedDocument> {
    ctx?.signal.throwIfAborted();
    const decoded =
      this.#encoding === undefined
        ? decodeDeclared(document)
        : new TextDecoder(this.#encoding).decode(document.bytes);
    const baseType = (document.mimeType ?? "").split(";")[0]?.trim().toLowerCase();
    const isHtml = baseType === "text/html" || baseType === "application/xhtml+xml";
    let text = decoded;
    if (isHtml) {
      const { htmlText } = await import("./html.js");
      ctx?.signal.throwIfAborted();
      text = htmlText(decoded, baseType === "application/xhtml+xml" ? "xhtml" : "html");
    }
    const chunks = isHtml ? [text] : text.split(this.#delimiter as string);

    const pages: LoadedPage[] = chunks.map((chunk, index) => ({
      pageNumber: index + 1,
      // Nothing here knows a page size, and inventing US Letter would be a lie a
      // geometry consumer could act on. Zero is the honest answer.
      width: 0,
      height: 0,
      text: chunk,
    }));

    return {
      pages,
      text,
      form: inferForm(pages.map((page) => page.text.trim().length)),
      loader: this.name,
    };
  }
}

/** A byte order mark decides the encoding over any declared charset, as WHATWG decoding does. */
function decodeDeclared(document: RawDocument): string {
  const charset = byteOrderMark(document.bytes)
    ?? document.charset
    ?? /;\s*charset\s*=\s*"?([^";\s]+)/iu.exec(document.mimeType ?? "")?.[1];
  let decoder;
  try {
    decoder = new TextDecoder(charset ?? "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(document.bytes);
}

function byteOrderMark(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  return undefined;
}

/** Factory form, for callers who would rather not write `new`. */
export function documentLoaderData(config?: DataLoaderConfig): DocumentLoaderData {
  return new DocumentLoaderData(config);
}
