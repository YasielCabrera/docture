import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const docs = resolve(root, "apps/docs");
const requireDocs = createRequire(resolve(docs, "package.json"));
const { values } = parseArgs({ options: {
  output: { type: "string" },
  release: { type: "boolean" },
} });

const result = spawnSync(process.execPath, ["--import", requireDocs.resolve("tsx"), "scripts/build-package-docs.ts",
  ...values.output === undefined ? [] : ["--output", resolve(values.output)],
  ...values.release || process.env.npm_command === "publish" ? ["--release"] : [],
], { cwd: docs, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
