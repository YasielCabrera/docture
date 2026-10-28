import { jsonSchema } from "@ai-sdk/provider-utils";
import type { Tool } from "ai";
import type { Extractor } from "../core/extractor.js";
import type { ContractLike } from "../core/domain/contract.js";
import type { DocumentSource } from "../core/domain/document.js";
import { errorCodeOf, messageOf } from "../core/pipeline/errors.js";

export interface ExtractionToolInput {
  readonly source: string;
}

export type ExtractionToolResult =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export interface ExtractToolOptions<C extends ContractLike> {
  readonly extractor: Pick<Extractor, "extract">;
  readonly contract: C;
  /** Resolve only paths or URLs the caller authorizes. No access policy is implicit. */
  readonly resolveSource: (source: string, signal?: AbortSignal) => DocumentSource | Promise<DocumentSource>;
  readonly description?: string;
}

/** An AI SDK tool that borrows an extractor and returns a JSON-safe result envelope. */
export function extractTool<C extends ContractLike>(options: ExtractToolOptions<C>): Tool<ExtractionToolInput, ExtractionToolResult> {
  return {
    description: options.description ?? "Extract structured data from an authorized document source.",
    inputSchema: jsonSchema<ExtractionToolInput>({
      type: "object", properties: { source: { type: "string", minLength: 1, maxLength: 8192 } }, required: ["source"], additionalProperties: false,
    }),
    async execute(input, execution) {
      try {
        execution.abortSignal?.throwIfAborted();
        const source = await options.resolveSource(input.source, execution.abortSignal);
        const result = await options.extractor.extract(source, options.contract, execution.abortSignal === undefined ? {} : { signal: execution.abortSignal });
        const serializable: unknown = JSON.parse(JSON.stringify(result));
        return { ok: true, result: serializable };
      } catch (error) {
        return { ok: false, error: { code: execution.abortSignal?.aborted ? "CANCELLED" : errorCodeOf(error) ?? "EXTRACTION_FAILED", message: messageOf(error) } };
      }
    },
  };
}
