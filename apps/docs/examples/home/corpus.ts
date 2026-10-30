import {
  defineModel,
  gen,
  validLuhn,
} from "@docture/synthetic";
import {
  digital,
  scan,
  writeCorpus,
} from "@docture/synthetic/node";
import { Bill, compact, totals } from "./bill.js";

const model = defineModel(Bill, {
  fields: {
    accountNumber: gen.luhn("71", 12),
    "usage[].kwh": gen.int(20, 600),
    "usage[].rateCents": gen.int(12, 45),
  },
  derive: totals,
  constraints: [validLuhn("accountNumber")],
});

await writeCorpus("corpus", {
  model,
  templates: [compact],
  seeds: [1, 2, 3],
  renditions: [
    digital(),
    scan({ severity: 0.4, dpi: 150 }),
  ],
});
