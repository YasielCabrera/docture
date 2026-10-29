import type { GroundTruthIssue } from "../errors.js";
import { canonicalJson, isPlainObject } from "../json.js";
import { indexPath, keyPath } from "../path.js";
import type { Assertion } from "../score/assertions.js";
import { isAbsent } from "../score/engine.js";
import type { LeafShape, SpecNode } from "./tree.js";
import type { FieldType, NullHandling } from "./types.js";

const TYPE_CHECKS: Readonly<Record<FieldType, (value: unknown) => boolean>> = {
  string: (value) => typeof value === "string",
  date: (value) => typeof value === "string",
  "date-time": (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === "boolean",
  enum: () => true,
  object: isPlainObject,
  array: Array.isArray,
  unknown: () => true,
};

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : `the ${typeof value} ${JSON.stringify(value)}`;
}

function checkLeaf(shape: LeafShape, value: unknown, path: string, check: ((value: unknown) => string | undefined) | undefined, issues: GroundTruthIssue[]): void {
  if (value === null) {
    if (!shape.nullable) issues.push({ code: "wrong-type", path, message: "null is not allowed here" });
    return;
  }
  if (!TYPE_CHECKS[shape.type](value)) {
    issues.push({ code: "wrong-type", path, message: `expected ${shape.type}, got ${describe(value)}` });
    return;
  }
  if (shape.values !== undefined) {
    const allowed = shape.values.map(canonicalJson);
    if (!allowed.includes(canonicalJson(value))) {
      issues.push({ code: "invalid-value", path, message: `expected one of ${allowed.join(", ")}, got ${canonicalJson(value)}` });
      return;
    }
  }
  const problem = check?.(value);
  if (problem !== undefined) issues.push({ code: "invalid-value", path, message: problem });
}

function rowIsEmpty(node: SpecNode, value: unknown, nulls: NullHandling): boolean {
  switch (node.kind) {
    case "leaf":
      return isAbsent(value, nulls);
    case "object":
      if (!isPlainObject(value)) return isAbsent(value, nulls);
      return Object.values(value).every((child) => isAbsent(child, nulls) || (Array.isArray(child) && child.length === 0));
    case "array":
      return !Array.isArray(value) || value.length === 0;
  }
}

function visit(node: SpecNode, value: unknown, path: string, nulls: NullHandling, issues: GroundTruthIssue[]): void {
  if (value === undefined || (nulls === "absent" && isAbsent(value, nulls))) return;
  switch (node.kind) {
    case "leaf":
      checkLeaf(node.shape, value, path, node.field.comparator.check?.bind(node.field.comparator), issues);
      return;
    case "object":
      if (value === null) {
        if (!node.nullable) issues.push({ code: "wrong-type", path, message: "null is not allowed here" });
        return;
      }
      if (!isPlainObject(value)) {
        issues.push({ code: "wrong-type", path, message: `expected an object, got ${describe(value)}` });
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        const childNode = node.properties.get(key) ?? node.additional;
        if (childNode !== undefined) visit(childNode, child, keyPath(path, key), nulls, issues);
        else issues.push({ code: "unknown-key", path: keyPath(path, key), message: "the schema has no such key" });
      }
      return;
    case "array":
      if (value === null) {
        if (!node.nullable) issues.push({ code: "wrong-type", path, message: "null is not allowed here" });
        return;
      }
      if (!Array.isArray(value)) {
        issues.push({ code: "wrong-type", path, message: `expected an array, got ${describe(value)}` });
        return;
      }
      value.forEach((row, index) => {
        const rowPath = indexPath(path, index);
        if (node.items.kind !== "leaf" && rowIsEmpty(node.items, row, nulls)) issues.push({ code: "empty-row", path: rowPath, message: "every field of this row is absent" });
        else visit(node.items, row, rowPath, nulls, issues);
      });
      return;
  }
}

/** Strictly validate ground truth against a resolved tree and the spec's assertions. */
export function validateTree(tree: SpecNode, value: unknown, nulls: NullHandling, assertions: readonly Assertion[]): GroundTruthIssue[] {
  const issues: GroundTruthIssue[] = [];
  if (value === undefined) issues.push({ code: "wrong-type", path: "", message: "ground truth is missing" });
  else visit(tree, value, "", nulls, issues);
  for (const assertion of assertions) {
    const outcome = assertion.check(value);
    if (outcome.status === "fail") issues.push({ code: "assertion", path: "", message: `${assertion.id}: ${outcome.message}` });
  }
  return issues;
}
