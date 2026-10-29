type Schema = Readonly<Record<string, unknown>>;

const KNOWN = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description",
  "type", "properties", "required", "additionalProperties", "items", "minItems", "maxItems",
  "enum", "const", "oneOf", "anyOf",
]);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

/**
 * Validate a value against the draft 2020-12 subset the result schema uses. A
 * keyword outside that subset throws, so the schema cannot drift into keywords
 * this check would silently ignore.
 */
export function validateJsonSchema(root: Schema, value: unknown): string[] {
  const errors: string[] = [];
  const visit = (schema: Schema, item: unknown, path: string): void => {
    for (const keyword of Object.keys(schema)) if (!KNOWN.has(keyword)) throw new Error(`Unsupported keyword ${keyword} at ${path}`);
    if (typeof schema.$ref === "string") {
      const name = schema.$ref.replace("#/$defs/", "");
      const target = (root.$defs as Record<string, Schema>)[name];
      if (target === undefined) throw new Error(`Unresolved ${schema.$ref}`);
      visit(target, item, path);
    }
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type as string[] : [schema.type as string];
      if (!types.some((type) => matchesType(item, type))) {
        errors.push(`${path}: expected ${types.join(" or ")}, got ${typeOf(item)}`);
        return;
      }
    }
    if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(item)) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(item))) errors.push(`${path}: ${JSON.stringify(item)} is not in the enum`);
    for (const keyword of ["oneOf", "anyOf"] as const) {
      const options = schema[keyword] as Schema[] | undefined;
      if (options === undefined) continue;
      const passing = options.filter((option) => {
        const before = errors.length;
        visit(option, item, path);
        const ok = errors.length === before;
        errors.length = before;
        return ok;
      }).length;
      if (keyword === "oneOf" ? passing !== 1 : passing === 0) errors.push(`${path}: ${passing} of the ${keyword} branches match`);
    }
    if (Array.isArray(item)) {
      if (typeof schema.minItems === "number" && item.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
      if (typeof schema.maxItems === "number" && item.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
      if (schema.items !== undefined) item.forEach((child, index) => visit(schema.items as Schema, child, `${path}[${index}]`));
    }
    if (typeOf(item) === "object") {
      const record = item as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      for (const key of (schema.required ?? []) as string[]) if (!(key in record)) errors.push(`${path}.${key}: required`);
      for (const [key, child] of Object.entries(record)) {
        const property = properties[key];
        if (property !== undefined) visit(property, child, `${path}.${key}`);
        else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
        else if (typeof schema.additionalProperties === "object") visit(schema.additionalProperties as Schema, child, `${path}.${key}`);
      }
    }
  };
  visit(root, value, "$");
  return errors;
}
