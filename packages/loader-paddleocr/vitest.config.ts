import { defineConfig, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared.js";

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      include: ["test/**/*.test.ts", "src/**/*.test.ts"],
      // The first `RUN_OCR=1` run downloads the detection and recognition models
      // (~6.5 MB) and instantiates two ONNX sessions. The offline tests still finish
      // in milliseconds.
      testTimeout: 180_000,
    },
  }),
);
