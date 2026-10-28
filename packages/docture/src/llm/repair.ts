import type { OutcomeCitation, RepairInput, ValidationIssue } from "../core/index.js";
import { fingerprint, type ContentPart } from "./cache.js";

export type ConversationMessage =
  | { readonly role: "user"; readonly content: ContentPart[] }
  | { readonly role: "assistant"; readonly content: string };

const MERGED_REQUEST =
  "Extract the requested fields from a document that was sent to you in several parts. " +
  "Your answers for the parts were combined into the answer that follows.";

function issueLine(issue: ValidationIssue): string {
  return `- ${issue.path === "" ? "(root)" : issue.path}: ${issue.message}`;
}

function repairInstruction(issues: readonly ValidationIssue[], cited = false): string {
  return [
    "Your previous answer did not satisfy the requested output. Fix every issue below and",
    "return the complete corrected answer. Change only what the issues require, and keep",
    "using only what the document says.",
    ...(cited ? ['Issue paths are relative to "data". Return "data" and "citations" again.'] : []),
    "",
    "Issues:",
    ...issues.map(issueLine),
  ].join("\n");
}

function citedAnswer(data: unknown, citations: readonly OutcomeCitation[]): string {
  return JSON.stringify({
    data: data ?? null,
    citations: citations.map((citation) => ({ path: citation.path.join("."), ids: citation.ids })),
  });
}

function previousAnswer(previous: RepairInput, cited: boolean): string {
  if (previous.kind === "model-output") return previous.rawOutput;
  return cited ? citedAnswer(previous.data, previous.citations ?? []) : JSON.stringify(previous.data) ?? "null";
}

/**
 * `request` is the original single request's content, or `undefined` for a merged
 * answer. `cited` replays a cited request, whose answer is `{ data, citations }`.
 */
export function repairMessages(
  request: readonly ContentPart[] | undefined,
  previous: RepairInput,
  cited = false,
): ConversationMessage[] {
  return [
    { role: "user", content: request === undefined ? [{ type: "text", text: MERGED_REQUEST }] : [...request] },
    { role: "assistant", content: previousAnswer(previous, cited) },
    { role: "user", content: [{ type: "text", text: repairInstruction(previous.issues, cited) }] },
  ];
}

/** Cache identity of a repair conversation, roles included. */
export function repairFingerprint(messages: readonly ConversationMessage[]): string {
  return fingerprint(messages.flatMap((message): ContentPart[] => [
    { type: "text", text: `\0role:${message.role}\0` },
    ...(typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content),
  ]));
}
