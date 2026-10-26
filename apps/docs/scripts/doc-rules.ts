export function checkErrorTable(text: string, codes: readonly string[]): string[] {
  const rows = [...text.matchAll(/^\|\s*`?([A-Z_]+)`?\s*\|/gm)].map((match) => match[1] ?? "");
  if (!rows.some((code) => codes.includes(code))) return [];
  return codes.filter((code) => !rows.includes(code)).map((code) => "Error table is missing " + code);
}

export function checkCliInvocations(text: string, bins: ReadonlyMap<string, boolean>): string[] {
  const installed = /(?:npm|pnpm|yarn|bun)\s+(?:install|add|i)\b[^\n]*@docture\/cli/.test(text);
  return [...text.matchAll(/\b(?:npx|pnpm\s+dlx)\s+(@?[\w/-]+(?:@[\w.^~+-]+)?)/g)].flatMap((match) => {
    const raw = match[1] ?? "";
    const version = raw.lastIndexOf("@");
    const name = version > 0 ? raw.slice(0, version) : raw;
    if (!bins.has(name) || bins.get(name) || (name === "docture" && installed)) return [];
    return ["Command package has no binary: " + name];
  });
}

export function checkOptionsTables(text: string, options: ReadonlyMap<string, readonly string[]>): string[] {
  const failures: string[] = [];
  for (const match of text.matchAll(/(?:<!-- options: (\w+) -->|\{\/\* options: (\w+) \*\/\})\s*\n(\|[^\n]*\n(?:\|[^\n]*\n?)*)/g)) {
    const name = match[1] ?? match[2] ?? "";
    const expected = options.get(name);
    if (expected === undefined) { failures.push("Unknown options type: " + name); continue; }
    const actual = [...(match[3] ?? "").matchAll(/^\|\s*`(\w+)`\s*\|/gm)].map((row) => row[1] ?? "").sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) failures.push("Options table differs from " + name);
  }
  return failures;
}

const WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, ten: 10, eleven: 11, twelve: 12, fifteen: 15, sixteen: 16,
};
const number = (text: string): number => WORDS[text.toLowerCase()] ?? Number(text);
export function checkExampleCounts(
  text: string,
  counts: { total: number; keyless: number; partial: number; offline: number },
): string[] {
  const failures: string[] = [];
  for (const match of text.matchAll(/(\w+) examples\.\s*(\w+) need no (?:API )?key(?:, and (\w+) more run part of the way without one)?/gi)) {
    if (number(match[1] ?? "") !== counts.total || number(match[2] ?? "") !== counts.keyless ||
        (match[3] !== undefined && number(match[3]) !== counts.partial)) failures.push("Example counts disagree with the example census");
  }
  for (const match of text.matchAll(/(?:offline script runs |# |the )(one|two|three|four|ten|eleven|twelve|fifteen|sixteen|\d+) (?:examples without (?:an API key|model calls)|that run without a key)/gi)) {
    if (number(match[1] ?? "") !== counts.offline) failures.push("Offline count disagrees with the script");
  }
  return failures;
}
