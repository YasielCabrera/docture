export interface LegacyDoc {
  readonly to: string;
  readonly anchors: Readonly<Record<string, string>>;
}

export function legacyDestination(entry: LegacyDoc, hash: string, search: string): string {
  const anchor = hash.replace(/^#/, "");
  const mapped = new Map(Object.entries(entry.anchors)).get(anchor);
  const target = mapped ?? entry.to + hash;
  const [path, fragment] = target.split("#", 2);
  return path + search + (fragment === undefined ? "" : `#${fragment}`);
}
