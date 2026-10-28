import { base64 } from "./base64.js";
import type {
  ConversionAsset, ConversionAssetMode, ConversionWarning, DoctureDocument, LayoutDocument,
} from "../domain/conversion.js";
import type { ExportedDocument } from "./export.js";

export function exportJsonDocument(input: {
  readonly document: LayoutDocument;
  readonly loader: string;
  readonly method: string;
  readonly mode: ConversionAssetMode;
  readonly assets: readonly ConversionAsset[];
  readonly warnings: readonly ConversionWarning[];
}): ExportedDocument {
  const snapshot: DoctureDocument = {
    ...(input.document.sourceDigest === undefined ? {} : { sourceDigest: input.document.sourceDigest }),
    ...(input.document.physicalSourceDigest === undefined ? {} : { physicalSourceDigest: input.document.physicalSourceDigest }),
    schemaVersion: 2,
    loader: input.loader,
    method: input.method,
    pages: input.document.pages,
    assets: input.mode === "omit" ? [] : input.assets.map((asset) => input.mode === "embedded"
      ? { id: asset.id, mimeType: asset.mimeType, data: base64(asset.bytes) }
      : { id: asset.id, mimeType: asset.mimeType, reference: asset.reference }),
    warnings: input.warnings,
  };
  return {
    content: JSON.stringify(snapshot, null, 2) + "\n",
    mimeType: "application/json",
    pages: input.document.pages.map((page) => ({
      pageNumber: page.pageNumber, width: page.width, height: page.height,
      content: JSON.stringify(page), elements: page.elements,
      ...(page.evidence === undefined ? {} : { evidence: page.evidence }),
    })),
    assets: input.assets,
    warnings: [],
  };
}
