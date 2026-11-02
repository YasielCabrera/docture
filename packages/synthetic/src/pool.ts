import { canonicalDependency, type DependencyInputs } from "./dependencies.js";
import { SynthesisError, type SynthesisProblem } from "./errors.js";
import { isPlainObject } from "./schema.js";

type ValidationResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly { readonly message: string; readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined }[] };

/** A Standard Schema that validates outputs and describes its accepted JSON input. */
export interface RuntimeSchema<Output = unknown> {
  readonly "~standard": {
    readonly types?: { readonly input: unknown; readonly output: Output } | undefined;
    readonly validate: (value: unknown) => ValidationResult<Output> | Promise<ValidationResult<Output>>;
    readonly jsonSchema: { readonly input: (options: { readonly target: "draft-2020-12" }) => unknown };
  };
}

/** Storage for raw pool inputs. Hits are validated again before use. */
export interface PoolCache {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, values: readonly unknown[]): unknown;
}

/** An identified producer, or an offline lookup that cannot generate missing values. */
export type PoolSource =
  | { readonly kind: "generate"; readonly id: string; readonly generate: (count: number) => readonly unknown[] | Promise<readonly unknown[]> }
  | { readonly kind: "cache-only"; readonly id: string };

interface CommonPoolOptions<Output> {
  readonly schema: RuntimeSchema<Output>;
  /** Change when refinements or transforms change without changing JSON Schema. */
  readonly revision: string;
  readonly count: number;
  readonly dependencies?: DependencyInputs;
}

/** Inputs for a pool containing exactly count distinct validated outputs. */
export type ValuePoolOptions<Output = unknown> = CommonPoolOptions<Output> & (
  | { readonly source: Extract<PoolSource, { readonly kind: "generate" }>; readonly cache?: PoolCache }
  | { readonly source: Extract<PoolSource, { readonly kind: "cache-only" }>; readonly cache: PoolCache }
);

/** Produce or load a typed pool without depending on a particular generator or model provider. */
export async function valuePool<Output>(options: ValuePoolOptions<Output>): Promise<readonly Output[]> {
  if (!Number.isSafeInteger(options.count) || options.count < 1) throw new RangeError(`valuePool() needs a positive integer count, got ${options.count}`);
  if (typeof options.revision !== "string" || options.revision.trim().length === 0) throw new RangeError("valuePool() needs a nonempty validation revision");
  if (typeof options.source.id !== "string" || options.source.id.trim().length === 0) throw new RangeError("valuePool() needs a nonempty source id");
  const standard = options.schema?.["~standard"];
  if (typeof standard?.validate !== "function" || typeof standard.jsonSchema?.input !== "function") {
    throw new SynthesisError([{ path: "valuePool.schema", message: "requires a Standard Schema with runtime validation and input JSON Schema" }]);
  }
  const inputSchema = standard.jsonSchema.input({ target: "draft-2020-12" });
  if (!isPlainObject(inputSchema)) throw new SynthesisError([{ path: "valuePool.schema", message: "produced no input JSON Schema object" }]);
  const schema = { ...inputSchema };
  jsonIdentity(schema, "valuePool.schema");
  const key = canonicalDependency({ api: "valuePool/1", source: options.source.id, count: options.count, schema, revision: options.revision, dependencies: options.dependencies ?? {} });
  const cached: unknown = await options.cache?.get(key);
  if (cached !== undefined) return (await validatedPool(cached, options, "valuePool.cache")).values;
  if (options.source.kind === "cache-only") throw new SynthesisError([{ path: "valuePool.cache", message: `no cached pool for source "${options.source.id}"` }]);
  const generated: unknown = await options.source.generate(options.count);
  const pool = await validatedPool(generated, options, "valuePool.source");
  await options.cache?.set(key, pool.raw);
  return pool.values;
}

async function validatedPool<Output>(input: unknown, options: CommonPoolOptions<Output>, path: string): Promise<{ readonly raw: readonly unknown[]; readonly values: readonly Output[] }> {
  if (!Array.isArray(input) || input.length !== options.count) {
    throw new SynthesisError([{ path, message: `expected exactly ${options.count} raw values` }]);
  }
  jsonIdentity(input, path);
  const raw: unknown[] = structuredClone(input);
  const problems: SynthesisProblem[] = [];
  const values: Output[] = [];
  const seen = new Map<string, number>();
  for (const [index, item] of raw.entries()) {
    const result = await options.schema["~standard"].validate(structuredClone(item));
    if (result.issues !== undefined) {
      if (result.issues.length === 0) problems.push({ path: `${path}[${index}]`, message: "validator rejected the value without an issue message" });
      for (const issue of result.issues) {
        const suffix = (issue.path ?? []).map((part) => typeof part === "object" ? String(part.key) : String(part)).join(".");
        problems.push({ path: `${path}[${index}]${suffix.length > 0 ? `.${suffix}` : ""}`, message: issue.message });
      }
      continue;
    }
    const identity = jsonIdentity(result.value, `${path}[${index}]`);
    const previous = seen.get(identity);
    if (previous !== undefined) problems.push({ path: `${path}[${index}]`, message: `duplicates validated output at index ${previous}` });
    else seen.set(identity, index);
    values.push(freezeJson(structuredClone(result.value)));
  }
  if (problems.length > 0) throw new SynthesisError(problems);
  return { raw: freezeJson(raw), values: freezeJson(values) };
}

function jsonIdentity(value: unknown, path: string): string {
  try {
    const identity = canonicalDependency(value);
    const inspect = (item: unknown): void => {
      if (item instanceof Uint8Array) throw new TypeError("pool values must be JSON data, not bytes");
      if (typeof item === "object" && item !== null) for (const child of Object.values(item)) inspect(child);
    };
    inspect(value);
    return identity;
  } catch (cause) {
    throw new SynthesisError([{ path, message: cause instanceof Error ? cause.message : "pool values must be JSON data" }], { cause });
  }
}

function freezeJson<Value>(value: Value): Value {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}
