import { describe, expect, it } from "vitest";
import { DocumentConverter, parseDoctureDocument } from "docture";
import { checkConversion } from "docture/eval";
import { conversionCorpus } from "docture/testing/fixtures";

const KNOWN_DEFECTS: Readonly<Record<string, readonly string[]>> = {};

describe("conversion corpus", () => {
  it.each(conversionCorpus.map((sample) => [sample.id, sample] as const))("fails only the known defects of %s", async (_id, sample) => {
    const result = await new DocumentConverter().convert({ loaded: sample.loaded }, { format: "json" });
    const failing = checkConversion(result, sample.checks).results.filter((check) => !check.pass).map((check) => check.id);
    expect(failing).toEqual(KNOWN_DEFECTS[sample.id] ?? []);
  });

  it("grades a saved JSON snapshot the same as the live result", async () => {
    for (const sample of conversionCorpus) {
      const result = await new DocumentConverter().convert({ loaded: sample.loaded }, { format: "json" });
      const saved = parseDoctureDocument(JSON.parse(result.content));
      expect(saved.ok && checkConversion(saved.document, sample.checks)).toEqual(checkConversion(result, sample.checks));
    }
  });

  it("names every check under its case and covers each census case once", () => {
    expect(conversionCorpus.map((sample) => sample.id)).toEqual([
      "page-number-header",
      "form-section",
      "centered-group",
      "running-header",
      "all-text-tables",
      "contents-line",
    ]);
    for (const sample of conversionCorpus) {
      expect(sample.checks.every((check) => check.id.startsWith(`${sample.id}/`)), sample.id).toBe(true);
    }
    expect(Object.keys(KNOWN_DEFECTS).filter((id) => !conversionCorpus.some((sample) => sample.id === id))).toEqual([]);
  });
});
