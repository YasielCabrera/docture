import { asSchema } from "@ai-sdk/provider-utils";
import { z } from "zod";
import { z as z3 } from "zod/v3";
import { defineEval, text } from "../dist/index.js";

const zod4 = z.object({
  total: z.number().meta({ "x-docture-eval": { compare: "number", abs: 0.01 } }),
  iban: z.string().nullable().meta({ "x-docture-eval": "identifier" }),
});
console.log("Zod 4 through asSchema().jsonSchema:");
console.log(JSON.stringify(await asSchema(zod4).jsonSchema, null, 2));
console.log("\nZod 4 resolved by defineEval:");
console.log(defineEval(zod4).explain("total"));
console.log(defineEval(zod4).explain("iban"));

const zod3 = z3.object({ total: z3.number().describe("x-docture-eval cannot be attached in Zod 3"), iban: z3.string() });
console.log("\nZod 3 has .meta:", typeof zod3.shape.total.meta === "function");
console.log("Zod 3 through asSchema().jsonSchema:");
console.log(JSON.stringify(await asSchema(zod3).jsonSchema, null, 2));
try {
  defineEval(zod3, { strings: text({ minSimilarity: 0.9 }) });
} catch (error) {
  console.log("\nZod 3 passed to defineEval directly:", error.message);
}
console.log("\nZod 3 through asSchema, then defineEval with rules:");
console.log(defineEval(asSchema(zod3), { strings: text({ minSimilarity: 0.9 }) }).explain("total"));
