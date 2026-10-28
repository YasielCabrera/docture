import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { boolFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { UsageError, type ExitCode } from "../cli/errors.js";
import type { Io } from "../cli/io.js";
import { resolveConfig } from "../config.js";
import { commonOptions } from "../options.js";
import { toJson } from "../output.js";
import { refuseInputAliases, refuseMissingLeafAliases } from "../output-safety.js";
import { runPaperlessAction, type PaperlessAction, type PaperlessSelection } from "../paperless/operations.js";

async function readPlan(path: string): Promise<unknown> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) throw new UsageError("Paperless plan input exceeds the 4 MiB limit.");
    chunks.push(Buffer.from(chunk));
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8")); return parsed;
}

function selected(parsed: Parsed): PaperlessSelection {
  const value = parsed.positionals[1]; const query = stringFlag(parsed, "query");
  if (value !== undefined && query !== undefined || value === undefined && query === undefined) throw new UsageError("Select one Paperless document ID or --query with a bounded --limit.");
  const versionId = numberFlag(parsed, "version", { min: 1, integer: true });
  if (value !== undefined) {
    if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new UsageError("Paperless document ID must be a positive integer.");
    return { documentId: Number(value), ...(versionId === undefined ? {} : { versionId }) };
  }
  if (versionId !== undefined) throw new UsageError("--version requires a single Paperless document ID.");
  const limit = numberFlag(parsed, "limit", { min: 1, integer: true });
  return { query: query ?? "", ...(limit === undefined ? {} : { limit }) };
}

export async function paperlessCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const name = parsed.positionals[0]; const dryRun = boolFlag(parsed, "dry-run");
  if (dryRun && (name === "read" || name === "search")) throw new UsageError("--dry-run applies to Paperless extract, plan and apply.");
  const schemaName = stringFlag(parsed, "schema");
  let planPath: string | undefined;
  let action: PaperlessAction;
  if (name === "read") {
    const selection = selected(parsed); if (!("documentId" in selection)) throw new UsageError("paperless read needs one document ID. Use search for a query.");
    action = { kind: "read", ...selection };
  } else if (name === "search") {
    if (parsed.positionals[1] !== undefined) throw new UsageError("paperless search takes --query, not an extra positional argument.");
    const limit = numberFlag(parsed, "limit", { min: 1, integer: true });
    action = { kind: "search", ...(stringFlag(parsed, "query") === undefined ? {} : { query: stringFlag(parsed, "query") ?? "" }), ...(limit === undefined ? {} : { limit }) };
  } else if (name === "extract" || name === "plan") {
    if (schemaName === undefined) throw new UsageError("Paperless extraction needs --schema <configured-name>.");
    action = { kind: name, schemaName, selection: selected(parsed), ...(dryRun ? { dryRun: true } : {}) };
  } else if (name === "apply") {
    if (schemaName === undefined || parsed.positionals[1] === undefined) throw new UsageError("paperless apply needs a saved plan file and --schema <configured-name>.");
    let plan: unknown;
    planPath = resolve(io.cwd, parsed.positionals[1]);
    try { plan = await readPlan(planPath); }
    catch (error) { if (error instanceof UsageError) throw error; throw new UsageError("Paperless apply input must be a readable JSON plan file."); }
    if (typeof plan === "object" && plan !== null && "results" in plan && Array.isArray(plan.results) && plan.results.length === 1) {
      const item: unknown = plan.results[0]; if (typeof item === "object" && item !== null && "plan" in item) plan = item.plan;
    }
    action = { kind: "apply", schemaName, plan, ...(dryRun ? { dryRun: true } : {}) };
  } else throw new UsageError("Paperless action must be read, search, extract, plan or apply.");
  if (parsed.positionals.length > 2) throw new UsageError("Paperless accepts one action and one document ID or plan file.");
  const config = await resolveConfig({ cwd: io.cwd, ...(common.configPath === undefined ? {} : { explicit: common.configPath }), ...(common.noConfig ? { disabled: true } : {}) });
  if (config === undefined) throw new UsageError("Paperless requires docture.config with connection and named schemas.");
  const out = stringFlag(parsed, "out");
  const outputPath = out === undefined ? undefined : resolve(io.cwd, out);
  if (outputPath !== undefined) {
    const protectedInputs = [{ label: "Paperless configuration", path: config.path }, ...(planPath === undefined ? [] : [{ label: "Paperless plan", path: planPath }])];
    await refuseInputAliases(protectedInputs, [outputPath]);
    await refuseMissingLeafAliases(protectedInputs, [outputPath]);
  }
  const result = await runPaperlessAction(action, { io, config, signal });
  if (outputPath === undefined) io.write(toJson(result)); else { await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, toJson(result)); }
  return result.ok ? 0 : 1;
}
