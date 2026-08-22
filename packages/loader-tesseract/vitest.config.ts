import { defineConfig, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared.js";

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      include: ["test/**/*.test.ts", "src/**/*.test.ts"],
      // OCR is seconds per page, and the first `RUN_OCR=1` run also fetches a ~5 MB
      // language model. The offline tests still finish in milliseconds.
      testTimeout: 180_000,
    },
  }),
);
