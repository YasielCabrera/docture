/**
 * Field paths. A concrete path addresses one value: keys join with dots and
 * array positions are bracketed, as in `lineItems[3].amount`. A pattern
 * addresses a schema position: positions become `[]` and record keys `*`, as in
 * `lineItems[].amount`. A key that is empty or contains `.`, `[`, `]`, `*`,
 * `` ` `` or `\` is wrapped in backticks with `` ` `` and `\` escaped.
 */

/** One step of a path: an object key or an array index. */
export type PathSegment = string | number;

/** A position in a schema: a named key, any key of a record, or the items of an array. */
export type PatternToken =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "any-key" }
  | { readonly kind: "items" };

const PLAIN_KEY = /^[^.[\]*`\\]+$/u;

export function formatKey(key: string): string {
  return PLAIN_KEY.test(key) ? key : `\`${key.replace(/[\\`]/gu, "\\$&")}\``;
}

/** Format path segments as a concrete path: `formatPath(["lineItems", 3, "amount"])` is `lineItems[3].amount`. */
export function formatPath(segments: readonly PathSegment[]): string {
  let path = "";
  for (const segment of segments) path = typeof segment === "number" ? indexPath(path, segment) : keyPath(path, segment);
  return path;
}

export function keyPath(parent: string, key: string): string {
  return parent === "" ? formatKey(key) : `${parent}.${formatKey(key)}`;
}

export function indexPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

export function formatPattern(tokens: readonly PatternToken[]): string {
  let text = "";
  for (const token of tokens) {
    if (token.kind === "items") text += "[]";
    else text += `${text === "" ? "" : "."}${token.kind === "key" ? formatKey(token.key) : "*"}`;
  }
  return text;
}

/** A parsed piece of path or rule text. */
export type TextToken =
  | { readonly kind: "key"; readonly key: string; readonly quoted: boolean }
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "items" };

/** Parse a concrete path, pattern or rule into tokens. Returns `undefined` for text no path formats to. */
export function parsePathText(text: string): TextToken[] | undefined {
  const tokens: TextToken[] = [];
  let index = 0;
  let expectKey = true;
  while (index < text.length) {
    const char = text[index];
    if (char === "[") {
      const close = text.indexOf("]", index);
      if (close === -1) return undefined;
      const inner = text.slice(index + 1, close);
      if (inner === "") tokens.push({ kind: "items" });
      else if (/^\d+$/u.test(inner)) tokens.push({ kind: "index", index: Number(inner) });
      else return undefined;
      index = close + 1;
      expectKey = false;
      continue;
    }
    if (!expectKey) {
      if (char !== ".") return undefined;
      index += 1;
      if (index === text.length) return undefined;
    }
    if (text[index] === "`") {
      let key = "";
      index += 1;
      for (;;) {
        const next = text[index];
        if (next === undefined) return undefined;
        index += 1;
        if (next === "`") break;
        if (next === "\\") {
          const escaped = text[index];
          if (escaped !== "\\" && escaped !== "`") return undefined;
          key += escaped;
          index += 1;
        } else {
          key += next;
        }
      }
      tokens.push({ kind: "key", key, quoted: true });
    } else {
      const match = /^[^.[\]`\\]+/u.exec(text.slice(index));
      if (match === null) return undefined;
      tokens.push({ kind: "key", key: match[0], quoted: false });
      index += match[0].length;
    }
    expectKey = false;
  }
  return tokens;
}

/** Turn a concrete path into its pattern: `lineItems[3].amount` becomes `lineItems[].amount`. Returns the text unchanged when it does not parse. */
export function patternOf(path: string): string {
  const tokens = parsePathText(path);
  if (tokens === undefined) return path;
  let text = "";
  for (const token of tokens) {
    if (token.kind === "key") text += `${text === "" ? "" : "."}${token.quoted ? formatKey(token.key) : token.key}`;
    else text += "[]";
  }
  return text;
}

type RuleToken =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "glob"; readonly source: string; readonly regex: RegExp }
  | { readonly kind: "items" }
  | { readonly kind: "globstar" };

/** How specific a rule is: exact paths win over `*` globs, which win over `**`. */
export type RuleSpecificity = 0 | 1 | 2;

/** A compiled `fields`, `arrays` or `segments` rule. */
export interface RulePattern {
  readonly text: string;
  readonly tokens: readonly RuleToken[];
  readonly specificity: RuleSpecificity;
}

/** Compile rule text such as `totals.*`, `details.*Date`, `lineItems[]` or `payment.**`. Returns `undefined` when the text is not a pattern. */
export function compileRule(text: string): RulePattern | undefined {
  const parsed = parsePathText(text);
  if (parsed === undefined || parsed.length === 0) return undefined;
  const tokens: RuleToken[] = [];
  let specificity: RuleSpecificity = 0;
  for (const token of parsed) {
    if (token.kind === "index") return undefined;
    if (token.kind === "items") tokens.push({ kind: "items" });
    else if (token.quoted || !token.key.includes("*")) tokens.push({ kind: "key", key: token.key });
    else if (token.key === "**") {
      tokens.push({ kind: "globstar" });
      specificity = 2;
    } else if (token.key.includes("**")) {
      return undefined;
    } else {
      const source = token.key.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join(".*");
      tokens.push({ kind: "glob", source: token.key, regex: new RegExp(`^${source}$`, "u") });
      if (specificity === 0) specificity = 1;
    }
  }
  return { text, tokens, specificity };
}

function tokenMatches(rule: RuleToken, token: PatternToken): boolean {
  switch (rule.kind) {
    case "key":
      return token.kind === "key" && token.key === rule.key;
    case "glob":
      return token.kind === "key" ? rule.regex.test(token.key) : token.kind === "any-key" && rule.source === "*";
    case "items":
      return token.kind === "items";
    case "globstar":
      return true;
  }
}

/** True when the rule matches the whole pattern, or with `prefix`, the pattern or one of its ancestors. */
export function ruleMatches(rule: RulePattern, pattern: readonly PatternToken[], prefix = false): boolean {
  const memo = new Map<number, boolean>();
  const visit = (i: number, j: number): boolean => {
    const memoKey = i * (pattern.length + 1) + j;
    const known = memo.get(memoKey);
    if (known !== undefined) return known;
    let result: boolean;
    const token = rule.tokens[i];
    if (token === undefined) result = j === pattern.length || (prefix && j > 0);
    else if (token.kind === "globstar") result = visit(i + 1, j) || (j < pattern.length && visit(i, j + 1));
    else {
      const target = pattern[j];
      result = target !== undefined && tokenMatches(token, target) && visit(i + 1, j + 1);
    }
    memo.set(memoKey, result);
    return result;
  };
  return visit(0, 0);
}
