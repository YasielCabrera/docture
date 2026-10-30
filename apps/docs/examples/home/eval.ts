import { defineEval, exact, number } from "@docture/eval";
import { jsonlDataset } from "@docture/eval/node";
import { runEval } from "@docture/eval/runner";
import { BillTotals, readBill } from "./bill.js";

const result = await runEval({
  dataset: jsonlDataset("corpus/manifest.jsonl", {
    toExpected: (json) => BillTotals.parse(json),
  }),
  spec: defineEval(BillTotals, {
    fields: {
      accountNumber: exact(),
      amountDueCents: number(),
    },
  }),
  slices: { rendition: "tags.rendition" },
  experiments: { id: "text-layer", extract: readBill },
});
