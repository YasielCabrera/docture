import type { ExpectedLocation } from "../case.js";
import { intersectionOverUnion } from "../compare/box.js";
import { EvalSpecError } from "../errors.js";
import type { EvidenceRef, FieldResult } from "./types.js";

/** How evidence must meet an expected location to support a field. */
export interface GroundingRule {
  /** Minimum intersection over union between an expected box and an evidence box, in (0, 1]. Default 0.5. */
  readonly iou?: number;
  /**
   * `box` (default): a boxed location needs a boxed evidence reference on its page overlapping by `iou`;
   * a location without a box needs only the same page. `page`: the same page is enough.
   */
  readonly level?: "box" | "page";
}

/** A grounding rule with its defaults applied. */
export interface ResolvedGroundingRule {
  readonly iou: number;
  readonly level: "box" | "page";
}

/** Apply defaults and check the rule. Throws {@link EvalSpecError} when `iou` is outside (0, 1] or `level` is unknown. */
export function groundingRule(rule: GroundingRule = {}): ResolvedGroundingRule {
  const iou = rule.iou ?? 0.5;
  const level = rule.level ?? "box";
  const problems = [
    ...(Number.isFinite(iou) && iou > 0 && iou <= 1 ? [] : [{ code: "invalid-rule" as const, path: "grounding.iou", message: `IoU must be in (0, 1], got ${String(iou)}` }]),
    ...(level === "box" || level === "page" ? [] : [{ code: "invalid-rule" as const, path: "grounding.level", message: `level must be box or page, got ${String(level)}` }]),
  ];
  if (problems.length > 0) throw new EvalSpecError(problems);
  return { iou, level };
}

/** Whether any evidence reference supports any expected location under the rule. */
export function supportsLocation(evidence: readonly EvidenceRef[], locations: readonly ExpectedLocation[], options: GroundingRule = {}): boolean {
  const rule = groundingRule(options);
  return evidence.some((ref) => locations.some((location) => {
    if (location.pageNumber !== ref.pageNumber) return false;
    if (rule.level === "page" || location.box === undefined) return true;
    return ref.box !== undefined && intersectionOverUnion(location.box, ref.box) >= rule.iou;
  }));
}

/**
 * Whether a field is grounded: it matched and its evidence supports one of its expected locations.
 * The scorer sets `FieldResult.grounded` with the default rule, and `@docture/eval/grounding` uses the rule it was given.
 */
export function isGrounded(field: Pick<FieldResult, "status" | "evidence">, locations: readonly ExpectedLocation[], rule: GroundingRule = {}): boolean {
  return field.status === "match" && supportsLocation(field.evidence ?? [], locations, rule);
}
