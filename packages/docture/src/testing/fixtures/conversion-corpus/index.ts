import { allTextTables } from "./all-text-tables.js";
import type { ConversionCase } from "./case.js";
import { centeredGroup } from "./centered-group.js";
import { contentsLine } from "./contents-line.js";
import { formSection } from "./form-section.js";
import { pageNumberHeader } from "./page-number-header.js";
import { runningHeader } from "./running-header.js";

export type { ConversionCase } from "./case.js";

/**
 * Loaded documents that reproduce known layout cases, each with the checks its
 * conversion should pass. Run them with `checkConversion` from `docture/eval`.
 *
 * @example
 * ```ts
 * import { DocumentConverter } from "docture";
 * import { checkConversion } from "docture/eval";
 * import { conversionCorpus } from "docture/testing/fixtures";
 *
 * const converter = new DocumentConverter();
 * for (const sample of conversionCorpus) {
 *   const result = await converter.convert({ loaded: sample.loaded }, { format: "json" });
 *   console.log(sample.id, checkConversion(result, sample.checks).failed);
 * }
 * ```
 */
export const conversionCorpus: readonly ConversionCase[] = [
  pageNumberHeader,
  formSection,
  centeredGroup,
  runningHeader,
  allTextTables,
  contentsLine,
];
