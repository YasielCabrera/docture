import {
  describeLoaderConformance,
  describeRasterizerConformance,
  pngFixtures,
  textFixtures,
  type ConformanceFixtures,
} from "docture/testing/conformance";
import { DocumentLoaderData, defineLoader, inferForm, type DocumentLoader, type LoadedDocument, type Rasterizer } from "docture";
import { NapiCanvasRasterizer } from "docture/raster/canvas";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngLoader(mimeTypes: readonly string[] = ["image/png"]): DocumentLoader {
  return {
    name: "png-double",
    capabilities: { text: false, geometry: false, images: true, mimeTypes },
    async load(raw, ctx) {
      ctx.signal.throwIfAborted();
      if (!PNG.every((byte, i) => raw.bytes[i] === byte)) throw new Error("not a PNG");
      const view = new DataView(raw.bytes.buffer, raw.bytes.byteOffset, raw.bytes.byteLength);
      const page = { pageNumber: 1, width: view.getUint32(16), height: view.getUint32(20), text: "", image: async () => raw.bytes };
      return { pages: [page], text: "", form: "scanned", loader: "png-double" };
    },
  };
}

describeLoaderConformance({ name: "text data", create: () => new DocumentLoaderData(), fixtures: textFixtures });
describeLoaderConformance({ name: "png image", create: () => pngLoader(), fixtures: pngFixtures });
describeLoaderConformance({ name: "png refused", create: () => pngLoader(["image/jpeg"]), fixtures: pngFixtures });
function ocrPngLoader(): DocumentLoader {
  const image = pngLoader();
  return {
    ...image,
    name: "ocr-png-double",
    capabilities: { text: true, geometry: true, images: true, mimeTypes: ["image/png"] },
    async load(raw, ctx) {
      const loaded = await image.load(raw, ctx);
      return { ...loaded, pages: loaded.pages.map((page) => ({ ...page, lines: [] })) };
    },
  };
}
describeLoaderConformance({ name: "png ocr", create: () => ocrPngLoader(), fixtures: pngFixtures });
describeLoaderConformance({
  name: "png ocr contaminates",
  fixtures: pngFixtures,
  create: (): DocumentLoader => {
    const real = ocrPngLoader();
    let first: Promise<LoadedDocument> | undefined;
    return { ...real, load: (raw, ctx) => (first ??= real.load(raw, ctx)) };
  },
});
describeLoaderConformance({
  name: "png contaminates",
  fixtures: pngFixtures,
  create: (): DocumentLoader => {
    const real = pngLoader();
    let first: Promise<LoadedDocument> | undefined;
    return { ...real, load: (raw, ctx) => (first ??= real.load(raw, ctx)) };
  },
});

const csvLoader = defineLoader({
  name: "csv",
  capabilities: { text: true, geometry: false, images: false, mimeTypes: ["text/csv"] },
  async load(raw, ctx) {
    ctx.signal.throwIfAborted();
    const text = new TextDecoder().decode(raw.bytes);
    return { pages: [{ pageNumber: 1, width: 0, height: 0, text }], text, form: inferForm([text.trim().length]), loader: "csv" };
  },
});
const csvFixtures: ConformanceFixtures = {
  mimeType: "text/csv",
  dimensions: false,
  async document(seed) {
    const text = `invoice,total\nINV-${seed},${seed * 10}`;
    return { bytes: new TextEncoder().encode(text), mimeType: "text/csv", expectedText: [`INV-${seed}`] };
  },
};
describeLoaderConformance({ name: "csv", create: () => csvLoader, fixtures: csvFixtures });

describeRasterizerConformance({ name: "canvas jpeg", create: () => new NapiCanvasRasterizer(), format: "jpeg" });
describeRasterizerConformance({
  name: "jpeg mislabelled",
  format: "jpeg",
  create: (): Rasterizer => {
    const real = new NapiCanvasRasterizer();
    return {
      name: "mislabels", formats: real.formats,
      async rasterize(raw, options, ctx) {
        const pages = await real.rasterize(raw, { ...options, format: "png" }, ctx);
        return pages.map((page) => ({ ...page, format: options.format ?? "png" }));
      },
    };
  },
});
