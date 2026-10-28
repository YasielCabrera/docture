import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cleanupConsumerInstalls } from "./verification-output.mjs";

test("verification removes only the current run's installs and retains evidence", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "docture-cleanup-test-"));
  try {
    const output = join(sandbox, "current");
    const external = join(sandbox, "historical", "node_modules");
    for (const path of [join(output, "consumer", "node_modules", "engine"), join(output, "logs"), external]) {
      await mkdir(path, { recursive: true });
    }
    await writeFile(join(output, "logs", "failure.log"), "retained failure evidence");
    await writeFile(join(output, "summary.json"), '{"status":"failed"}');
    await writeFile(join(external, "keep.txt"), "historical install");
    await symlink(external, join(output, "linked-consumer"));
    await mkdir(join(output, "symlink-consumer"));
    await symlink(external, join(output, "symlink-consumer", "node_modules"));
    await cleanupConsumerInstalls(output);
    await assert.rejects(stat(join(output, "consumer", "node_modules")), { code: "ENOENT" });
    await assert.rejects(stat(join(output, "symlink-consumer", "node_modules")), { code: "ENOENT" });
    assert.equal(await readFile(join(output, "logs", "failure.log"), "utf8"), "retained failure evidence");
    assert.deepEqual(JSON.parse(await readFile(join(output, "summary.json"), "utf8")), { status: "failed" });
    assert.equal(await readFile(join(external, "keep.txt"), "utf8"), "historical install");
    await cleanupConsumerInstalls(output);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
