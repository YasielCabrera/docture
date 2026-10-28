import type { ExtractionResult } from "../../core/domain/result.js";
import type { PaperlessProvenance } from "../../paperless/provenance.js";
import type { PaperlessConnectionOptions } from "../../paperless/transport.js";
import type { PaperlessFieldType, PaperlessValue } from "../../paperless/schema.js";

export type PaperlessEvidencePolicy = "verified" | "cited" | "any";
export interface PaperlessFieldMapping {
  readonly path: readonly (string | number)[];
  readonly fieldId: number;
  readonly evidence?: PaperlessEvidencePolicy;
}
export interface PaperlessSinkOptions extends PaperlessConnectionOptions {
  readonly fields: readonly PaperlessFieldMapping[];
  readonly tagIds?: readonly number[];
  readonly auditNote?: string;
  readonly evidence?: PaperlessEvidencePolicy;
  readonly maxOperations?: number;
  readonly maxPlanBytes?: number;
}
export interface PaperlessPlanInput {
  readonly provenance: PaperlessProvenance;
  readonly extraction: Pick<ExtractionResult<unknown>, "data" | "validation" | "citations" | "conflicts">;
  readonly schemaId: string;
  readonly mappingId: string;
  readonly extractionId?: string;
  readonly signal?: AbortSignal;
}
export interface PaperlessPlanIssue { readonly path: string; readonly reason: string }
export interface PaperlessPlannedSkip { readonly path: string; readonly fieldId: number; readonly current?: PaperlessValue; readonly proposed?: PaperlessValue; readonly reason: string }
export interface PaperlessPlanExtraction {
  readonly data: unknown;
  readonly validation: { readonly valid: boolean; readonly issues: readonly { readonly path: string; readonly message: string }[] };
  readonly citations: readonly { readonly path: string; readonly status: "verified" | "cited-unverified" | "uncited"; readonly ids: readonly string[] }[];
  readonly conflicts: readonly { readonly path: string }[];
}
export type PaperlessOperation =
  | { readonly kind: "field"; readonly path: string; readonly fieldId: number; readonly fieldType: PaperlessFieldType; readonly value: PaperlessValue; readonly evidence: "verified" | "cited-unverified" | "uncited"; readonly reciprocalDocumentIds: readonly number[] }
  | { readonly kind: "tag"; readonly tagId: number }
  | { readonly kind: "note"; readonly text: string };
export interface PaperlessPlan {
  readonly kind: "paperless-plan";
  readonly schemaVersion: 1;
  readonly source: PaperlessProvenance;
  readonly schemaId: string;
  readonly mappingId: string;
  readonly extractionId?: string;
  readonly extraction: PaperlessPlanExtraction;
  readonly marker: string;
  readonly operations: readonly PaperlessOperation[];
  readonly blocked: readonly PaperlessPlanIssue[];
  readonly skipped: readonly PaperlessPlannedSkip[];
  readonly limitations: readonly string[];
}
export type PaperlessOperationOutcome = { readonly operation: PaperlessOperation; readonly reason: string } & (
  | { readonly status: "applied" }
  | { readonly status: "skipped"; readonly current?: PaperlessValue; readonly proposed?: PaperlessValue }
  | { readonly status: "failed" }
  | { readonly status: "unknown" }
);
export interface PaperlessApplyResult {
  readonly status: "complete" | "partial" | "cancelled";
  readonly marker: string;
  readonly outcomes: readonly PaperlessOperationOutcome[];
  readonly skipped: readonly PaperlessPlannedSkip[];
}
