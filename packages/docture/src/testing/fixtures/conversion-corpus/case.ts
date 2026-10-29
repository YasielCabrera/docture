import type { DocumentElement, LoadedDocument } from "../../../core/index.js";

type ElementKind = DocumentElement["kind"];

/**
 * A conversion check in the vocabulary of `checkConversion` from `@docture/eval/conversion`,
 * which accepts these checks unchanged.
 */
export type ConversionCaseCheck =
  | { readonly id: string; readonly kind: "present"; readonly text: string; readonly ignoreCase?: boolean; readonly count?: number; readonly page?: number; readonly sourcePages?: readonly number[]; readonly element?: ElementKind }
  | { readonly id: string; readonly kind: "absent"; readonly text: string; readonly ignoreCase?: boolean; readonly page?: number; readonly element?: ElementKind }
  | { readonly id: string; readonly kind: "order"; readonly before: string; readonly after: string; readonly ignoreCase?: boolean }
  | {
    readonly id: string;
    readonly kind: "table";
    readonly cell: string;
    readonly ignoreCase?: boolean;
    readonly header?: readonly string[];
    readonly left?: string | null;
    readonly right?: string | null;
    readonly up?: string | null;
    readonly down?: string | null;
    readonly colSpan?: number;
    readonly rowSpan?: number;
    readonly page?: number;
    readonly sourcePage?: number;
  };

/**
 * One conversion corpus entry: a loaded document and the checks its conversion
 * should pass. Check ids are `<case id>/<name>`.
 */
export interface ConversionCase {
  readonly id: string;
  /** The layout the case reproduces and the behaviour its checks expect. */
  readonly description: string;
  readonly loaded: LoadedDocument;
  readonly checks: readonly ConversionCaseCheck[];
}
