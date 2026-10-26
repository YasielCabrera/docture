import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(new URL("../../../../apps/docs/package.json", import.meta.url));
const script = fileURLToPath(new URL("./fixtures/ocr-memory.mjs", import.meta.url));

describe("OCR raster ownership", () => {
  it.each(["tesseract", "paddleocr"])("releases %s recognition rasters while retaining lazy page images", (engine) => {
    const run = spawnSync(process.execPath, ["--expose-gc", "--import", require.resolve("tsx/esm"), script, root, engine], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ retained: 0, calls: 2, pages: 3 });
  });
});
