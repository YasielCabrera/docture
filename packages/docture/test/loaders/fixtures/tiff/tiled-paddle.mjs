import { register } from "node:module";
import { pathToFileURL } from "node:url";

const [root] = process.argv.slice(2);

const engine = "export class PaddleOcrService { async initialize() {} async batchRecognize(images) { " +
  "return images.map(() => ({ text: '', confidence: 1, results: [] })); } async destroy() {} }";
const hooks = "export async function resolve(specifier, context, next) { " +
  "return specifier === 'ppu-paddle-ocr' ? { url: " + JSON.stringify(`data:text/javascript,${encodeURIComponent(engine)}`) +
  ", shortCircuit: true } : next(specifier, context); }";
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const { DocumentLoaderPaddleOcr } = await import(pathToFileURL(root + "/packages/docture/src/loaders/paddleocr/index.ts").href);
const { silentLogger } = await import(pathToFileURL(root + "/packages/docture/src/core/index.ts").href);
const { tiledTiff } = await import(pathToFileURL(root + "/packages/docture/test/loaders/fixtures/tiff/crafted.ts").href);

const loader = new DocumentLoaderPaddleOcr();
const document = await loader.load(
  { bytes: tiledTiff(32, 32, 16, 16), mimeType: "image/tiff" },
  { signal: new AbortController().signal, logger: silentLogger },
);
const png = await document.pages[0].image();
const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
await loader.dispose();
process.stderr.write(JSON.stringify([document.pages.length, [...png.subarray(1, 4)], header.getUint32(16), header.getUint32(20)]));
