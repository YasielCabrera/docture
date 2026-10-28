import type { RawDocument } from "../core/domain/document.js";
import type { LoadedSource } from "../core/domain/geometry.js";
import { sniffMimeType } from "../core/pipeline/source.js";
import { PaperlessTransport, PaperlessError, digestBytes, positiveInteger } from "./transport.js";
import { freezeMetadata, parseDocument, parseFileMetadata } from "./schema.js";
import type { PaperlessProvenance } from "./provenance.js";

export type PaperlessSourceResult = {
  readonly source: LoadedSource | RawDocument;
  readonly provenance: PaperlessProvenance;
  readonly limitations: readonly string[];
};
export interface PaperlessReadOptions {
  readonly mode: "content" | "archive" | "original";
  readonly versionId?: number;
  readonly archiveFallback?: "original";
  readonly signal?: AbortSignal;
}

export async function readPaperlessSource(transport: PaperlessTransport, documentId: number, options: PaperlessReadOptions): Promise<PaperlessSourceResult> {
    positiveInteger(documentId, "documentId");
    if (!["content", "archive", "original"].includes(options.mode)) throw new PaperlessError("Paperless source mode must be content, archive or original.", "configuration");
    if (options.versionId !== undefined) positiveInteger(options.versionId, "versionId");
    const initialPath = `api/documents/${documentId}/?truncate_content=false${options.versionId === undefined ? "" : `&version=${options.versionId}`}`;
    let response = await transport.json(initialPath, options.signal);
    let document = parseDocument(response.value);
    const rootId = document.rootDocumentId ?? document.id;
    const fileVersionId = options.versionId ?? (document.rootDocumentId === null ? document.versions[0]?.id : document.id);
    if (fileVersionId === undefined || !document.versions.some((version) => version.id === fileVersionId)) throw new PaperlessError("The selected file version does not belong to this Paperless root document.");
    if (options.versionId === undefined || document.id !== rootId) {
      response = await transport.json(`api/documents/${rootId}/?version=${fileVersionId}&truncate_content=false`, options.signal);
      document = parseDocument(response.value);
    }
    if (document.id !== rootId || document.rootDocumentId !== null || !document.versions.some((version) => version.id === fileVersionId)) throw new PaperlessError("Paperless returned inconsistent root/file-version identity.");
    const metadata = freezeMetadata(document);
    const uiUrl = new URL(`documents/${rootId}/details`, transport.instance).href;
    const base = { kind: "paperless" as const, schemaVersion: 1 as const, instance: transport.instance, documentId: rootId, fileVersionId, apiVersion: transport.apiVersion, serverVersion: response.serverVersion, metadata, uiUrl };
    if (options.mode === "content") {
      const digest = await digestBytes(new TextEncoder().encode(document.content));
      const source: LoadedSource = { loaded: { loader: "paperless-content", form: document.content.trim() === "" ? "unknown" : "digital", text: document.content, pages: [{ pageNumber: 1, width: 0, height: 0, text: document.content }], meta: { logicalPages: true, physicalPageBoundaries: false } }, mimeType: "text/plain", fileName: `paperless-${rootId}-v${fileVersionId}.txt` };
      return { source, provenance: Object.freeze({ ...base, variant: "content", digest, nativeChecksum: document.versions.find((version) => version.id === fileVersionId)?.checksum ?? null }), limitations: Object.freeze(["Stored OCR content is one logical text page; form feeds do not prove physical page boundaries.", "Content has no positioned line or image evidence. Configure a PDF or Docling loader for richer evidence."]) };
    }
    const file = parseFileMetadata((await transport.json(`api/documents/${rootId}/metadata/?version=${fileVersionId}`, options.signal)).value);
    let variant: "archive" | "original" = options.mode;
    if (variant === "archive" && (!file.hasArchive || file.archiveChecksum === null)) {
      if (options.archiveFallback !== "original") throw new PaperlessError("Paperless has no confirmed archive for the selected file version.");
      variant = "original";
    }
    const downloaded = await transport.request(`api/documents/${rootId}/download/?version=${fileVersionId}${variant === "original" ? "&original=true" : ""}`, options.signal);
    if (downloaded.bytes.length === 0) throw new PaperlessError("Paperless returned an empty document.");
    const sniffed = sniffMimeType(downloaded.bytes);
    if (variant === "archive" && (downloaded.mimeType !== "application/pdf" || sniffed !== "application/pdf")) throw new PaperlessError("Paperless archive download is not a confirmed PDF.");
    if (variant === "original" && downloaded.mimeType !== file.originalMimeType.toLowerCase()) throw new PaperlessError("Paperless original download MIME type differs from selected-version metadata.");
    const digest = await digestBytes(downloaded.bytes);
    const after = parseFileMetadata((await transport.json(`api/documents/${rootId}/metadata/?version=${fileVersionId}`, options.signal)).value);
    if (after.originalChecksum !== file.originalChecksum || after.archiveChecksum !== file.archiveChecksum || after.hasArchive !== file.hasArchive) throw new PaperlessError("Paperless file metadata changed while reading the selected source.", "source-changed");
    return { source: { bytes: downloaded.bytes, mimeType: downloaded.mimeType, fileName: variant === "archive" ? file.archiveFilename ?? `paperless-${rootId}.pdf` : file.originalFilename ?? `paperless-${rootId}-v${fileVersionId}` }, provenance: Object.freeze({ ...base, variant, digest, nativeChecksum: variant === "archive" ? file.archiveChecksum : file.originalChecksum }), limitations: Object.freeze(variant === options.mode ? [] : ["The requested archive was absent; the caller explicitly selected original-file fallback."]) };
  }
