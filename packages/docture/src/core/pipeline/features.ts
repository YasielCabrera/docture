/**
 * What the load actually found — the input to every eligibility decision.
 *
 * Derived from the document AND the loader that produced it: a loader may declare
 * `geometry: true` in general and still return a page with no lines (an image-only
 * page), and eligibility must reflect what is actually there.
 */

import {
  MIN_TEXT_LAYER_CHARS,
  type DocumentFeatures,
  type DocumentForm,
} from "../domain/document.js";
import type { LoadedDocument, LoadedSource } from "../domain/geometry.js";
import type { DocumentLoader } from "../contracts/loader.js";

function hasNativeText(document: LoadedDocument): boolean {
  return document.pages.some((page) => page.evidence?.some((source) => source.text.trim() !== "") === true);
}

export function documentFeatures(
  document: LoadedDocument,
  loader: DocumentLoader,
  mimeType: string,
): DocumentFeatures {
  const textLength = document.text.trim().length;
  const hasGeometry =
    loader.capabilities.geometry && document.pages.some((p) => (p.lines?.length ?? 0) > 0);
  const hasRenderablePages =
    loader.capabilities.images || document.pages.some((p) => p.image !== undefined);

  const extra = loader.capabilities.facts?.reduce<Record<string, boolean>>((acc, fact) => {
    acc[fact] = true;
    return acc;
  }, {});

  return {
    mimeType,
    pageCount: document.pages.length,
    textLength,
    hasTextLayer: textLength >= MIN_TEXT_LAYER_CHARS || hasNativeText(document),
    hasGeometry,
    hasRenderablePages,
    form: document.form,
    ...(extra === undefined || Object.keys(extra).length === 0 ? {} : { extra }),
  };
}

/**
 * Per-page form verdict, for a loader that reads text and wants to report `form`
 * honestly. A page clearing a proportional share of the threshold has real text.
 */
export function inferForm(pageTextLengths: readonly number[]): DocumentForm {
  if (pageTextLengths.length === 0) return "unknown";
  const perPageFloor = Math.max(1, Math.floor(MIN_TEXT_LAYER_CHARS / pageTextLengths.length));
  const withText = pageTextLengths.filter((n) => n >= perPageFloor).length;
  if (withText === 0) return "scanned";
  if (withText === pageTextLengths.length) return "digital";
  return "mixed";
}

/**
 * Features for a document that arrived already read.
 *
 * There is no loader to ask what it CAN do, so everything is derived from what is
 * actually there — which is the stricter reading anyway, and the one eligibility
 * wants: a page list with no `lines` has no geometry, whatever produced it.
 */
export function preloadedFeatures(source: LoadedSource): DocumentFeatures {
  const document = source.loaded;
  const textLength = document.text.trim().length;

  const extra = source.facts?.reduce<Record<string, boolean>>((acc, fact) => {
    acc[fact] = true;
    return acc;
  }, {});

  return {
    mimeType: source.mimeType ?? "application/octet-stream",
    pageCount: document.pages.length,
    textLength,
    hasTextLayer: textLength >= MIN_TEXT_LAYER_CHARS || hasNativeText(document),
    hasGeometry: document.pages.some((p) => (p.lines?.length ?? 0) > 0),
    hasRenderablePages: document.pages.some((p) => p.image !== undefined),
    form: document.form,
    ...(extra === undefined || Object.keys(extra).length === 0 ? {} : { extra }),
  };
}
