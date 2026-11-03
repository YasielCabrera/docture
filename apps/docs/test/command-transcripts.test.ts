import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const docs = resolve(import.meta.dirname, "..");

describe("command reference transcripts", () => {
	it("matches deterministic CLI streams, artifacts, and failure exit codes", async () => {
		const result = await promisify(execFile)(process.execPath, [
			"--import", "tsx", "scripts/generate-command-reference.ts", "--check",
		], { cwd: docs });
		expect(result.stdout).toMatch(/Command reference verified: [1-9]\d* commands\./);
		const draft = await readFile(resolve(docs, "content/docs/cli/commands/eval-draft.mdx"), "utf8");
		expect(draft).toContain('"invoiceNumber": "INV-42"');
		expect(draft).toContain("dataset/invoice-001/expected.draft.json");
		expect(draft).toContain("Exit code: `2`.");
		const signOff = await readFile(resolve(docs, "content/docs/cli/commands/eval-sign-off.mdx"), "utf8");
		expect(signOff).toContain("Signed off invoice-001.");
		expect(signOff).toContain("`stdout` is empty.");
		const validate = await readFile(resolve(docs, "content/docs/cli/commands/eval-validate.mdx"), "utf8");
		expect(validate).toContain("1 case of invoices satisfy the spec.");
		expect(validate).toContain("GROUND_TRUTH_INVALID");
		expect(validate).toContain("Exit code: `1`.");
		const list = await readFile(resolve(docs, "content/docs/cli/commands/synth-list.mdx"), "utf8");
		expect(list).toContain('"profiles": [');
		expect(list).toContain('"configured": [');
		expect(list).toContain('got "xml".');
	});
});
