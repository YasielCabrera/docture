/** Lowercase, trim and collapse whitespace. */
export function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/gu, " ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] as number) + (ac === b.charCodeAt(j - 1) ? 0 : 1);
      const insertion = (current[j - 1] as number) + 1;
      const deletion = (previous[j] as number) + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] as number;
}

/** 1 minus the edit distance over the longer length. Two empty strings are identical. */
export function levenshteinSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

/** Average Normalized Levenshtein Similarity for one pair: the similarity, or 0 once the normalized distance reaches `tau`. */
export function anlsSimilarity(a: string, b: string, tau = 0.5): number {
  const distance = 1 - levenshteinSimilarity(a, b);
  return distance < tau ? 1 - distance : 0;
}

export function digitsOf(value: string): string {
  return value.replace(/\D/gu, "");
}

/** True when `b` is `a` with exactly one pair of adjacent characters swapped. */
export function isAdjacentTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  let first = -1;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (first !== -1) return i === first + 1 && a[first] === b[i] && a[i] === b[first] && a.slice(i + 1) === b.slice(i + 1);
    first = i;
  }
  return false;
}

/** True when the actual text is a strict, non-empty prefix of the expected text. */
export function isTruncation(expected: string, actual: string): boolean {
  return actual.length > 0 && actual.length < expected.length && expected.startsWith(actual);
}
