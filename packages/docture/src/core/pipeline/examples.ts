import type { ContractExample } from "../domain/contract.js";
import { exampleJson } from "../domain/example-json.js";
import type { ResolvedSchema } from "./schema.js";

export interface GuidedExample {
  readonly label: string;
  readonly text: string;
  readonly output: string;
}

export function serializeExamples(
  examples: readonly ContractExample[] | undefined,
  owner: string,
): readonly GuidedExample[] | undefined {
  return examples?.map((example, index) => {
    const label = `${owner} example ${index + 1}`;
    return { label, text: example.text, output: exampleJson(example, label) };
  });
}

function isGuidedExample(value: unknown): value is GuidedExample {
  if (typeof value !== "object" || value === null) return false;
  const example = value as Record<string, unknown>;
  return typeof example.label === "string" && typeof example.text === "string" && typeof example.output === "string";
}

export function guidedExamplesOf(guidance: object): readonly GuidedExample[] | undefined {
  if (!("examples" in guidance)) return undefined;
  const examples = guidance.examples;
  return Array.isArray(examples) && examples.every(isGuidedExample) ? examples : undefined;
}

export async function checkedExamples(
  examples: readonly GuidedExample[] | undefined,
  schema: ResolvedSchema,
): Promise<readonly { readonly text: string; readonly output: string }[] | undefined> {
  if (examples === undefined || examples.length === 0) return undefined;
  for (const example of examples) {
    const result = await schema.validate(JSON.parse(example.output));
    if (!result.ok) {
      const issues = result.issues.map((issue) => `${issue.path || "(root)"}: ${issue.message}`).join("; ");
      throw new TypeError(`${example.label}: output does not satisfy the schema: ${issues}.`);
    }
  }
  return examples.map(({ text, output }) => ({ text, output }));
}
