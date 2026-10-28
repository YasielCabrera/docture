import { DoctureError } from "../../core/pipeline/errors.js";

export class AzureReadError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "AzureReadError";
  override readonly code = "LOAD_FAILED" as const;
}
