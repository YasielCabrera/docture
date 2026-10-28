import { expect, it } from "vitest";
import { z } from "zod";
import { createCheckedExtractor, defineLoader, defineStrategy, errorCodeOf } from "docture";
import { loadedDocument } from "docture/testing/doubles";

it("checked construction still routes using actual document facts", async () => {
  const loader = defineLoader({ name: "possible-geometry", capabilities: { text: true, geometry: true, images: false, mimeTypes: ["*/*"] }, async load() { return loadedDocument(["Text exists but the actual loaded page has no positioned lines."], { geometry: false }); } });
  const strategy = defineStrategy({ name: "geometry", requires: ["GEOMETRY"], async extract() { return { data: { value: "must not run" } }; } });
  const extractor = createCheckedExtractor({ loaders: [loader], strategies: [strategy] });
  try {
    const result = await extractor.safeExtract(new Uint8Array([1]), z.object({ value: z.string() }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Geometry strategy ran without positioned lines.");
    expect(errorCodeOf(result.error)).toBe("NO_ELIGIBLE_STRATEGY");
    expect(result.error.message).toContain("GEOMETRY");
  } finally { await extractor.dispose(); }
});
