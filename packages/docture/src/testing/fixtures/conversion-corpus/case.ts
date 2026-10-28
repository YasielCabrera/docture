import type { LoadedDocument } from "../../../core/index.js";
import type { ConversionCheck } from "../../../eval/conversion.js";

/**
 * One conversion corpus entry: a loaded document and the checks its conversion
 * should pass. Check ids are `<case id>/<name>`.
 */
export interface ConversionCase {
  readonly id: string;
  /** The layout the case reproduces and the behaviour its checks expect. */
  readonly description: string;
  readonly loaded: LoadedDocument;
  readonly checks: readonly ConversionCheck[];
}
