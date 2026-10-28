import { DoctureError } from "../../core/pipeline/errors.js";

export class DoclingImportError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "DoclingImportError";
  override readonly code = "UNSUPPORTED_SOURCE" as const;
  constructor(readonly path: string, message: string) {
    super(`Invalid Docling export at ${path}: ${message}`);
  }
  override toJSON() { return { ...super.toJSON(), path: this.path }; }
}

export type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) throw new DoclingImportError(path, "expected an object");
  return value;
}

export function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new DoclingImportError(path, "expected an array");
  return value;
}

export function text(value: unknown, path: string): string {
  if (typeof value !== "string") throw new DoclingImportError(path, "expected text");
  return value;
}

export function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new DoclingImportError(path, "expected a finite number");
  return value;
}

export function integer(value: unknown, path: string, minimum = 0): number {
  const number = finite(value, path);
  if (!Number.isSafeInteger(number) || number < minimum) throw new DoclingImportError(path, `expected an integer >= ${minimum}`);
  return number;
}

export interface DoclingImportLimits {
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly maxBytes?: number;
  readonly maxPages?: number;
  readonly maxTableCells?: number;
}

export function checkedLimits(input: DoclingImportLimits = {}) {
  return {
    maxNodes: integer(input.maxNodes ?? 100_000, "limits.maxNodes", 1),
    maxDepth: integer(input.maxDepth ?? 100, "limits.maxDepth", 1),
    maxBytes: integer(input.maxBytes ?? 20_000_000, "limits.maxBytes", 1),
    maxPages: integer(input.maxPages ?? 10_000, "limits.maxPages", 1),
    maxTableCells: integer(input.maxTableCells ?? 100_000, "limits.maxTableCells", 1),
  };
}

export function canonicalJson(raw: unknown, limits: ReturnType<typeof checkedLimits>): string {
  const active = new Set<object>();
  let nodes = 0;
  let characters = 0;
  const walk = (value: unknown, depth: number): string => {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth) throw new DoclingImportError("$", "traversal limit exceeded");
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value === "string") {
      characters += value.length;
      if (characters > limits.maxBytes) throw new DoclingImportError("$", "input size limit exceeded");
      return JSON.stringify(value);
    }
    if (typeof value !== "object" || value === null) throw new DoclingImportError("$", "expected JSON data");
    if (active.has(value)) throw new DoclingImportError("$", "cyclic JSON data");
    active.add(value);
    let output: string;
    if (Array.isArray(value)) output = `[${value.map((item: unknown) => walk(item, depth + 1)).join(",")}]`;
    else {
      const object = record(value, "$");
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new DoclingImportError("$", "expected plain JSON objects");
      output = `{${Object.keys(object).sort().map((key) => `${walk(key, depth + 1)}:${walk(object[key], depth + 1)}`).join(",")}}`;
    }
    active.delete(value);
    return output;
  };
  const json = walk(raw, 0);
  if (new TextEncoder().encode(json).length > limits.maxBytes) throw new DoclingImportError("$", "input size limit exceeded");
  return json;
}
