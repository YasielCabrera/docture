/** A declared generation input whose contents affect reproducibility. */
export type DependencyValue = null | boolean | number | string | Uint8Array | readonly DependencyValue[] | { readonly [key: string]: DependencyValue };

/** Named inputs captured by a model or corpus, such as rule revisions and asset bytes. */
export type DependencyInputs = Readonly<Record<string, DependencyValue>>;

export function canonicalDependency(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown, path: string): unknown => {
    const fail = (reason: string): never => { throw new TypeError(`${path}: ${reason}`); };
    if (item === null) return ["null"];
    switch (typeof item) {
      case "string": return ["string", item];
      case "boolean": return ["boolean", item];
      case "number":
        if (!Number.isFinite(item)) return fail("dependency numbers must be finite");
        return ["number", Object.is(item, -0) ? 0 : item];
      case "object": break;
      default: return fail(`unsupported dependency value ${typeof item}`);
    }
    if (ancestors.has(item)) return fail("dependency contains a cycle");
    ancestors.add(item);
    try {
      const keys = Reflect.ownKeys(item);
      if (item instanceof Uint8Array) {
        const bytes = Array.from(Uint8Array.prototype.values.call(item));
        if (keys.length !== bytes.length || keys.some((key, index) => key !== String(index))) return fail("byte dependencies must contain only indexed bytes");
        return ["bytes", bytes];
      }
      if (keys.some((key) => typeof key === "symbol")) return fail("dependency keys must be strings");
      if (Array.isArray(item)) {
        if (keys.length !== item.length + 1) return fail("dependency arrays must be dense and have no extra properties");
        const values: unknown[] = [];
        for (let i = 0; i < item.length; i++) {
          const property = Object.getOwnPropertyDescriptor(item, String(i));
          if (property === undefined || !("value" in property) || !property.enumerable) return fail("dependency arrays must contain enumerable data properties");
          values.push(encode(property.value, `${path}[${i}]`));
        }
        return ["array", values];
      }
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) return fail("dependency objects must be plain records");
      return ["object", Object.getOwnPropertyNames(item).sort().map((key) => {
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (property === undefined || !("value" in property) || !property.enumerable) return fail("dependency records must contain enumerable data properties");
        return [key, encode(property.value, `${path}.${key}`)];
      })];
    } finally {
      ancestors.delete(item);
    }
  };
  return JSON.stringify(encode(value, "dependencies"));
}
