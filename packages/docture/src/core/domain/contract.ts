/**
 * `Contract` — a schema that knows its own name.
 *
 * ExtractThinker's `Contract` is a Pydantic class, so the class name IS the
 * document's name and the docstring IS its description. TypeScript types are erased
 * at run time, so a schema alone cannot tell a prompt what it is called. A
 * `Contract` is that pairing made explicit: a schema, a name, and the prose that
 * helps a model fill it in.
 *
 * Everything that takes a contract also takes a bare schema, because the extra
 * ceremony is only worth it when the name is used — for a prompt, a classification,
 * or a report:
 *
 * ```ts
 * const Invoice = contract({
 *   name: "invoice",
 *   description: "A commercial invoice with a total and line items.",
 *   schema: z.object({ invoiceNumber: z.string(), total: z.number() }),
 * });
 *
 * await extractor.extract("invoice.pdf", Invoice);          // named
 * await extractor.extract("invoice.pdf", z.object({ … }));  // still fine
 * ```
 */

import type { FlexibleSchema, InferSchema } from "@ai-sdk/provider-utils";

/**
 * A named output contract.
 *
 * `name` and `schema` together are what make this structurally distinct from every
 * member of the AI SDK's `FlexibleSchema` union — a Zod schema has neither, a
 * `Schema` has no `name`, and a `LazySchema` is a function — so
 * {@link InferContract} can tell them apart with no brand and no wrapper class.
 */
export interface Contract<T = unknown> {
  /** What this document kind is called. Appears in prompts and in reports. */
  readonly name: string;
  /** Prose a model can use: what this document is, and what the fields mean. */
  readonly description?: string;
  /** The shape itself. Zod, Valibot, ArkType, or `jsonSchema(...)`. */
  readonly schema: FlexibleSchema<T>;
  /** Extra prompt guidance: layout quirks, unit conventions, gotchas. */
  readonly hints?: string;
}

/** Anything the extraction API accepts as an output contract. */
export type ContractLike = Contract | FlexibleSchema;

/** The data type a contract or schema produces. */
export type InferContract<C> =
  C extends Contract<infer T> ? T : C extends FlexibleSchema ? InferSchema<C> : never;

export interface ContractDefinition<S extends FlexibleSchema> {
  readonly name: string;
  readonly description?: string;
  readonly schema: S;
  readonly hints?: string;
}

/**
 * Name a schema.
 *
 * The one cast is the same one `extract` makes: `S extends FlexibleSchema` cannot be
 * *proven* to be `FlexibleSchema<InferSchema<S>>` structurally, though it always is.
 */
export function contract<S extends FlexibleSchema>(
  definition: ContractDefinition<S>,
): Contract<InferSchema<S>> {
  return {
    name: definition.name,
    schema: definition.schema as FlexibleSchema<InferSchema<S>>,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.hints === undefined ? {} : { hints: definition.hints }),
  };
}

/**
 * True when `value` is a {@link Contract} rather than a bare schema.
 *
 * Deliberately structural — a hand-written `{ name, schema }` object literal is a
 * contract, with no need to have gone through {@link contract}.
 */
export function isContract(value: unknown): value is Contract {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as { name?: unknown; schema?: unknown };
  return typeof candidate.name === "string" && candidate.schema !== undefined;
}

/** The schema inside a contract, or the schema itself. */
export function schemaOf<C extends ContractLike>(source: C): FlexibleSchema<InferContract<C>> {
  return (
    isContract(source) ? source.schema : source
  ) as FlexibleSchema<InferContract<C>>;
}

/** The contract's name, or `undefined` for a bare schema. */
export function contractName(source: ContractLike): string | undefined {
  return isContract(source) ? source.name : undefined;
}
