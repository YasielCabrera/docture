import assert from "node:assert/strict";
import { test } from "node:test";
import { Extractor, errorCodeOf } from "docture";
import { failingStrategy, fixedStrategy, inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { z } from "zod";

const Invoice = z.object({ invoiceNumber: z.string() });
const source = { bytes: new TextEncoder().encode("Invoice: INV-42"), mimeType: "text/plain" };

test("returns the fallback strategy's validated answer", async () => {
	const extractor = new Extractor({
		loaders: [inMemoryLoader(loadedDocument(["Invoice: INV-42"]))],
		strategies: [
			failingStrategy("primary", "The primary parser cannot read this layout"),
			fixedStrategy("fallback", { invoiceNumber: "INV-42" }),
		],
	});
	try {
		const result = await extractor.extract(source, Invoice);
		assert.deepEqual(result.data, { invoiceNumber: "INV-42" });
		assert.equal(result.method, "fallback");
		assert.equal(result.attempts.some((attempt) => attempt.strategy === "primary" && attempt.status === "failed"), true);
	} finally {
		await extractor.dispose();
	}
});

test("rejects an answer that does not satisfy the schema", async () => {
	const extractor = new Extractor({
		loaders: [inMemoryLoader(loadedDocument(["Invoice: INV-42"]))],
		strategies: [fixedStrategy("invalid", { invoiceNumber: 42 })],
	});
	try {
		const outcome = await extractor.safeExtract(source, Invoice);
		assert.equal(outcome.ok, false);
		if (outcome.ok) throw new Error("Expected the invalid answer to fail");
		assert.equal(errorCodeOf(outcome.error), "CONTRACT_VIOLATION");
	} finally {
		await extractor.dispose();
	}
});
