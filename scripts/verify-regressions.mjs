import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(process.env.DOCTURE_PROOF_MANIFEST ?? join(root, ".audit/phase2-proofs.json"), "utf8"));
const proofs = manifest.proofs;
const baselineRef = manifest.baseline;
const [mode, ...selected] = process.argv.slice(2);
if (mode !== "baseline" && mode !== "current") throw new Error("Use baseline or current, followed by optional ticket refs");
const tickets = selected.length === 0 ? Object.keys(proofs) : selected;
const baseline = process.env.DOCTURE_PROOF_BASELINE;
if (mode === "baseline" && baseline === undefined) throw new Error("Set DOCTURE_PROOF_BASELINE to a detached baseline checkout");
const logs = resolve(process.env.DOCTURE_PROOF_LOGS ?? join(root, ".audit/phase2-results"));
mkdirSync(logs, { recursive: true });
for (const ticket of tickets) {
  const proof = proofs[ticket];
  if (proof === undefined) throw new Error(`Unknown proof ${ticket}`);
  const packagePath = proof.package === "docture" ? "packages/docture" : "packages/cli";
  if (mode === "baseline") {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: baseline, encoding: "utf8" });
    if (head.stdout.trim() !== baselineRef) throw new Error(`Proof baseline must be ${baselineRef}`);
    const changed = spawnSync("git", ["diff", "--name-only", baselineRef], { cwd: baseline, encoding: "utf8" });
    const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: baseline, encoding: "utf8" });
    const unexpected = `${changed.stdout}\n${untracked.stdout}`.split("\n")
      .filter((file) => file !== "" && !/^packages\/(docture|cli)\/test\//.test(file));
    if (changed.status !== 0 || untracked.status !== 0 || unexpected.length > 0) {
      throw new Error(`Baseline has changes outside tests: ${unexpected.join(", ")}`);
    }
    for (const file of proof.files) {
      const target = join(baseline, packagePath, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(root, packagePath, file), target);
    }
  }
  const cwd = join(mode === "baseline" ? baseline : root, packagePath);
  const reportPath = join(logs, `${ticket.toLowerCase()}-${mode}.json`);
  rmSync(reportPath, { force: true });
  const args = ["exec", "vitest", "run", ...proof.files, "-t", proof.test,
    "--reporter=default", "--reporter=json", `--outputFile.json=${reportPath}`];
  const result = spawnSync("pnpm", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const output = result.stdout + result.stderr;
  const log = join(logs, `${ticket.toLowerCase()}-${mode}.log`);
  writeFileSync(log, output);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
  const byName = new Map(assertions.map((assertion) => [assertion.fullName, assertion]));
  const red = proof.expectedRed;
  const green = proof.expectedGreen;
  if (!Array.isArray(red) || red.length === 0 || !Array.isArray(green)) {
    throw new Error(`${ticket} must declare its expected red and green baseline tests`);
  }
  const required = [...red, ...green];
  const allPresent = required.every((name) => byName.has(name));
  const failed = assertions.filter((assertion) => assertion.status === "failed");
  const expected = mode === "baseline"
    ? allPresent && result.status !== 0 && failed.length === red.length
      && red.every((name) => byName.get(name).status === "failed"
        && byName.get(name).failureMessages.some((message) => message.includes("AssertionError")))
      && green.every((name) => byName.get(name).status === "passed")
      && !/Failed Suites|Unhandled Errors/.test(output)
    : allPresent && result.status === 0 && report.success
      && required.every((name) => byName.get(name).status === "passed");
  console.log(`${ticket} ${mode} exit=${result.status} ${expected ? "VERIFIED" : "NOT VERIFIED"} red=${red.length} green=${green.length} ${log}`);
  if (!expected) {
    console.error(output.slice(-7000));
    process.exitCode = 1;
  }
}
