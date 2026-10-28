import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [root] = process.argv.slice(2);
const { DocumentLoaderPaddleOcr } = await import(pathToFileURL(root + "/packages/docture/src/loaders/paddleocr/index.ts").href);
const { silentLogger } = await import(pathToFileURL(root + "/packages/docture/src/core/index.ts").href);

const looping = new Uint8Array(readFileSync(new URL("./pages-lzw.tif", import.meta.url)));
const view = new DataView(looping.buffer);
view.setUint32(3792 + 2 + 12 * view.getUint16(3792, true), 1682, true);
const garbage = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0xff, 0xff]);

const loader = new DocumentLoaderPaddleOcr();
const messages = [];
for (const bytes of [looping, garbage]) {
  const error = await loader.load({ bytes, mimeType: "image/tiff" }, { signal: new AbortController().signal, logger: silentLogger })
    .then(() => undefined, (failure) => failure);
  messages.push(error instanceof Error ? error.message : String(error));
}
await loader.dispose();
console.log(JSON.stringify(messages));
