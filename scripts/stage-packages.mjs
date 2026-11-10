import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean" }, provenance: { type: "boolean" } } });
const root = fileURLToPath(new URL("../", import.meta.url));
const tarballs = mkdtempSync(join(tmpdir(), "docture-release-"));

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
  const directory = join(root, "packages", folder);
  const { name, version } = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const id = `${name}@${version}`;
  if (run("npm", ["view", id, "version"], { stdio: "ignore" }).status === 0) {
    console.log(`${id} is already published.`);
    continue;
  }
  const pending = values["dry-run"] ? null : run("npm", ["stage", "list", name, "--json"]);
  if (pending?.status === 0 && JSON.stringify(JSON.parse(pending.stdout)).includes(`"${version}"`)) {
    console.log(`${id} is already staged and waits for approval.`);
    continue;
  }

  // pnpm replaces the workspace: ranges with real versions; npm then stages that tarball unchanged.
  must("pnpm", ["pack", "--pack-destination", tarballs], { cwd: directory });
  const tarball = join(tarballs, `${name.replace("@", "").replace("/", "-")}-${version}.tgz`);
  if (folder === "docture") {
    const manifest = JSON.parse(must("tar", ["-xzOf", tarball, "package/docs/manifest.json"]));
    if (manifest.releaseStatus !== "release") {
      throw new Error("The packed documentation is not a release snapshot. Pack from a clean checkout without an Unreleased changelog section.");
    }
  }
  must("npm", [
    "stage", "publish", tarball, "--access", "public",
    ...values.provenance ? ["--provenance"] : [],
    ...values["dry-run"] ? ["--dry-run"] : [],
  ], { stdio: ["ignore", "inherit", "inherit"] });
  staged += 1;
}
console.log(values["dry-run"] ? `Dry run: ${staged} packages would be staged.` : `Staged ${staged} packages.`);
