/**
 * Turning whatever the caller passed into bytes plus a media type.
 *
 * Accepting a path, a URL, bytes, or an explicit `RawDocument` is a DX decision:
 * the common case is `extract("invoice.pdf", schema)` and nobody should have to
 * read a file first to get there.
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { isLoadedSource, type DocumentSource, type RawDocument } from "../domain/document.js";
import { UnsupportedSourceError } from "./errors.js";

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

/**
 * Media type from magic bytes. Trusted over the file extension, because a
 * mislabelled file is common and a mislabelled header is not.
 *
 * Zip-based Office formats all share the `PK` header, so they are reported as
 * `application/zip` here and resolved by extension instead.
 */
export function sniffMimeType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf"; // %PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00])) return "image/tiff";
  if (startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return "image/tiff";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) return "image/webp"; // RIFF….WEBP
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  return undefined;
}

function typeFromName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  return EXTENSION_TYPES[extname(name).toLowerCase()];
}

function isRawDocument(source: DocumentSource): source is RawDocument {
  return typeof source === "object" && source !== null && "bytes" in source;
}

function toUint8Array(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/**
 * Resolve `source` to bytes and a media type.
 *
 * Precedence for the media type: what the caller said → magic bytes → file
 * extension → `application/octet-stream`. The zip case inverts the middle two,
 * since `PK` cannot distinguish a .docx from a .xlsx.
 */
export async function resolveSource(
  source: DocumentSource,
  signal?: AbortSignal,
): Promise<RawDocument> {
  // Every typed failure in this library carries a code, and that promise should hold
  // for the most ordinary mistake of all: an unset variable, or a promise nobody
  // awaited. Without this the crash is a raw TypeError from a URL regex.
  if (source === undefined || source === null) {
    throw new UnsupportedSourceError(
      "No document was given. Pass a path, a file: or http(s) URL, bytes, or a loaded document.",
    );
  }

  let bytes: Uint8Array;
  let fileName: string | undefined;
  let declared: string | undefined;

  // A pre-loaded document has no bytes to resolve. The pipeline intercepts it
  // before this point; reaching here means someone called `resolveSource` directly.
  if (isLoadedSource(source)) {
    throw new UnsupportedSourceError(
      "This source is already loaded — extract from it directly instead of resolving it to bytes.",
    );
  }

  if (isRawDocument(source)) {
    bytes = toUint8Array(source.bytes);
    fileName = source.fileName;
    declared = source.mimeType;
  } else if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    bytes = toUint8Array(source);
  } else {
    const asUrl = source instanceof URL ? source : parseUrl(source);

    if (asUrl === undefined) {
      // A plain filesystem path.
      bytes = new Uint8Array(await readFile(source as string));
      fileName = basename(source as string);
    } else if (asUrl.protocol === "file:") {
      const path = fileURLToPath(asUrl);
      bytes = new Uint8Array(await readFile(path));
      fileName = basename(path);
    } else if (asUrl.protocol === "http:" || asUrl.protocol === "https:") {
      const response = await fetch(asUrl, signal === undefined ? {} : { signal });
      if (!response.ok) {
        throw new UnsupportedSourceError(
          `Fetching ${asUrl.href} failed with ${response.status} ${response.statusText}.`,
        );
      }
      bytes = new Uint8Array(await response.arrayBuffer());
      fileName = basename(asUrl.pathname) || undefined;
      declared = response.headers.get("content-type")?.split(";")[0]?.trim() || undefined;
    } else {
      throw new UnsupportedSourceError(
        `Unsupported URL protocol "${asUrl.protocol}". Use a path, a file: URL, http(s), or bytes.`,
      );
    }
  }

  if (bytes.length === 0) {
    throw new UnsupportedSourceError("The document is empty (0 bytes).");
  }

  const sniffed = sniffMimeType(bytes);
  const fromName = typeFromName(fileName);
  const mimeType =
    declared ??
    // `PK` alone cannot tell .docx from .xlsx — let the name break the tie.
    (sniffed === "application/zip" ? (fromName ?? sniffed) : (sniffed ?? fromName)) ??
    "application/octet-stream";

  return {
    bytes,
    mimeType,
    ...(fileName === undefined ? {} : { fileName }),
  };
}

/** `undefined` when the string is a filesystem path rather than a URL. */
function parseUrl(value: string): URL | undefined {
  // A bare Windows drive letter ("C:\…") parses as a URL with protocol "c:".
  if (!/^[a-z][a-z0-9+.-]+:\/\//i.test(value) && !value.startsWith("file:")) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
