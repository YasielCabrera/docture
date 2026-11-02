import { fileURLToPath } from "node:url";
import { processIo, run } from "@docture/cli";

export async function runExample() {
  const io = { ...processIo(), cwd: fileURLToPath(new URL(".", import.meta.url)) };
  return run(["extract", "invoice.pdf", "--config", "docture.config.ts"], { io });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await runExample();
