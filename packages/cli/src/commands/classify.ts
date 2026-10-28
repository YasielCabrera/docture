/**
 * `docture classify` — what kind of document is this?
 *
 * Separate from `extract` because it is separate in the library: classification is
 * demand-driven, and reading one verdict is far cheaper than paying for a full
 * extraction to discover the router sent a receipt down the invoice path.
 */

import type { ClassificationResult } from "docture";
import { boolFlag, choiceFlag, numberFlag, type Parsed } from "../cli/args.js";
import { explain, UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { OUTPUT_FORMAT } from "../cli/specs.js";
import { resolveConfig } from "../config.js";
import { expandInputs, sourcesOf } from "../inputs.js";
import { commonOptions, wiringFlags } from "../options.js";
import {
  envelope,
  errorRecord,
  reportFailure,
  reportWiring,
  toJson,
  toNdjson,
  type Item,
} from "../output.js";
import { emitPlan } from "../plan.js";
import { buildWiring, planWiring, type WiringInput, type WiringPlan } from "../wiring.js";

type Verdict = Item<Pick<ClassificationResult, "name" | "confidence" | "signals">>;

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

async function refuseIncomplete(wiring: WiringPlan): Promise<void> {
  if (wiring.classifications.length === 0) {
    await wiring.dispose();
    throw new UsageError(
      "`docture classify` needs candidate document kinds.",
      "Pass --classifications ./kinds.ts, or set `classifications` in docture.config.ts.",
    );
  }
  if (!("opaque" in wiring.pipeline) && wiring.pipeline.classifiers.length === 0) {
    await wiring.dispose();
    throw new UsageError(
      "Nothing is wired that could classify anything.",
      "Pass --model <provider>/<model-id>, or declare `classifiers` in docture.config.ts.",
    );
  }
}

export async function classifyCommand(
  parsed: Parsed,
  io: Io,
  signal: AbortSignal,
): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const format = choiceFlag(parsed, OUTPUT_FORMAT) ?? "text";
  const concurrency = numberFlag(parsed, "concurrency", { min: 1, max: 64, integer: true });

  const config = await resolveConfig({
    cwd: io.cwd,
    ...(common.configPath === undefined ? {} : { explicit: common.configPath }),
    ...(common.noConfig ? { disabled: true } : {}),
  });

  const inputs = await expandInputs(parsed.positionals, io.cwd);
  const wiringInput: WiringInput = {
    io,
    ...(config === undefined ? {} : { config }),
    // A classification is only ever produced by a classifier, and the only one the
    // flags can build is the model's. `--classify` is implied here — asking for the
    // command is asking for the thing.
    flags: { ...wiringFlags(parsed), classify: true },
    needsModel: false,
  };

  if (boolFlag(parsed, "dry-run")) {
    const plan = await planWiring(wiringInput);
    await refuseIncomplete(plan);
    reportWiring(io, common, style, plan.notes, plan.warnings);
    return emitPlan(io, "classify", inputs, plan, () => ({
      ...plan.pipeline,
      classifications: plan.classifications.map((kind) => kind.name),
      output: { to: "stdout" },
    }));
  }

  const wiring = await buildWiring(wiringInput);
  await refuseIncomplete(wiring);
  reportWiring(io, common, style, wiring.notes, wiring.warnings);

  const hintsShown = new Set<string>();
  let failed = 0;
  let verdicts: Verdict[];

  try {
    const sources = await sourcesOf(inputs, io, signal);
    verdicts = await pooled(inputs, concurrency ?? wiring.concurrency, async (input, index) => {
      try {
        const result = await wiring.extractor.classify(sources[index]!, undefined, { signal });
        const record: Verdict = {
          file: input.label,
          ok: true,
          name: result.name,
          confidence: result.confidence,
          signals: result.signals,
        };
        if (format === "ndjson") io.write(toNdjson(record));
        return record;
      } catch (error) {
        failed += 1;
        const explained = explain(error);
        reportFailure(io, input.label, explained, style, hintsShown);
        const record = errorRecord(input.label, explained);
        if (format === "ndjson") io.write(toNdjson(record));
        return record;
      }
    });
  } finally {
    await wiring.dispose();
  }

  if (format === "json") {
    io.write(toJson(envelope("classify", verdicts)));
  } else if (format === "text") {
    const stdoutStyle = styleFor(io.stdoutColor && !boolFlag(parsed, "no-color") && io.env["NO_COLOR"] === undefined);
    const width = Math.max(...verdicts.map((v) => v.file.length));
    for (const verdict of verdicts) {
      if (!verdict.ok) {
        io.write(`${verdict.file.padEnd(width)}  ${stdoutStyle.red("error")}  ${verdict.error.message}\n`);
        continue;
      }
      const confidence = `${(verdict.confidence * 100).toFixed(0)}%`;
      const name = verdict.name === "UNKNOWN" ? stdoutStyle.yellow("UNKNOWN") : stdoutStyle.bold(verdict.name);
      io.write(`${verdict.file.padEnd(width)}  ${name}  ${stdoutStyle.dim(confidence)}\n`);

      if (common.verbose) {
        for (const s of verdict.signals) {
          const said = s.name ?? "abstained";
          const note = s.note === undefined ? "" : ` — ${s.note}`;
          io.write(
            `${" ".repeat(width)}    ${stdoutStyle.dim(`${s.classifier}: ${said} ${(s.confidence * 100).toFixed(0)}%${note}`)}\n`,
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
