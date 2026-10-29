import type { ArrayRule } from "../align/rules.js";
import type { JsonValue } from "../json.js";
import type { FieldType, ResolvedField } from "./types.js";

/** What strict validation checks at a leaf. */
export interface LeafShape {
  readonly type: FieldType;
  readonly nullable: boolean;
  /** Allowed values of an enum. */
  readonly values?: readonly JsonValue[];
}

/** A leaf of a row, reached from the row through object keys only. Row similarity and keys read these. */
export interface RowLeaf {
  readonly field: ResolvedField;
  readonly keys: readonly string[];
  readonly weight: number;
}

/** Container presence needs comparator identity for reports, but never compares values. */
export type PresenceField = Omit<ResolvedField, "comparator"> & {
  readonly comparator: Pick<ResolvedField["comparator"], "id">;
};

/**
 * The resolved spec as a tree that mirrors the schema. Scoring and validation walk it alongside the data.
 * A container's `presence` field scores the container itself under strict nulls, where a null or an
 * empty container is a value that can be omitted, invented or wrong.
 */
export type SpecNode =
  | { readonly kind: "leaf"; readonly field: ResolvedField; readonly shape: LeafShape }
  | {
      readonly kind: "object";
      readonly pattern: string;
      readonly properties: ReadonlyMap<string, SpecNode>;
      /** Values of keys the schema does not name: record values, or the rule covering an open object's unknown keys. */
      readonly additional?: SpecNode;
      readonly nullable: boolean;
      readonly presence: PresenceField;
    }
  | {
      readonly kind: "array";
      readonly pattern: string;
      readonly items: SpecNode;
      readonly rule: ArrayRule;
      readonly rowLeaves: readonly RowLeaf[];
      /** Row-relative key paths of a keyed `hungarian` rule. */
      readonly keys?: readonly (readonly string[])[];
      readonly nullable: boolean;
      readonly presence: PresenceField;
    };
