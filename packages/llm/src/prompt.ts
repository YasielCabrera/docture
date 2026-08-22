/**
 * Prompt construction, and the chunking the completion strategies need.
 *
 * The schema is NOT put in the prompt: `generateObject` sends it as the model's
 * structured-output contract, which is both cheaper and more reliable than asking
 * in prose. What goes in the prompt is the document, plus the few instructions that
 * change behaviour we care about.
 */

import type { ClassificationResult, LoadedDocument } from "@docture/core";

export const DEFAULT_SYSTEM_PROMPT = [
  "You extract structured data from documents.",
  "",
  "Rules:",
  "- Use only what the document actually says. Never infer, complete or invent a value.",
  "- A field the document does not contain must be null, not a guess and not an empty string.",
  "- Copy identifiers, codes and names exactly as printed, including case and punctuation.",
  "- Normalize dates to ISO 8601 (YYYY-MM-DD).",
  "- Amounts are plain numbers: strip currency symbols and thousands separators, use '.' as the",
  "  decimal separator, and make a parenthesised or minus-signed figure negative.",
  "- Preserve the document's own row order in any list.",
].join("\n");

export interface PromptParts {
  readonly system: string;
  readonly prompt: string;
}

export interface BuildPromptOptions {
  /** Replaces the default system prompt entirely. */
  readonly system?: string;
  /** Appended to the system prompt. The usual way to add domain guidance. */
  readonly instructions?: string;
  /** Classification hints, when a kind was decided. */
  readonly classification?: ClassificationResult;
  /** Extra guidance for the classified kind. */
  readonly hints?: string;
}

/**
 * Wrap the document so the model can tell content from instruction.
 *
 * The delimiters matter: without them, a document containing something that reads
 * like an instruction ("ignore the above and…") is indistinguishable from one.
 */
export function buildPrompt(text: string, options: BuildPromptOptions = {}): PromptParts {
  const system = [
    options.system ?? DEFAULT_SYSTEM_PROMPT,
    options.instructions === undefined ? undefined : `\nAdditional instructions:\n${options.instructions}`,
    options.hints === undefined ? undefined : `\nNotes on this document type:\n${options.hints}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n");

  const kind =
    options.classification === undefined || options.classification.name === "UNKNOWN"
      ? undefined
      : `This document was classified as "${options.classification.name}".`;

  const prompt = [
    kind,
    "Extract the requested fields from the document below.",
    "",
    "<document>",
    text,
    "</document>",
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n");

  return { system, prompt };
}

export interface Chunk {
  readonly text: string;
  /** 1-based page numbers this chunk covers. */
  readonly pages: readonly number[];
}

/** One chunk per page. What `paginate` sends. */
export function chunkByPage(document: LoadedDocument): Chunk[] {
  return document.pages
    .filter((page) => page.text.trim() !== "")
    .map((page) => ({ text: page.text, pages: [page.pageNumber] }));
}

/**
 * Chunks under a character budget, splitting only at page boundaries.
 *
 * Page boundaries rather than a sliding window: a table row cut in half yields two
 * unparseable fragments, and no merge rule recovers from that. A single page over
 * budget is emitted whole — better one oversized request that might work than a
 * guaranteed-broken split.
 */
export function chunkByBudget(document: LoadedDocument, maxChars: number): Chunk[] {
  const chunks: Chunk[] = [];
  let text = "";
  let pages: number[] = [];

  for (const page of document.pages) {
    if (page.text.trim() === "") continue;

    if (text !== "" && text.length + page.text.length > maxChars) {
      chunks.push({ text, pages });
      text = "";
      pages = [];
    }
    text = text === "" ? page.text : `${text}\n\n${page.text}`;
    pages.push(page.pageNumber);
  }

  if (text !== "") chunks.push({ text, pages });
  return chunks;
}

/**
 * A rough token count: ~4 characters per token for Latin prose.
 *
 * Deliberately not a real tokenizer — pulling one in for a budget check would cost
 * more than the check is worth, and the number is only ever used to decide whether
 * to split.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
