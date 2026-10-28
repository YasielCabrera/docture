import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("container recipe uses both real package tarballs and an explicit Linux PDF engine set", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /pnpm --dir packages\/docture pack --out \/artifacts\/docture\.tgz/);
  assert.match(dockerfile, /pnpm --dir packages\/cli pack --out \/artifacts\/cli\.tgz/);
  assert.match(dockerfile, /npm install[^\n]*\/artifacts\/docture\.tgz \/artifacts\/cli\.tgz/);
  assert.match(dockerfile, /pdfjs-dist@6\.2\.108/);
  assert.match(dockerfile, /@napi-rs\/canvas@1\.0\.10/);
  assert.match(dockerfile, /@napi-rs\/canvas-linux-x64-gnu@1\.0\.10/);
  assert.match(dockerfile, /TARGETARCH.*amd64/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /ENTRYPOINT \["node",/);
  assert.doesNotMatch(dockerfile, /(?:tesseract|paddle|mupdf|onnxruntime|traineddata)/i);
  const workflow = await readFile(new URL("../.github/workflows/container-release.yml", import.meta.url), "utf8");
  assert.match(workflow, /container-smoke\.mjs/);
  assert.match(workflow, /inputs\.publish == true/);
  assert.match(workflow, /linux\/amd64/);
});

test("container builds and runs native PDF conversion, service parity and graceful shutdown", { timeout: 900_000 }, async (context) => {
  const probe = spawnSync("docker", ["info", "--format", "{{.OSType}}"], { encoding: "utf8", timeout: 10_000 });
  if (probe.status !== 0 || probe.stdout.trim() !== "linux") {
    if (process.env.RUN_CONTAINER === "1") assert.fail(`Docker is required: ${probe.error?.message ?? probe.stderr}`);
    context.skip("A working Docker Linux daemon is unavailable; image/native-platform behavior is not verified.");
    return;
  }
  const tag = `docture-local-test:${process.pid}`;
  try {
    const prepare = spawnSync("pnpm", ["--filter", "docture", "--filter", "@docture/cli", "-r", "build"], { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    assert.equal(prepare.status, 0, prepare.error?.message ?? prepare.stderr);
    const build = spawnSync("docker", ["build", "--platform", "linux/amd64", "--tag", tag, "."], { cwd: root, encoding: "utf8", timeout: 600_000, maxBuffer: 10 * 1024 * 1024 });
    assert.equal(build.status, 0, build.error?.message ?? build.stderr);
    const smoke = spawnSync(process.execPath, ["scripts/container-smoke.mjs", tag], { cwd: root, encoding: "utf8", timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
    assert.equal(smoke.status, 0, smoke.error?.message ?? smoke.stderr);
  } finally { spawnSync("docker", ["image", "rm", tag], { encoding: "utf8", timeout: 10_000 }); }
});
