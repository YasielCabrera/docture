import { describeLoaderConformance } from "docture/testing/conformance";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import type { DocumentLoader, LoadedDocument } from "docture";

describeLoaderConformance({
  name: "configured skips",
  create: () => new DocumentLoaderPdfJs(),
  skip: { images: true, geometry: true, multiPage: true, scanned: true },
});

describeLoaderConformance({ name: "reuse good", create: () => new DocumentLoaderPdfJs() });
describeLoaderConformance({
  name: "reuse broken second",
  create: (): DocumentLoader => {
    const real = new DocumentLoaderPdfJs();
    let calls = 0;
    return {
      name: "breaks-second", capabilities: real.capabilities,
      load(raw, ctx) {
        if (++calls > 1) return Promise.reject(Error("second document failed"));
        return real.load(raw, ctx);
      },
    };
  },
});
describeLoaderConformance({
  name: "reuse broken concurrent",
  create: (): DocumentLoader => {
    const real = new DocumentLoaderPdfJs();
    let first: Promise<LoadedDocument> | undefined;
    return {
      name: "contaminates", capabilities: real.capabilities,
      load(raw, ctx) { return first ??= real.load(raw, ctx); },
    };
  },
});
describeLoaderConformance({
  name: "capability skips",
  skip: { multiPage: true },
  create: () => ({
    name: "no-capabilities",
    capabilities: { text: false, geometry: false, images: false, mimeTypes: ["application/pdf"] },
    async load() { throw Error("scan refused"); },
  }),
});
