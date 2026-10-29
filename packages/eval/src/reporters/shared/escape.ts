/** Backslash-escape Markdown syntax, entity-escape HTML, and fold line breaks into spaces. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]|#]/g, (char) => `\\${char}`)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n|\r/g, " ");
}

/** Escape text for an XML attribute or element, dropping characters XML 1.0 cannot carry. */
export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Escape text for HTML element content or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
