import { gate } from "@docture/eval";
import { readEvalResult } from "@docture/eval/node";

const result = await readEvalResult("evaluation");
const verdict = gate(result, {
  thresholds: [{ metric: "f1", min: 1 }],
  maxErrorRate: 0,
});
for (const check of verdict.checks) {
  console.log(`${check.status.toUpperCase()}: ${check.message}`);
}
console.log(`Gate ${verdict.pass ? "passed" : "failed"}`);
if (!verdict.pass) process.exitCode = 1;
