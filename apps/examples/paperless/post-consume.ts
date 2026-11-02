import { pathToFileURL } from "node:url";
import { enqueuePostConsume } from "./triggers.js";

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await enqueuePostConsume(process.env).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Queue submission failed."); process.exitCode = 1; });
}
