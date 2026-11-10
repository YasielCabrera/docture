import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  verified: { type: "string" },
  "dry-run": { type: "boolean" },
  provenance: { type: "boolean" },
} });
if (values.verified === undefined) {
  console.error("Usage: node scripts/stage-packages.mjs --verified DIR [--dry-run] [--provenance]\nDIR is the --output-dir of a passed pnpm verify:packages run.");
  process.exit(1);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const verified = resolve(values.verified);
const summary = JSON.parse(readFileSync(join(verified, "summary.json"), "utf8"));
if (summary.status !== "passed") throw new Error(`Package verification in ${verified} has status ${summary.status}.`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
  if (result.error) throw result.error;
  return result;
}

function must(command, args, options) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return result.stdout;
}

let staged = 0;
for (const folder of ["docture", "eval", "synthetic", "cli"]) {
  const { name, version } = JSON.parse(readFileSync(join(root, "packages", folder, "package.json"), "utf8"));
  const id = `${name}@${version}`;
  const record = summary.packages.find((pkg) => pkg.name === name && pkg.version === version);
  if (record === undefined) throw new Error(`The verification in ${verified} did not pack ${id}.`);
  const tarball = join(verified, "tarballs", basename(record.tarball));
  if (createHash("sha256").update(readFileSync(tarball)).digest("hex") !== record.sha256) {
    throw new Error(`${tarball} is not the tarball that was verified.`);
  }
  if (folder === "docture") {
    const manifest = JSON.parse(must("tar", ["-xzOf", tarball, "package/docs/manifest.json"]));
    if (manifest.releaseStatus !== "release") {
      throw new Error("The packed documentation is not a release snapshot. Verify from a clean checkout without an Unreleased changelog section.");
    }
  }

  if (run("npm", ["view", id, "version"], { stdio: "ignore" }).status === 0) {
    console.log(`${id} is already published.`);
    continue;
  }
  const pending = values["dry-run"] ? null : run("npm", ["stage", "list", name, "--json"]);
  if (pending?.status === 0 && JSON.stringify(JSON.parse(pending.stdout)).includes(`"${version}"`)) {
    console.log(`${id} is already staged and waits for approval.`);
    continue;
  }
  must("npm", [
    "stage", "publish", tarball, "--access", "public",
    ...values.provenance ? ["--provenance"] : [],
    ...values["dry-run"] ? ["--dry-run"] : [],
  ], { stdio: ["ignore", "inherit", "inherit"] });
  staged += 1;
}
console.log(values["dry-run"] ? `Dry run: ${staged} packages would be staged.` : `Staged ${staged} packages.`);
