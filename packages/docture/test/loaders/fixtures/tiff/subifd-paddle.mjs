import { register } from "node:module";
import { pathToFileURL } from "node:url";

const [root, depth] = process.argv.slice(2);

const engine = "export class PaddleOcrService { async initialize() {} async batchRecognize(images) { " +
  "return images.map(() => ({ text: '', confidence: 1, results: [] })); } async destroy() {} }";
const hooks = "export async function resolve(specifier, context, next) { " +
  "return specifier === 'ppu-paddle-ocr' ? { url: " + JSON.stringify(`data:text/javascript,${encodeURIComponent(engine)}`) +
  ", shortCircuit: true } : next(specifier, context); }";
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const { DocumentLoaderPaddleOcr } = await import(pathToFileURL(root + "/packages/docture/src/loaders/paddleocr/index.ts").href);
const { silentLogger } = await import(pathToFileURL(root + "/packages/docture/src/core/index.ts").href);
const { subIfdFanOut } = await import(pathToFileURL(root + "/packages/docture/test/loaders/fixtures/tiff/crafted.ts").href);

const loader = new DocumentLoaderPaddleOcr();
const document = await loader.load(
  { bytes: subIfdFanOut(Number(depth)), mimeType: "image/tiff" },
  { signal: new AbortController().signal, logger: silentLogger },
);
await loader.dispose();
console.log(JSON.stringify(document.pages.map((page) => [page.pageNumber, page.width, page.height])));
