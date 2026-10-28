import { DocumentLoaderData, Extractor, createCheckedExtractor, defineLoader, defineStrategy, withRasterizer, type DocumentLoader, type ExtractionStrategy } from "../../src/core/index.js";
import { llm } from "../../src/llm/text.js";
import { vision } from "../../src/llm/vision.js";
import type { LanguageModel } from "ai";

const text = new DocumentLoaderData();
const images = defineStrategy({ name: "image", requires: ["RENDERABLE_PAGES"], async extract() { return { data: {} }; } });
// @ts-expect-error Every known loader explicitly lacks image capability.
createCheckedExtractor({ loaders: [text], strategies: [images] });
declare const dynamicStrategy: ExtractionStrategy;
// @ts-expect-error A dynamic sibling cannot erase the concrete image requirement.
createCheckedExtractor({ loaders: [text], strategies: [images, dynamicStrategy] });
// @ts-expect-error Empty loader tuples use unchecked preloaded wiring.
createCheckedExtractor({ loaders: [], strategies: [images] });
const rasterizer = { name: "images", formats: ["png"] as const, async rasterize() { return []; } };
createCheckedExtractor({ loaders: [withRasterizer(text, rasterizer)], strategies: [images] });
declare const dynamicLoaders: readonly DocumentLoader[];
createCheckedExtractor({ loaders: dynamicLoaders, strategies: [images] });
declare const maybeImages: boolean;
const dynamicLoader = defineLoader({ name: "dynamic", capabilities: { text: true, images: maybeImages, geometry: false, mimeTypes: ["*/*"] }, load: text.load.bind(text) });
createCheckedExtractor({ loaders: [dynamicLoader], strategies: [images] });
createCheckedExtractor({ loaders: [text], strategies: [defineStrategy({ name: "custom", requires: ["CUSTOM_FACT"], async extract() { return { data: {} }; } })] });
new Extractor({ strategies: [images, dynamicStrategy] });
declare const model: LanguageModel;
// @ts-expect-error Functional vision keeps its image requirement literal.
createCheckedExtractor({ loaders: [text], strategies: [vision({ model })] });
createCheckedExtractor({ loaders: [text], strategies: [llm({ model })] });
