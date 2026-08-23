/**
 * The candidate document kinds `docture classify --classifications` points at.
 *
 * One export, an array of `Classification`. Same objects the library takes — the CLI is
 * a thin shell over the same API the other examples use.
 */

import { defineClassification } from "docture";
import { CheckingSummary, CreditLineSummary, Invoice } from "../shared/contracts.js";

export const classifications = [
  defineClassification({
    name: "invoice",
    description: "A commercial invoice: a vendor billing a customer for itemised goods.",
    schema: Invoice.schema,
  }),
  defineClassification({
    name: "checking-account",
    description: "A deposit account statement with a running transaction table.",
    schema: CheckingSummary,
  }),
  defineClassification({
    name: "credit-line",
    description: "A revolving credit line statement with a limit and an interest charge.",
    schema: CreditLineSummary,
  }),
];

export default classifications;
