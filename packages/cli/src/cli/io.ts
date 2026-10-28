/**
 * The seam between the commands and the process.
 *
 * Two streams, and the split is load-bearing: **stdout carries data, stderr
 * carries everything a human reads**. That is what makes
 *
 * ```sh
 * docture extract invoice.pdf --schema ./invoice.ts | jq '.results[0].data.total'
 * ```
 *
 * work while still printing which strategy answered and what it cost.
 *
 * Every command takes an `Io` rather than touching `process`, so a test drives the
 * whole CLI in-process and asserts on captured strings.
 */

import { addAbortSignal, type Readable } from "node:stream";

export interface Io {
  /** Data. Machine-readable, pipeable, never decorated. */
  write(chunk: string): void;
  /** Diagnostics: progress, warnings, errors, summaries. */
  diagnostic(chunk: string): void;
  /** Every byte of standard input, for a `-` file argument. Called at most once per run. */
  readStdin(signal?: AbortSignal): Promise<Uint8Array>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Whether stderr can take ANSI colour. */
  readonly color: boolean;
  /** Whether stdout can take ANSI colour. */
  readonly stdoutColor: boolean;
}

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
}

const PLAIN: Style = {
  bold: (t) => t,
  dim: (t) => t,
  red: (t) => t,
  green: (t) => t,
  yellow: (t) => t,
  cyan: (t) => t,
};

const CSI = "\u001b[";

function sgr(open: number, close: number): (text: string) => string {
  return (text) => `${CSI}${open}m${text}${CSI}${close}m`;
}

const ANSI: Style = {
  bold: sgr(1, 22),
  dim: sgr(2, 22),
  red: sgr(31, 39),
  green: sgr(32, 39),
  yellow: sgr(33, 39),
  cyan: sgr(36, 39),
};

export function styleFor(color: boolean): Style {
  return color ? ANSI : PLAIN;
}

/**
 * The real process.
 *
 * Each stream follows its own terminal and honours `NO_COLOR`.
 */
export function processIo(): Io {
  return {
    write: (chunk) => void process.stdout.write(chunk),
    diagnostic: (chunk) => void process.stderr.write(chunk),
    readStdin: (signal) => readAll(process.stdin, signal),
    cwd: process.cwd(),
    env: process.env,
    color: process.stderr.isTTY === true && process.env["NO_COLOR"] === undefined,
    stdoutColor: process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined,
  };
}

async function readAll(stream: Readable, signal: AbortSignal | undefined): Promise<Uint8Array> {
  signal?.throwIfAborted();
  if (signal !== undefined) addAbortSignal(signal, stream);
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of stream) chunks.push(chunk as Uint8Array);
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
  return Buffer.concat(chunks);
}

/** Collects both streams. The whole reason commands take an `Io`. */
export interface CapturedIo extends Io {
  readonly stdout: string;
  readonly stderr: string;
}

export interface CaptureOptions extends Partial<Omit<Io, "readStdin">> {
  /** What `readStdin` returns. Empty by default. */
  readonly stdin?: Uint8Array;
}

export function captureIo(overrides: CaptureOptions = {}): CapturedIo {
  let stdout = "";
  let stderr = "";
  const stdin = overrides.stdin ?? new Uint8Array();
  return {
    readStdin: async (signal) => {
      signal?.throwIfAborted();
      return stdin;
    },
    write: (chunk) => {
      stdout += chunk;
    },
    diagnostic: (chunk) => {
      stderr += chunk;
    },
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? {},
    color: overrides.env?.["NO_COLOR"] === undefined && (overrides.color ?? false),
    stdoutColor: overrides.env?.["NO_COLOR"] === undefined && (overrides.stdoutColor ?? false),
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}
