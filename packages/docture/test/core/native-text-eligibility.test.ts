import { expect, it } from "vitest";
import { documentFeatures, preloadedFeatures } from "../../src/core/pipeline/features.js";
import { DocumentLoaderData, type LoadedDocument, type SourceEvidence } from "docture";

function document(evidenceText: string | undefined): LoadedDocument {
  const evidence: SourceEvidence[] | undefined = evidenceText === undefined ? undefined : [{ id: "p1-cell-123456789abc", granularity: "table-cell", elementId: "table", pageNumber: 1, text: evidenceText, order: 0, location: { kind: "logical", pageNumber: 1 }, row: 0, column: 0, rowSpan: 1, colSpan: 1 }];
  return { loader: "native-fixture", form: "digital", text: "42", pages: [{ pageNumber: 1, width: 0, height: 0, text: "42", ...(evidence === undefined ? {} : { evidence }) }] };
}

it.each(["loaded", "preloaded"])("recognizes short genuine native text for %s sources without geometry", (mode) => {
  const loaded = document("42");
  const features = mode === "loaded" ? documentFeatures(loaded, new DocumentLoaderData(), "application/pdf") : preloadedFeatures({ loaded });
  expect(features.hasTextLayer).toBe(true);
  expect(features.hasGeometry).toBe(false);
  expect(features.textLength).toBe(2);
});

it.each([undefined, "", " \n\t"])("keeps the short noisy-text heuristic without nonblank native evidence %j", (text) => {
  const loaded = document(text);
  expect(documentFeatures(loaded, new DocumentLoaderData(), "application/pdf").hasTextLayer).toBe(false);
  expect(preloadedFeatures({ loaded }).hasTextLayer).toBe(false);
});
