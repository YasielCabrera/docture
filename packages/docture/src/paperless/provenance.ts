import type { PaperlessApiVersion } from "./transport.js";
import type { PaperlessMetadata } from "./schema.js";

export interface PaperlessProvenance {
  readonly kind: "paperless";
  readonly schemaVersion: 1;
  readonly instance: string;
  readonly documentId: number;
  readonly fileVersionId: number;
  readonly variant: "content" | "archive" | "original";
  readonly digest: string;
  readonly apiVersion: PaperlessApiVersion;
  readonly serverVersion: string;
  readonly nativeChecksum: string | null;
  readonly metadata: PaperlessMetadata;
  readonly uiUrl: string;
}
