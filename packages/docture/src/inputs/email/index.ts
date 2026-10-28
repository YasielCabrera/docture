import { importEngine, lazyEngine } from "../../core/engines.js";
import { DoctureError, type RawDocument } from "../../core/index.js";
import { base64 } from "../../core/conversion/base64.js";
import { sha256Hex } from "../../core/conversion/sha256.js";

const loadParser = lazyEngine(async () => (await importEngine("docture/inputs/email", ["postal-mime"], () => import("postal-mime"))).default);

export class EmailInputError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "EmailInputError";
  override readonly code = "LOAD_FAILED" as const;
}

interface PartIdentity {
  readonly id: string;
  readonly parentId: string;
  readonly messageId?: string;
  readonly document: RawDocument;
}

export type EmailPart = PartIdentity & (
  | { readonly kind: "body"; readonly disposition: "body"; readonly bodyType: "html" | "text" }
  | { readonly kind: "attachment"; readonly disposition: string | null; readonly originalFileName: string | null; readonly contentId?: string; readonly related: boolean }
);

export interface ExpandedEmail {
  /** Versioned SHA-256 of the exact input's canonical base64 representation. */
  readonly id: string;
  readonly messageId?: string;
  /** Body first, then attachments in their original MIME order. */
  readonly parts: readonly EmailPart[];
}

export interface ExpandEmailOptions {
  readonly signal?: AbortSignal;
  /** Default html, falling back to text when the preferred alternative is absent. */
  readonly bodyPreference?: "html" | "text";
  /** Default include. CID resources remain independent sources, never fetched or rendered. */
  readonly inlineAttachments?: "include" | "omit";
  /** Raw input limit before parsing. Default 25 MiB. */
  readonly maxInputBytes?: number;
  /** Body plus all decoded attachments, including omitted inline resources. Default 50 MiB. */
  readonly maxDecodedBytes?: number;
  /** Default 100. Omitted inline resources also count. */
  readonly maxAttachments?: number;
  /** MIME part limit, including containers and unselected alternatives. Default 256. */
  readonly maxParts?: number;
  /** Default 20. Attached emails are never recursively expanded. */
  readonly maxNestingDepth?: number;
  /** Total headers across MIME parts. Default 256 KiB. */
  readonly maxHeadersBytes?: number;
}

function limit(value: number | undefined, fallback: number, name: string, minimum = 0): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum) throw new EmailInputError(`${name} must be a safe integer of at least ${minimum}.`);
  return resolved;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/tiff": "tiff",
  "text/plain": "txt", "text/html": "html", "message/rfc822": "eml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/**
 * Expand an RFC email into one selected body and byte-preserving attachments.
 *
 * @remarks Install postal-mime explicitly. HTML is decoded but not sanitized here; DocumentLoaderData cleans it. Attachment names are metadata, never paths. Cancellation is cooperative around parsing. A malformed MIME body follows the pinned parser's recovery behavior; missing message headers are rejected.
 * @throws MISSING_ENGINE for an absent parser; LOAD_FAILED for malformed input or exceeded limits.
 * @example
 * ```ts
 * import { expandEmail } from "docture/inputs/email";
 * const expanded = await expandEmail({ bytes: messageBytes, mimeType: "message/rfc822" });
 * ```
 */
export async function expandEmail(raw: RawDocument, options: ExpandEmailOptions = {}): Promise<ExpandedEmail> {
  options.signal?.throwIfAborted();
  const maxInput = limit(options.maxInputBytes, 25 * 1024 * 1024, "maxInputBytes");
  const maxDecoded = limit(options.maxDecodedBytes, 50 * 1024 * 1024, "maxDecodedBytes");
  const maxAttachments = limit(options.maxAttachments, 100, "maxAttachments");
  const maxParts = limit(options.maxParts, 256, "maxParts", 1);
  const maxNestingDepth = limit(options.maxNestingDepth, 20, "maxNestingDepth");
  const maxHeadersSize = limit(options.maxHeadersBytes, 256 * 1024, "maxHeadersBytes");
  if (raw.bytes.length > maxInput) throw new EmailInputError("Email exceeds maxInputBytes.");
  const prefix = new TextDecoder("windows-1252").decode(raw.bytes.subarray(0, Math.min(raw.bytes.length, maxHeadersSize + 4)));
  const separation = /\r?\n\r?\n/.exec(prefix);
  if (separation === null || !/^[\x21-\x39\x3b-\x7e]+:/m.test(prefix.slice(0, separation.index))) {
    throw new EmailInputError("Email must contain RFC message headers followed by a blank line.");
  }
  const Parser = await loadParser();
  options.signal?.throwIfAborted();
  let email: Awaited<ReturnType<typeof Parser.parse>>;
  try {
    email = await Parser.parse(raw.bytes, { attachmentEncoding: "arraybuffer", forceRfc822Attachments: true, maxRfc822NestingDepth: 0, maxNestingDepth, maxPartCount: maxParts, maxHeadersSize });
  } catch (cause) {
    options.signal?.throwIfAborted();
    throw new EmailInputError("Email MIME parsing failed or exceeded a configured limit.", { cause });
  }
  options.signal?.throwIfAborted();
  if (email.attachments.length > maxAttachments) throw new EmailInputError("Email exceeds maxAttachments.");
  const id = `email-v1-${sha256Hex(base64(raw.bytes))}`;
  const message = email.messageId === undefined ? {} : { messageId: email.messageId };
  const identity = { parentId: id, ...message };
  const preference = options.bodyPreference ?? "html";
  const type = preference === "html" ? (email.html === undefined ? "text" : "html") : (email.text === undefined ? "html" : "text");
  const body = type === "html" ? email.html : email.text;
  const parts: EmailPart[] = [];
  let decodedBytes = 0;
  if (body !== undefined) {
    const bytes = new TextEncoder().encode(body);
    decodedBytes += bytes.length;
    parts.push({ ...identity, id: `${id}/body`, kind: "body", disposition: "body", bodyType: type, document: { bytes, mimeType: type === "html" ? "text/html" : "text/plain", fileName: `body.${type === "html" ? "html" : "txt"}` } });
  }
  for (const [index, attachment] of email.attachments.entries()) {
    options.signal?.throwIfAborted();
    if (typeof attachment.content === "string") throw new EmailInputError("MIME parser returned attachment text instead of bytes.");
    const bytes = new Uint8Array(attachment.content).slice();
    decodedBytes += bytes.length;
    if (decodedBytes > maxDecoded) throw new EmailInputError("Email exceeds maxDecodedBytes.");
    const inline = attachment.disposition === "inline" || attachment.related === true;
    if (options.inlineAttachments === "omit" && inline) continue;
    parts.push({
      ...identity, id: `${id}/attachment-${index + 1}`, kind: "attachment", disposition: attachment.disposition,
      originalFileName: attachment.filename, related: attachment.related === true,
      ...(attachment.contentId === undefined ? {} : { contentId: attachment.contentId }),
      document: { bytes, mimeType: attachment.mimeType, fileName: `attachment-${index + 1}.${EXTENSIONS[attachment.mimeType] ?? "bin"}` },
    });
  }
  if (decodedBytes > maxDecoded) throw new EmailInputError("Email exceeds maxDecodedBytes.");
  return { id, ...message, parts };
}
