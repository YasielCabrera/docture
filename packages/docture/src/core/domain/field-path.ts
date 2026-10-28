/**
 * The address of one field inside extracted data: object keys and array indexes from
 * the root, written as text. Plain keys and indexes join with dots, as in
 * `lineItems.3.amount`. A key that is empty or contains a dot or a backtick is wrapped
 * in backticks, with backslashes and backticks inside it escaped by a backslash, so
 * the key `"a.b"` is `` `a.b` `` and never reads as `a` then `b`. The root is `""`.
 *
 * The text is canonical: equal paths format to equal strings, so a conflict, a
 * citation and a validation issue for the same field can be matched by `path`.
 *
 * @example
 * ```ts
 * import { formatFieldPath, parseFieldPath } from "docture";
 *
 * formatFieldPath(["lineItems", 0, "amount"]); // "lineItems.0.amount"
 * formatFieldPath(["total.net"]); // "`total.net`"
 * parseFieldPath("`total.net`.currency"); // ["total.net", "currency"]
 * ```
 */
export function formatFieldPath(segments: readonly (string | number)[]): string {
  return segments.map(formatSegment).join(".");
}

function formatSegment(segment: string | number): string {
  const key = String(segment);
  return key !== "" && !/[.`]/u.test(key) ? key : `\`${key.replace(/[\\`]/gu, "\\$&")}\``;
}

/**
 * Split a path written by {@link formatFieldPath} back into its keys. An array index
 * comes back as its decimal string. Returns `undefined` for text that no path formats
 * to, such as `a..b` or an unclosed backtick.
 */
export function parseFieldPath(path: string): string[] | undefined {
  if (path === "") return [];
  const segments: string[] = [];
  let index = 0;
  for (;;) {
    let segment = "";
    if (path[index] === "`") {
      index += 1;
      for (;;) {
        const char = path[index];
        if (char === undefined) return undefined;
        index += 1;
        if (char === "`") break;
        if (char === "\\") {
          const escaped = path[index];
          if (escaped !== "\\" && escaped !== "`") return undefined;
          segment += escaped;
          index += 1;
        } else {
          segment += char;
        }
      }
    } else {
      const end = path.indexOf(".", index);
      segment = path.slice(index, end === -1 ? path.length : end);
      if (segment === "" || segment.includes("`")) return undefined;
      index += segment.length;
    }
    segments.push(segment);
    if (index === path.length) return segments;
    if (path[index] !== ".") return undefined;
    index += 1;
    if (index === path.length) return undefined;
  }
}
