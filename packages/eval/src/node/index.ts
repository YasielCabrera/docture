import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { RunInfo } from "../result/types.js";
export { fileDocument, folderDataset, jsonlDataset, type FolderDatasetOptions } from "./dataset.js";
export { fileRunStore, readEvalResult, runDirectory, writeEvalResult } from "./store.js";
export { writeFileAtomic, liveArtifact, type LiveArtifact } from "./artifacts.js";
function hasChanges(cwd: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["status", "--porcelain"], { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    let changed = false;
    child.stdout.once("data", () => {
      changed = true;
      child.kill();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (changed || code === 0) resolve(changed);
      else reject(new Error(`git status exited with ${String(code)}`));
    });
  });
}

/**
 * Read repository provenance on demand, returning undefined outside a Git repository. A detached HEAD reports
 * the branch `detached@<first 12 hex digits of the sha>`, which never matches another commit's runs.
 */
export async function gitInfo(cwd: string): Promise<RunInfo["git"]> {
  const run = promisify(execFile);
  const git = async (args: string[]) => (await run("git", args, { cwd, timeout: 5000 })).stdout.trim();
  try {
    const sha = await git(["rev-parse", "HEAD"]);
    const [branch, dirty] = await Promise.all([
      git(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => `detached@${sha.slice(0, 12)}`),
      hasChanges(cwd),
    ]);
    return { branch, sha, dirty };
  } catch {
    return undefined;
  }
}
