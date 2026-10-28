import type { DoctureConfig } from "./define-config.js";
import { nearest } from "./cli/args.js";
import { UsageError } from "./cli/errors.js";
import { isPaperlessConfig } from "./paperless/config.js";

type Rule = { readonly accepts: (value: unknown) => boolean; readonly description: string };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const method = (value: unknown, name: string): boolean => object(value) && typeof value[name] === "function";
const string = (value: unknown): value is string => typeof value === "string";
const strings = (value: unknown): boolean => Array.isArray(value) && value.every(string);
const nonnegative = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0;
const positive = (value: unknown): boolean => nonnegative(value) && value !== 0;
const listOf = (check: (value: unknown) => boolean) => (value: unknown): boolean =>
  Array.isArray(value) && value.every(check);

function component(value: unknown, operation: string): boolean {
  return object(value) && string(value["name"]) && method(value, operation)
    && (value["dispose"] === undefined || typeof value["dispose"] === "function");
}

function extractor(value: unknown): boolean {
  return object(value) && ["extract", "extractBatch", "classify", "dispose"].every((name) => method(value, name));
}

function converter(value: unknown): boolean {
  return object(value) && ["convertBatch", "dispose"].every((name) => method(value, name));
}

function loader(value: unknown): boolean {
  if (!component(value, "load") || !object(value) || !object(value["capabilities"])) return false;
  const capabilities = value["capabilities"];
  return ["text", "geometry", "images"].every((name) => typeof capabilities[name] === "boolean")
    && strings(capabilities["mimeTypes"]);
}

function strategy(value: unknown): boolean {
  return component(value, "extract") && object(value)
    && (value["requires"] === undefined || strings(value["requires"]))
    && (value["needsClassification"] === undefined
      || ["required", "hint", "none"].includes(String(value["needsClassification"])));
}

function schema(value: unknown): boolean {
  return object(value) || typeof value === "function";
}

function classification(value: unknown): boolean {
  return object(value) && string(value["name"]) && string(value["description"]) && schema(value["schema"])
    && (value["extractor"] === undefined || extractor(value["extractor"]));
}

function model(value: unknown): boolean {
  return (string(value) && value.trim().length > 0)
    || (object(value) && string(value["provider"]) && string(value["modelId"])
      && ["v2", "v3", "v4"].includes(String(value["specificationVersion"]))
      && method(value, "doGenerate") && method(value, "doStream"));
}

function pricing(value: unknown): boolean {
  return object(value) && Object.values(value).every((rate) => object(rate)
    && nonnegative(rate["inputPerMillion"]) && nonnegative(rate["outputPerMillion"])
    && (rate["cacheReadPerMillion"] === undefined || nonnegative(rate["cacheReadPerMillion"]))
    && (rate["cacheWritePerMillion"] === undefined || nonnegative(rate["cacheWritePerMillion"])));
}

const RULES: Readonly<Record<keyof DoctureConfig, Rule>> = {
  paperless: { accepts: isPaperlessConfig, description: "Paperless connection and allowlisted schema mappings" },
  schemas: { accepts: (value) => object(value) && Object.entries(value).length <= 100 && Object.entries(value).every(([key, item]) => key.trim() !== "" && schema(item)), description: "a bounded record of named schemas or contracts" },
  extractor: { accepts: (value) => typeof value === "function" || extractor(value), description: "an extractor or a factory" },
  converter: { accepts: (value) => typeof value === "function" || converter(value), description: "a converter or a factory" },
  loaders: { accepts: listOf(loader), description: "an array of named loaders with load() and capabilities" },
  strategies: { accepts: listOf(strategy), description: "an array of named strategies with extract()" },
  classifiers: { accepts: listOf((value) => component(value, "classify")), description: "an array of named classifiers with classify()" },
  classifications: { accepts: listOf(classification), description: "an array of named classifications with description and schema" },
  policy: { accepts: (value) => typeof value === "function", description: "a routing function" },
  stageTimeoutMs: { accepts: positive, description: "a finite positive number" },
  layoutAnalyzer: { accepts: (value) => component(value, "analyze"), description: "a named analyzer with analyze()" },
  model: { accepts: model, description: "a model instance or a nonempty gateway model string" },
  vision: { accepts: (value) => typeof value === "boolean", description: "a boolean" },
  pricing: { accepts: pricing, description: "a model pricing table with finite nonnegative rates" },
  instructions: { accepts: string, description: "a string" },
  schema: { accepts: schema, description: "a schema object" },
  cacheDir: { accepts: string, description: "a string" },
  concurrency: { accepts: (value) => positive(value) && typeof value === "number" && Number.isInteger(value), description: "a positive integer" },
};

function received(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

export function parseConfig(value: unknown, path: string): DoctureConfig {
  if (!object(value)) throw new UsageError(`"${path}" must export a config object, got ${received(value)}.`);
  const entries = Object.entries(value);
  for (const [field, entry] of entries) {
    const rule = Object.hasOwn(RULES, field) ? RULES[field as keyof DoctureConfig] : undefined;
    if (rule === undefined) {
      const near = nearest(field, Object.keys(RULES));
      throw new UsageError(`"${path}" has an unknown config field "${field}".`,
        near === undefined ? undefined : `Did you mean "${near}"?`);
    }
    if (entry !== undefined && !rule.accepts(entry)) {
      throw new UsageError(`"${path}" field "${field}" must be ${rule.description}; got ${received(entry)}.`);
    }
  }
  return Object.fromEntries(entries) as DoctureConfig;
}

export function validateFactoryResult(value: unknown, kind: "extractor" | "converter", path: string): void {
  if (!(kind === "extractor" ? extractor(value) : converter(value))) {
    throw new UsageError(`"${path}" field "${kind}" factory returned an invalid ${kind}.`);
  }
}
