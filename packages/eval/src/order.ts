/** Order strings by UTF-16 code unit, the same on every host. Use it wherever order reaches a fingerprint, a seed or written output; `localeCompare` depends on the host locale. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
