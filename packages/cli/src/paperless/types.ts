import type { ContractLike } from "docture";
import type { PaperlessConnectionOptions } from "docture/sources/paperless";
import type { PaperlessEvidencePolicy, PaperlessFieldMapping } from "docture/sinks/paperless";

export interface PaperlessSchemaConfig {
  readonly contract: ContractLike;
  readonly source: { readonly mode: "content" | "archive" | "original"; readonly archiveFallback?: "original" };
  readonly mappingId: string;
  readonly fields: readonly PaperlessFieldMapping[];
  readonly tagIds?: readonly number[];
  readonly auditNote?: string;
  readonly evidence?: PaperlessEvidencePolicy;
}

export interface PaperlessCliConfig {
  readonly connection: PaperlessConnectionOptions;
  readonly schemas: Readonly<Record<string, PaperlessSchemaConfig>>;
  readonly enableApply?: boolean;
  readonly maxResults?: number;
}
