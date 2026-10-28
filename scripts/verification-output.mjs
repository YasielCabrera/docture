import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

export async function cleanupConsumerInstalls(output) {
  for (const entry of await readdir(output, { withFileTypes: true })) {
    const path = join(output, entry.name);
    if (entry.name === "node_modules") await rm(path, { recursive: true, force: true });
    else if (entry.isDirectory()) await cleanupConsumerInstalls(path);
  }
}
