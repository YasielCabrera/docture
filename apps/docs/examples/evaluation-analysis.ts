import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { defineEval, gate, inMemoryDataset, type EvalCase } from "@docture/eval";
import { calibrate } from "@docture/eval/calibration";
import { grounding } from "@docture/eval/grounding";
import { runEval, type EvalExtractor } from "@docture/eval/runner";
import { z } from "zod";

const Bill = z.object({ totalCents: z.number().int() });
type Bill = z.infer<typeof Bill>;
const Box = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const RecordedPage = z.object({
	lines: z.array(z.object({ text: z.string(), box: Box })),
	confidence: z.number().min(0).max(1),
	pageNumber: z.number().int().positive(),
});
const firstBox = { x: 20, y: 40, width: 80, height: 12 };
const totalBox = { ...firstBox, y: 80 };

const processor = {
	id: "total-parser",
	config: { parser: "first-total-line-v1" },
	async extract(item, context) {
		context.signal.throwIfAborted();
		const document = item.documents[0];
		if (!document) throw new Error("The case needs a recorded page.");
		const page = RecordedPage.parse(JSON.parse(new TextDecoder().decode(await document.bytes())));
		for (const line of page.lines) {
			const total = /^(?:Sub)?[Tt]otal cents: (\d+)$/.exec(line.text)?.[1];
			if (total !== undefined) return {
				raw: { totalCents: Number(total) },
				confidence: { totalCents: page.confidence },
				evidence: [{ path: "totalCents", pageNumber: page.pageNumber, box: line.box }],
			};
		}
		throw new Error("The page has no total.");
	},
} satisfies EvalExtractor<Bill, Bill>;

const cases: readonly EvalCase<Bill>[] = [
	{
		id: "plain", expected: { totalCents: 100 }, totalBox: firstBox,
		lines: [{ text: "Total cents: 100", box: firstBox }],
	},
	{
		id: "credit", expected: { totalCents: 190 }, totalBox,
		lines: [
			{ text: "Subtotal cents: 200", box: firstBox },
			{ text: "Credit cents: 10", box: { ...firstBox, y: 60 } },
			{ text: "Total cents: 190", box: totalBox },
		],
	},
].map(({ id, expected, lines, totalBox }) => ({
	id,
	expected,
	locations: { totalCents: [{ pageNumber: 1, box: totalBox }] },
	documents: [{
		name: `${id}.json`,
		mimeType: "application/json",
		async bytes() {
			return new TextEncoder().encode(JSON.stringify({ lines, confidence: 0.9, pageNumber: 1 }));
		},
	}],
}));

export async function evaluateBills() {
	return runEval({
		dataset: inMemoryDataset("recorded-bills", cases),
		spec: defineEval(Bill),
		experiments: { parser: processor },
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await evaluateBills();
	const confidence = calibrate(result);
	const locations = grounding(result, { level: "box", iou: 0.5 });
	const accepted = gate(result, { thresholds: [{ metric: "f1", min: 1 }] });
	assert.equal(result.summary.parser?.overall.f1, 0.5);
	assert.equal(confidence.experiments.parser?.overall.threshold, null);
	assert.equal(locations.experiments.parser?.overall.groundedF1, 0.5);
	assert.equal(accepted.pass, false);
	console.log("F1", result.summary.parser?.overall.f1);
	console.log("Confidence", JSON.stringify(confidence.experiments.parser?.overall.scores));
	console.log("Auto-accept threshold", confidence.experiments.parser?.overall.threshold);
	console.log("Grounded F1", locations.experiments.parser?.overall.groundedF1);
	console.log("Gate passed", accepted.pass);
}
