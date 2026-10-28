import type { ExitCode } from "./cli/errors.js";
import type { Io } from "./cli/io.js";
import type { Input } from "./inputs.js";
import { envelope, toJson, type Command } from "./output.js";

export type PlannedInput =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "stdin" };

export type PlannedOutput = { readonly to: "stdout" } | { readonly to: "file"; readonly path: string };

function plannedInput(input: Input): PlannedInput {
  switch (input.kind) {
    case "path":
      return { kind: "path", path: input.path };
    case "url":
      return { kind: "url", url: input.url };
    case "stdin":
      return { kind: "stdin" };
  }
}

/** Print one plan per input, then dispose the wiring the plan was read from. */
export async function emitPlan(
  io: Io,
  command: Command,
  inputs: readonly Input[],
  wiring: { dispose(): Promise<void> },
  planOf: (input: Input, index: number) => object,
): Promise<ExitCode> {
  try {
    const results = inputs.map((input, index) => ({
      file: input.label,
      ok: true as const,
      plan: { input: plannedInput(input), ...planOf(input, index) },
    }));
    io.write(toJson(envelope(command, results, { dryRun: true })));
  } finally {
    await wiring.dispose();
  }
  return 0;
}
