import type { Constraint } from "./constraints.js";
import { SynthesisError, type SynthesisProblem } from "./errors.js";
import { gen, internal, type ArrayLength, type FieldSpec, type GenContext, type Generator } from "./generators.js";
import { formatPath, formatPattern, parsePath, type ConcretePath, type PathPattern, type PathSegment, type ValueAt } from "./path.js";
import { streamFor, type Stream } from "./rng.js";
import { isPlainObject, readSchema, resolveNode, type JsonSchema, type Validate } from "./schema.js";

/** Per-position generators, keyed by pattern (`lineItems[].amount`) or concrete path (`lineItems[0].amount`). */
export type Fields<T> = { readonly [P in PathPattern<T>]?: FieldSpec<ValueAt<T, P>> } & {
  readonly [P in ConcretePath<T>]?: FieldSpec<ValueAt<T, PatternOf<P>>>;
};

/** The pattern of a concrete path type: `rows[${number}].amount` becomes `rows[].amount`. */
type PatternOf<P extends string> = P extends `${infer Head}[${number}]${infer Rest}` ? `${Head}[]${PatternOf<Rest>}` : P;

/** A named, invariant-preserving variation of a model, such as "many line items" or "zero total". */
export interface Scenario<T> {
  readonly name: string;
  readonly tags?: readonly string[];
  /** Generators that replace the model's at the same positions. Other positions keep their values. */
  readonly fields?: Fields<T>;
  /** Rewrite a derived sample. `derive` runs again afterwards. */
  readonly shape?: (value: T, stream: Stream) => T;
  /** What the scenario promises. Return `false` or a message when the sample breaks it. */
  readonly expect?: (value: T) => boolean | string | undefined;
}

export interface ModelOptions<T> {
  readonly fields?: Fields<T>;
  /** Recompute every derived field from its inputs. Runs after sampling and again after a scenario's `shape`, so it must be idempotent. */
  readonly derive?: (value: T) => T;
  readonly constraints?: readonly Constraint<T>[];
  /** Probability that an optional property without a generator is present. Default 0.85. */
  readonly presence?: number;
  /** Probability that a nullable position without a generator is `null`. Default 0.1. */
  readonly nulls?: number;
  /** Length range of arrays without a length. Default `[1, 4]`, clamped to the schema's bounds. */
  readonly arrays?: readonly [number, number];
}

export interface SampleOptions<T> {
  readonly seed: number | string;
  readonly scenario?: Scenario<T>;
}

/** One sampled value with the inputs that reproduce it. */
export interface Sample<T> {
  readonly value: T;
  readonly seed: number | string;
  /** The scenario name, or `"base"`. */
  readonly scenario: string;
  readonly tags: readonly string[];
}

export interface Model<T> {
  readonly schema: JsonSchema;
  /** The options the model was defined with, so a corpus can tell when they change. */
  readonly options: ModelOptions<T>;
  /** Sample, shape, derive, check constraints and the scenario's promise, then validate against the schema. */
  sample(options: SampleOptions<T>): Promise<Sample<T>>;
}

/** Brand a plain JSON Schema with the TypeScript type of the values it describes. */
export type TypedJsonSchema<T> = JsonSchema & { readonly "~synthetic"?: T };
export const typedJsonSchema = <T>(schema: JsonSchema): TypedJsonSchema<T> => schema as TypedJsonSchema<T>;

/** The output type of a Standard Schema, a Docture contract or a typed JSON Schema. */
export type InferSchema<S> = S extends { readonly "~standard": { readonly types?: infer Types } }
  ? NonNullable<Types> extends { readonly output: infer O }
    ? O
    : unknown
  : S extends { readonly "~synthetic"?: infer T }
    ? T
    : S extends { readonly name: string; readonly schema: infer Inner }
      ? InferSchema<Inner>
      : unknown;

export function scenario<T>(definition: Scenario<T>): Scenario<T> {
  return definition;
}

/** A model of `schema`'s values: defaults from the schema, overridden by `fields`. */
export function defineModel<const S extends object>(schema: S, options: ModelOptions<InferSchema<S>> = {}): Model<InferSchema<S>> {
  const source = readSchema(schema);
  if (!source.ok) throw new SynthesisError([{ path: "", message: source.message }]);
  const root = source.schema;
  return {
    schema: root,
    options,
    async sample({ seed, scenario }) {
      const layers = [scenario?.fields, options.fields].map((fields) => new Map<string, AnySpec>(Object.entries((fields ?? {}) as Record<string, AnySpec>)));
      for (const path of layers.flatMap((layer) => [...layer.keys()])) {
        if (parsePath(path) === undefined) throw new SynthesisError([{ path, message: "is not a path" }]);
      }
      const sampler = new Sampler(root, layers, seed, { presence: options.presence ?? 0.85, nulls: options.nulls ?? 0.1, arrays: options.arrays ?? [1, 4] });
      let value = sampler.value([]) as InferSchema<S>;
      const derive = options.derive ?? ((same: InferSchema<S>) => same);
      value = derive(value);
      if (scenario?.shape !== undefined) value = derive(scenario.shape(value, streamFor(seed, `#scenario:${scenario.name}`)));
      await check(value, options.constraints ?? [], scenario, source.validate);
      return { value: deepFreeze(value), seed, scenario: scenario?.name ?? "base", tags: scenario?.tags ?? [] };
    },
  };
}

async function check<T>(value: T, constraints: readonly Constraint<T>[], scenario: Scenario<T> | undefined, validate: Validate | undefined): Promise<void> {
  const problems: SynthesisProblem[] = [];
  for (const rule of constraints) for (const message of rule.check(value)) problems.push({ path: rule.name, message });
  if (scenario?.expect !== undefined) {
    const verdict = scenario.expect(value);
    if (verdict === false) problems.push({ path: `scenario ${scenario.name}`, message: "the sample breaks the scenario's promise" });
    if (typeof verdict === "string") problems.push({ path: `scenario ${scenario.name}`, message: verdict });
  }
  if (validate !== undefined) for (const issue of await validate(value)) problems.push(issue);
  if (problems.length > 0) throw new SynthesisError(problems);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const PENDING = Symbol("pending");

type AnySpec = Generator<unknown> | ArrayLength;

class Sampler {
  private readonly memo = new Map<string, unknown>();
  private readonly decisions = new Map<string, unknown>();

  constructor(
    private readonly root: JsonSchema,
    /** Scenario specs first, then the model's; within a layer a concrete path wins over a pattern. */
    private readonly layers: readonly ReadonlyMap<string, AnySpec>[],
    private readonly seed: number | string,
    private readonly options: { readonly presence: number; readonly nulls: number; readonly arrays: readonly [number, number] },
  ) {}

  value(segments: readonly PathSegment[]): unknown {
    const key = formatPath(segments);
    if (this.memo.has(key)) {
      const known = this.memo.get(key);
      if (known === PENDING) throw new SynthesisError([{ path: key, message: "depends on itself through get() or sibling()" }]);
      return known;
    }
    for (let i = 0; i < segments.length; i++) {
      if (this.spec(segments.slice(0, i))?.kind === "generator") return navigate(this.value(segments.slice(0, i)), segments.slice(i));
    }
    if (!this.exists(segments)) return undefined;
    this.memo.set(key, PENDING);
    const value = this.compute(segments, false);
    this.memo.set(key, value);
    return value;
  }

  private spec(segments: readonly PathSegment[]): AnySpec | undefined {
    const path = formatPath(segments);
    const pattern = formatPattern(segments);
    for (const layer of this.layers) {
      const spec = layer.get(path) ?? layer.get(pattern);
      if (spec !== undefined) return spec;
    }
    return undefined;
  }

  private decide<V>(key: string, decide: () => V): V {
    if (!this.decisions.has(key)) this.decisions.set(key, decide());
    return this.decisions.get(key) as V;
  }

  /** `depth` counts how often the deepest repeated schema node already occurs on the path, which bounds recursive schemas. */
  private node(segments: readonly PathSegment[]): { readonly node: JsonSchema; readonly nullable: boolean; readonly depth: number } {
    let current = resolveNode(this.root, this.root);
    const seen = new Map<JsonSchema, number>([[current.node, 1]]);
    let depth = 1;
    for (const segment of segments) {
      const { node } = current;
      const child =
        typeof segment === "number"
          ? (Array.isArray(node.prefixItems) ? node.prefixItems[segment] : undefined) ?? node.items
          : isPlainObject(node.properties) && segment in node.properties
            ? node.properties[segment]
            : node.additionalProperties;
      current = resolveNode(this.root, child);
      const count = (seen.get(current.node) ?? 0) + 1;
      seen.set(current.node, count);
      depth = Math.max(depth, count);
    }
    if (depth > MAX_RECURSION * 4) throw new SynthesisError([{ path: formatPath(segments), message: "the recursive schema keeps requiring deeper values; give it a generator" }]);
    return { ...current, depth };
  }

  private isNull(segments: readonly PathSegment[]): boolean {
    if (segments.length === 0 || this.spec(segments) !== undefined || !this.node(segments).nullable) return false;
    const path = formatPath(segments);
    return this.decide(`${path}#null`, () => streamFor(this.seed, `${path}#null`).chance(this.options.nulls));
  }

  private exists(segments: readonly PathSegment[]): boolean {
    for (let i = 1; i <= segments.length; i++) {
      const parent = segments.slice(0, i - 1);
      if (this.isNull(parent)) return false;
      const last = segments[i - 1] as PathSegment;
      if (typeof last === "number") {
        if (last >= this.length(parent)) return false;
        continue;
      }
      const { node } = this.node(parent);
      const prefix = segments.slice(0, i);
      const required = Array.isArray(node.required) && node.required.includes(last);
      if (required || this.spec(prefix) !== undefined) continue;
      if (!(isPlainObject(node.properties) && last in node.properties)) return false;
      if (this.node(prefix).depth > MAX_RECURSION) return false;
      const path = formatPath(prefix);
      if (!this.decide(`${path}#present`, () => streamFor(this.seed, `${path}#present`).chance(this.options.presence))) return false;
    }
    return true;
  }

  private length(segments: readonly PathSegment[]): number {
    const path = formatPath(segments);
    return this.decide(`${path}#length`, () => {
      const spec = this.spec(segments);
      const stream = streamFor(this.seed, `${path}#length`);
      if (spec?.kind === "length") return internal.range(stream, spec.length);
      const { node, depth } = this.node(segments);
      if (Array.isArray(node.prefixItems) && (node.items === undefined || node.items === false)) return node.prefixItems.length;
      const floor = typeof node.minItems === "number" ? node.minItems : 0;
      if (depth > MAX_RECURSION) return floor;
      const ceiling = typeof node.maxItems === "number" ? node.maxItems : Number.POSITIVE_INFINITY;
      const min = Math.min(Math.max(this.options.arrays[0], floor), ceiling);
      const max = Math.max(min, Math.min(this.options.arrays[1], ceiling));
      return stream.int(min, max);
    });
  }

  private context(segments: readonly PathSegment[]): GenContext {
    const path = formatPath(segments);
    const index = [...segments].reverse().find((segment): segment is number => typeof segment === "number");
    return {
      stream: streamFor(this.seed, path),
      path,
      segments,
      schema: this.node(segments).node,
      index,
      get: <V>(target: string): V => {
        const parsed = parsePath(target);
        if (parsed === undefined || parsed.includes(-1)) throw new SynthesisError([{ path, message: `get("${target}") needs a concrete path` }]);
        return this.value(parsed) as V;
      },
      sibling: <V>(key: string): V => this.value([...segments.slice(0, -1), key]) as V,
      fallback: () => this.compute(segments, true),
    };
  }

  private compute(segments: readonly PathSegment[], ignoreSpec: boolean): unknown {
    const spec = ignoreSpec ? undefined : this.spec(segments);
    if (spec?.kind === "generator") return spec.generate(this.context(segments));
    if (this.isNull(segments)) return null;
    const { node } = this.node(segments);
    const type = node.type;
    if (type === "object" || (type === undefined && isPlainObject(node.properties))) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(isPlainObject(node.properties) ? node.properties : {})) {
        const child = this.value([...segments, key]);
        if (child !== undefined) out[key] = child;
      }
      return out;
    }
    if (type === "array") return Array.from({ length: this.length(segments) }, (_, i) => this.value([...segments, i]));
    return leaf(node, this.context(segments), this.root);
  }
}

/** Past this many repeats of one schema node on a path, optional properties are absent and arrays take their minimum length. */
const MAX_RECURSION = 3;

function navigate(value: unknown, rest: readonly PathSegment[]): unknown {
  let current = value;
  for (const segment of rest) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function leaf(node: JsonSchema, context: GenContext, root: JsonSchema): unknown {
  const { stream, path } = context;
  const fail = (message: string): never => {
    throw new SynthesisError([{ path, message }]);
  };
  if ("const" in node) return node.const;
  if (Array.isArray(node.enum)) return stream.pick(node.enum);
  if (Array.isArray(node.anyOf)) {
    const resolved = node.anyOf.map((option) => resolveNode(root, option).node);
    const options = resolved.filter((option) => option.type !== "object" && option.type !== "array" && !isPlainObject(option.properties));
    if (options.length < resolved.length) fail("a union of objects or arrays needs a generator");
    return leaf(stream.pick(options), { ...context, stream: stream.fork("branch") }, root);
  }
  const number = (key: string): number | undefined => (typeof node[key] === "number" ? (node[key] as number) : undefined);
  switch (node.type) {
    case "boolean":
      return stream.chance(0.5);
    case "null":
      return null;
    case "integer":
    case "number": {
      const step = number("multipleOf") ?? (node.type === "integer" ? 1 : 0.01);
      // Zod writes the safe-integer limits on every int; they bound nothing a document prints.
      const bound = (key: string): number | undefined => {
        const value = number(key);
        return value === undefined || Math.abs(value) >= Number.MAX_SAFE_INTEGER ? undefined : value;
      };
      const minimum = bound("minimum");
      const maximum = bound("maximum");
      const exclusiveMinimum = minimum === undefined ? bound("exclusiveMinimum") : undefined;
      const exclusiveMaximum = maximum === undefined ? bound("exclusiveMaximum") : undefined;
      const lower = minimum ?? exclusiveMinimum;
      const upper = maximum ?? exclusiveMaximum;
      const low = lower ?? (upper === undefined ? 0 : upper - DEFAULT_SPAN);
      const high = upper ?? low + DEFAULT_SPAN;
      let first = Math.ceil(low / step - 1e-9);
      let last = Math.floor(high / step + 1e-9);
      if (exclusiveMinimum !== undefined && first * step <= low) first += 1;
      if (exclusiveMaximum !== undefined && last * step >= high) last -= 1;
      if (last < first) return fail(`no multiple of ${step} lies within the bounds; give it a generator`);
      return Number((stream.int(first, last) * step).toFixed(12));
    }
    case "string": {
      if (typeof node.pattern === "string" && !KNOWN_FORMATS.has(String(node.format))) fail(`a string with pattern ${node.pattern} needs a generator`);
      const text = stringOf(node.format, context);
      const min = number("minLength") ?? 0;
      const max = number("maxLength");
      const padded = text.length < min ? text.padEnd(min, "x") : text;
      return max === undefined ? padded : padded.slice(0, max);
    }
    default:
      return fail(`schema type ${JSON.stringify(node.type)} needs a generator`);
  }
}

/** The width of the default range next to a one-sided or missing numeric bound. */
const DEFAULT_SPAN = 1000;

const KNOWN_FORMATS = new Set(["date", "date-time", "email", "uri", "url", "uuid"]);

function stringOf(format: unknown, context: GenContext): string {
  const { stream } = context;
  switch (format) {
    case "date":
      return gen.date({ from: "2020-01-01", to: "2026-12-31" }).generate(context);
    case "date-time":
      return `${gen.date({ from: "2020-01-01", to: "2026-12-31" }).generate(context)}T${String(stream.int(0, 23)).padStart(2, "0")}:${String(stream.int(0, 59)).padStart(2, "0")}:00Z`;
    case "email":
      return `${stream.pick(internal.WORDS)}.${stream.pick(internal.WORDS)}@example.com`;
    case "uri":
    case "url":
      return `https://example.com/${stream.pick(internal.WORDS)}`;
    case "uuid":
      return gen.pattern("########-####-4###-a###-############").generate(context).toLowerCase();
    default:
      return gen.words(1, 3).generate(context);
  }
}
