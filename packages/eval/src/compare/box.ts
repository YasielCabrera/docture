import type { Box } from "../case.js";
import { unitInterval } from "./options.js";
import type { Comparator } from "./types.js";

export function asBox(value: unknown): (Box & { readonly pageNumber?: number }) | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { x, y, width, height, pageNumber } = value as Record<string, unknown>;
  if (![x, y, width, height].every((part) => typeof part === "number" && Number.isFinite(part))) return undefined;
  const box = { x: x as number, y: y as number, width: width as number, height: height as number };
  if (box.width < 0 || box.height < 0) return undefined;
  return typeof pageNumber === "number" ? { ...box, pageNumber } : box;
}

/** Intersection over union of two boxes. 0 when they do not overlap or have no area. */
export function intersectionOverUnion(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const intersection = width * height;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union <= 0 ? 0 : intersection / union;
}

/** Boxes that overlap by at least `min` intersection over union. Boxes on different pages never match. */
export function boxIoU(options: { readonly min: number }): Comparator {
  const min = unitInterval("boxIoU", "min", options.min);
  if (min === undefined) throw new RangeError("boxIoU: min is required.");
  return {
    id: "boxIoU",
    options: { min },
    compare(expected, actual) {
      const e = asBox(expected);
      const a = asBox(actual);
      if (e === undefined || a === undefined) return { match: false, similarity: 0, note: "not a box" };
      if (e.pageNumber !== undefined && a.pageNumber !== undefined && e.pageNumber !== a.pageNumber) {
        return { match: false, similarity: 0, note: "different page" };
      }
      const similarity = intersectionOverUnion(e, a);
      return { match: similarity >= min, similarity };
    },
    check(expected) {
      return asBox(expected) === undefined ? "expected a box with x, y, width and height" : undefined;
    },
  };
}
