import { InvalidOptionError } from "../pipeline/errors.js";

/** Adjacent overlapping windows, preserving input order. */
export function pageWindows<T>(pages: readonly T[], size = 2): T[][] {
  if (!Number.isInteger(size) || size < 2) {
    throw new InvalidOptionError("size", "an integer of at least 2", size);
  }
  const windows: T[][] = [];
  for (let i = 0; i + size <= pages.length; i += 1) {
    windows.push(pages.slice(i, i + size));
  }
  return windows;
}
