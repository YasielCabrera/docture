import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
function schemaFor(type, path) {
  if (type.flags & ts.TypeFlags.StringLiteral) return { const: type.value, type: "string" };
  if (type.flags & ts.TypeFlags.NumberLiteral) return { const: type.value, type: "number" };
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { const: type.intrinsicName === "true", type: "boolean" };
  if (type.flags & ts.TypeFlags.String) return { type: "string" };
  if (type.flags & ts.TypeFlags.Number) return { type: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
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
      if (value !== false) properties[property.name] = value;
      if (!(property.flags & ts.SymbolFlags.Optional)) required.push(property.name);
    }
    visiting.delete(type);
    return { type: "object", properties, required, additionalProperties: false };
  }
  throw Error("Unsupported type " + checker.typeToString(type) + " at " + path);
}
const output = JSON.stringify({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "DoctureDocument version 1",
  ...schemaFor(checker.getTypeAtLocation(declaration), "DoctureDocument"),
}, null, 2) + "\n";
const target = resolve(root, "apps/docs/public/schemas/docture-document-v1.schema.json");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output) throw Error("Document schema is stale. Run node scripts/generate-document-schema.mjs");
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output);
}
