import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tsx = createRequire(new URL("../../../apps/docs/package.json", import.meta.url)).resolve("tsx/esm");
const io = new URL("../src/cli/io.ts", import.meta.url).href;

type Plan = "abort-idle" | "pre-aborted" | "read-to-end" | "abort-after-chunk";

const CHILD = `
import { getEventListeners } from "node:events";
import { processIo } from ${JSON.stringify(io)};
const plan = process.argv.at(-1);
const controller = new AbortController();
if (plan === "pre-aborted") controller.abort(new Error("stopped before reading"));
const outcome = processIo().readStdin(controller.signal).then(
  (bytes) => "resolved:" + new TextDecoder().decode(bytes),
  (error) => "rejected:" + (error instanceof Error ? error.name + ":" + error.message : String(error)),
);
if (plan.startsWith("abort")) setTimeout(() => controller.abort(), 300);
const watchdog = setTimeout(() => process.stdout.write("pending"), 3000);
process.stdout.write(await outcome);
clearTimeout(watchdog);
if (plan === "pre-aborted") process.stdout.write("|flowing:" + String(process.stdin.readableFlowing));
if (plan === "read-to-end") process.stdout.write("|abort listeners:" + getEventListeners(controller.signal, "abort").length);
`;

async function readInChild(plan: Plan, feed: (stdin: NodeJS.WritableStream) => void = () => undefined) {
  const child = spawn(process.execPath, ["--import", tsx, "--input-type=module", "--eval", CHILD, plan], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  feed(child.stdin);
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  const exit = await new Promise<number | string | null>((resolve) =>
    child.on("exit", (code, signal) => resolve(code ?? signal)),
  );
  clearTimeout(timer);
  child.stdin.destroy();
  return { stdout, stderr, exit };
}

describe("reading stdin from the real process", () => {
  it("rejects an idle read as soon as the signal aborts and lets the process exit", async () => {
    const result = await readInChild("abort-idle");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("rejected:AbortError:This operation was aborted");
    expect(result.exit).toBe(0);
  }, 20_000);

  it("rejects with the abort reason without touching stdin when already aborted", async () => {
    const result = await readInChild("pre-aborted");

    expect(result.stdout).toBe("rejected:Error:stopped before reading|flowing:null");
    expect(result.exit).toBe(0);
  }, 20_000);

  it("returns every chunk once stdin ends", async () => {
    const result = await readInChild("read-to-end", (stdin) => {
      stdin.write("INV-1 ");
      setTimeout(() => stdin.end("42"), 100);
    });

    expect(result.stdout).toBe("resolved:INV-1 42|abort listeners:0");
    expect(result.exit).toBe(0);
  }, 20_000);

  it("rejects a read that already received a chunk when the signal aborts before the end", async () => {
    const result = await readInChild("abort-after-chunk", (stdin) => stdin.write("INV-1 "));

    expect(result.stdout).toBe("rejected:AbortError:This operation was aborted");
    expect(result.exit).toBe(0);
  }, 20_000);
});
