/**
 * `docture classify` — what kind of document is this?
 *
 * Separate from `extract` because it is separate in the library: classification is
 * demand-driven, and reading one verdict is far cheaper than paying for a full
 * extraction to discover the router sent a receipt down the invoice path.
 */

import type { ClassificationResult } from "docture";
import { boolFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { explain, UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { resolveConfig } from "../config.js";
import { expandInputs } from "../inputs.js";
import { commonOptions, wiringFlags } from "../options.js";
import { toJson } from "../output.js";
import { buildWiring } from "../wiring.js";

interface Verdict {
  readonly file: string;
  readonly ok: boolean;
  readonly name?: string;
  readonly confidence?: number;
  readonly signals?: ClassificationResult["signals"];
  readonly error?: string;
}

/**
 * Run `task` over `items`, `limit` at a time, keeping results in input order.
 *
 * `extractBatch` does this for extraction; classification has no batch form
 * because a classifier is cheap enough that the pool is the only part worth
 * sharing.
 */
async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await task(item, index);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function classifyCommand(
  parsed: Parsed,
  io: Io,
  signal: AbortSignal,
): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const asJson = boolFlag(parsed, "json");
  const concurrency = numberFlag(parsed, "concurrency", { min: 1, max: 64, integer: true });

  const config = await resolveConfig({
    cwd: io.cwd,
    ...(common.configPath === undefined ? {} : { explicit: common.configPath }),
    ...(common.noConfig ? { disabled: true } : {}),
  });

  const inputs = await expandInputs(parsed.positionals, io.cwd);
  const wiring = await buildWiring({
    io,
    ...(config === undefined ? {} : { config }),
    // A classification is only ever produced by a classifier, and the only one the
    // flags can build is the model's. `--classify` is implied here — asking for the
    // command is asking for the thing.
    flags: { ...wiringFlags(parsed), classify: true },
    needsModel: false,
  });

  if (wiring.classifications.length === 0) {
    await wiring.dispose();
    throw new UsageError(
      "`docture classify` needs candidate document kinds.",
      "Pass --classifications ./kinds.ts, or set `classifications` in docture.config.ts.",
    );
  }
  // Kinds with nobody to choose between them can only ever answer UNKNOWN. Better
  // to say the wiring is incomplete than to hand back a page of confident nothing.
  if (wiring.classifiers !== undefined && wiring.classifiers.length === 0) {
    await wiring.dispose();
    throw new UsageError(
      "Nothing is wired that could classify anything.",
      "Pass --model <provider>/<model-id>, or declare `classifiers` in docture.config.ts.",
    );
  }

  if (!common.quiet) {
    if (common.verbose) {
      for (const note of wiring.notes) io.diagnostic(`${style.dim("·")} ${style.dim(note)}\n`);
    }
    for (const warning of wiring.warnings) {
      // The "no candidate kinds" warning cannot fire here: the check above already
      // turned that case into a usage error.
      io.diagnostic(`${style.yellow("!")} ${warning}\n`);
    }
  }

  let failed = 0;
  let verdicts: Verdict[];

  try {
    verdicts = await pooled(inputs, concurrency ?? wiring.concurrency, async (input) => {
      try {
        const result = await wiring.extractor.classify(input.source, undefined, { signal });
        return {
          file: input.label,
          ok: true,
          name: result.name,
          confidence: result.confidence,
          signals: result.signals,
        };
      } catch (error) {
        failed += 1;
        return { file: input.label, ok: false, error: explain(error).message };
      }
    });
  } finally {
    await wiring.dispose();
  }

  if (asJson) {
    io.write(toJson(verdicts));
  } else {
    const width = Math.max(...verdicts.map((v) => v.file.length));
    for (const verdict of verdicts) {
      if (!verdict.ok) {
        io.write(`${verdict.file.padEnd(width)}  ${style.red("error")}  ${verdict.error ?? ""}\n`);
        continue;
      }
      const confidence = `${((verdict.confidence ?? 0) * 100).toFixed(0)}%`;
      const name = verdict.name === "UNKNOWN" ? style.yellow("UNKNOWN") : style.bold(verdict.name ?? "");
      io.write(`${verdict.file.padEnd(width)}  ${name}  ${style.dim(confidence)}\n`);

      if (common.verbose) {
        for (const s of verdict.signals ?? []) {
          const said = s.name ?? "abstained";
          const note = s.note === undefined ? "" : ` — ${s.note}`;
          io.write(
            `${" ".repeat(width)}    ${style.dim(`${s.classifier}: ${said} ${(s.confidence * 100).toFixed(0)}%${note}`)}\n`,
          );
        }
      }
    }
  }

  if (failed > 0 && !common.quiet) {
    io.diagnostic(
      `${style.red("✗")} ${failed} of ${inputs.length} could not be classified\n`,
    );
  }
  return failed === 0 ? 0 : 1;
}
