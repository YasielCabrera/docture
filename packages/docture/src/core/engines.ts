import { MissingEngineError } from "./pipeline/errors.js";

export const ENGINE_RANGES = {
  "pdfjs-dist": "^6.2.108",
  mupdf: "~1.28.0",
  "tesseract.js": "7.0.0",
  "ppu-paddle-ocr": "6.3.0",
  "onnxruntime-node": "1.27.0",
  "@napi-rs/canvas": "^1.0.10",
  utif2: "4.1.0",
} as const;

export type Engine = keyof typeof ENGINE_RANGES;

export function lazyEngine<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => {
    if (cached === undefined) {
      const attempt = Promise.resolve().then(load);
      cached = attempt;
      void attempt.catch(() => {
        if (cached === attempt) cached = undefined;
      });
    }
    return cached;
  };
}

export async function importEngine<T>(
  entry: string,
  engines: readonly Engine[],
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const missing = missingPackage(error);
    const engine = engines.find((name) => name === missing);
    if (engine === undefined) throw error;
    throw new MissingEngineError(engine, ENGINE_RANGES[engine], entry, { cause: error });
  }
}

function missingPackage(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_MODULE_NOT_FOUND") return undefined;
  return /^Cannot find package '([^']+)' imported from /.exec(error.message)?.[1];
}
