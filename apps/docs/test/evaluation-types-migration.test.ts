import "next/dist/server/node-environment-baseline";
import { describe, expect, it } from "vitest";
import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "../next.config.mjs";
import { legacyDocs } from "../lib/docs-migration";
import { legacyDestination } from "../lib/legacy-destination";

describe("evaluation type reference bookmarks", () => {
	it.each([
		["box", "cases#box"],
		["evalspec", "specs#evalspec"],
		["fieldresult", "scores#fieldresult"],
		["evalresult", "results#evalresult"],
		["result_format", "results#result_format"],
		["result_version", "results#result_version"],
		["calibrationstats", "analysis#calibrationstats"],
		["gateresult", "gates#gateresult"],
		["runstore", "stores#runstore"],
		["evalspecerror", "errors#evalspecerror"],
	])("opens the %s contract with the original query", (anchor, destination) => {
		const entry = legacyDocs.get("/docs/evaluation/reference/types");
		if (!entry) throw new Error("Missing evaluation type migration");
		expect(legacyDestination(entry, `#${anchor}`, "?source=bookmark"))
			.toBe(`/docs/evaluation/reference/data-types/${destination.replace("#", "?source=bookmark#")}`);
	});

	it("retains a fragment-aware page for old HTML links", async () => {
		const response = await unstable_getResponseFromNextConfig({
			url: "https://docture.dev/docs/evaluation/reference/types#evalresult",
			nextConfig,
		});
		expect(getRedirectUrl(response)).toBeNull();
	});

	it("opens the type index from an old Markdown URL", async () => {
		const response = await unstable_getResponseFromNextConfig({
			url: "https://docture.dev/docs/evaluation/reference/types.md",
			nextConfig,
		});
		expect(response.status).toBe(308);
		expect(getRedirectUrl(response)).toBe("https://docture.dev/docs/evaluation/reference/data-types.md");
	});
});
