import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-compiler";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "packages/docture/src/core/domain/conversion.ts");
const program = ts.createProgram([file], { strict: true, exactOptionalPropertyTypes: true, skipLibCheck: true });
const checker = program.getTypeChecker();
const source = program.getSourceFile(file);
const declaration = source.statements.find((node) => ts.isInterfaceDeclaration(node) && node.name.text === "DoctureDocument");
if (!declaration) throw Error("DoctureDocument declaration is missing");
const visiting = new Set();
const TEMPLATE = Symbol("template literal without @pattern");
const V1_SHA256 = "22cfe02edfc0d46afa03545c19eb731da1bb1319427fd8d6539bdf5629dba8bd";

function withTags(schema, location, path) {
  const tags = new Map(ts.getJSDocTags(location).map((tag) => [tag.tagName.text, ts.getTextOfJSDocComment(tag.comment)?.trim() ?? ""]));
  const scalar = schema.type === "array" ? schema.items : schema;
  if (tags.has("integer")) {
    if (scalar.type !== "number") throw Error("@integer on a non-number at " + path);
    scalar.type = "integer";
  }
  if (tags.has("minimum")) scalar.minimum = Number(tags.get("minimum"));
  if (tags.has("minItems")) {
    if (schema.type !== "array") throw Error("@minItems on a non-array at " + path);
    schema.minItems = Number(tags.get("minItems"));
  }
  if (tags.has("pattern")) {
    if (scalar.type !== "string") throw Error("@pattern on a non-string at " + path);
    scalar.pattern = tags.get("pattern");
    delete scalar[TEMPLATE];
  }
  if (scalar[TEMPLATE] !== undefined) throw Error("Template literal " + scalar[TEMPLATE] + " needs @pattern at " + path);
  return schema;
}

function schemaFor(type, path) {
  if (type.flags & ts.TypeFlags.StringLiteral) return { const: type.value, type: "string" };
  if (type.flags & ts.TypeFlags.NumberLiteral) return { const: type.value, type: "number" };
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { const: type.intrinsicName === "true", type: "boolean" };
  if (type.flags & ts.TypeFlags.String) return { type: "string" };
  if (type.flags & ts.TypeFlags.Number) return { type: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
  if (type.flags & ts.TypeFlags.TemplateLiteral) return { type: "string", [TEMPLATE]: checker.typeToString(type) };
  if (type.flags & (ts.TypeFlags.Never | ts.TypeFlags.Undefined)) return false;
  if (type.isUnion()) {
    const alternatives = type.types.filter((part) => !(part.flags & ts.TypeFlags.Undefined))
      .map((part) => schemaFor(part, path));
    return alternatives.length === 1 ? alternatives[0] : { anyOf: alternatives };
  }
  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type);
    if (!element) throw Error("Missing array element at " + path);
    return { type: "array", items: schemaFor(element, path + "[]") };
  }
  if (type.flags & ts.TypeFlags.Object) {
    if (visiting.has(type)) throw Error("Recursive schema type at " + path);
    if (checker.getIndexInfosOfType(type).length || type.getCallSignatures().length) {
      throw Error("Unsupported index or callable type at " + path);
    }
    visiting.add(type);
    const properties = {};
    const required = [];
    for (const property of checker.getPropertiesOfType(type)) {
      const location = property.valueDeclaration ?? property.declarations?.[0];
      if (!location) throw Error("Missing property declaration at " + path);
      const value = schemaFor(checker.getTypeOfSymbolAtLocation(property, location), path + "." + property.name);
      if (value !== false) properties[property.name] = withTags(value, location, path + "." + property.name);
      if (!(property.flags & ts.SymbolFlags.Optional)) required.push(property.name);
    }
    visiting.delete(type);
    return { type: "object", properties, required, additionalProperties: false };
  }
  throw Error("Unsupported type " + checker.typeToString(type) + " at " + path);
}
const v2 = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "DoctureDocument version 2",
  ...schemaFor(checker.getTypeAtLocation(declaration), "DoctureDocument"),
};
if (v2.properties.schemaVersion?.const !== 2) throw Error("DoctureDocument.schemaVersion must be 2 for the version 2 schema");
const schemas = resolve(root, "apps/docs/public/schemas");
const v1Target = resolve(schemas, "docture-document-v1.schema.json");
const v1Text = readFileSync(v1Target, "utf8");
if (createHash("sha256").update(v1Text).digest("hex") !== V1_SHA256) {
  throw Error("The published version 1 document schema changed. Restore it; version 1 is frozen.");
}
const outputs = [
  [resolve(schemas, "docture-document-v2.schema.json"), JSON.stringify(v2, null, 2) + "\n"],
  [resolve(root, "packages/docture/src/core/conversion/document-schemas.ts"), [
    "// Generated by scripts/generate-document-schema.mjs from the published version 1 schema and DoctureDocument. Do not edit.",
    'import type { SchemaNode } from "./parse.js";',
    "",
    "export const DOCUMENT_SCHEMA_V1: SchemaNode = " + JSON.stringify(JSON.parse(v1Text), null, 2) + ";",
    "",
    "export const DOCUMENT_SCHEMA_V2: SchemaNode = " + JSON.stringify(v2, null, 2) + ";",
    "",
  ].join("\n")],
];
for (const [target, output] of outputs) {
  if (process.argv.includes("--check")) {
    if (!existsSync(target) || readFileSync(target, "utf8") !== output) {
      throw Error("Document schema is stale. Run node scripts/generate-document-schema.mjs");
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);
  }
}
