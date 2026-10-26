import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ts from "typescript-compiler";

const flag = process.argv.indexOf("--root");
const root = flag < 0 ? resolve(dirname(fileURLToPath(import.meta.url)), "..") : resolve(process.argv[flag + 1]);
const classes = [
  ["core/extractor.ts", "Extractor"], ["core/converter.ts", "DocumentConverter"],
  ["llm/llm.ts", "LLM"], ["llm/vision.ts", "VisionStrategy"],
  ["loaders/pdfjs/loader.ts", "DocumentLoaderPdfJs"], ["loaders/mupdf/loader.ts", "DocumentLoaderMuPdf"],
  ["loaders/tesseract/loader.ts", "DocumentLoaderTesseract"], ["loaders/paddleocr/loader.ts", "DocumentLoaderPaddleOcr"],
];
const examples = [];
for (const [file, name] of classes) {
  const path = resolve(root, "packages/docture/src", file);
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ESNext, true);
  const declarations = source.statements.filter(ts.isClassDeclaration);
  const declaration = declarations.find((node) => node.name?.text === name)
    ?? (file.startsWith("loaders/") && declarations.length === 1 ? declarations[0] : undefined);
  assert.ok(declaration, "Public class declaration missing: " + name);
  const tags = ts.getJSDocTags(declaration);
  const example = tags.find((tag) => tag.tagName.text === "example");
  assert.ok(example && typeof example.comment === "string", name + " needs attached @example documentation");
  assert.ok(tags.some((tag) => tag.tagName.text === "remarks"), name + " needs constructor options");
  assert.ok(tags.some((tag) => tag.tagName.text === "throws"), name + " needs documented errors");
  const code = /\x60\x60\x60ts\s*([\s\S]*?)\x60\x60\x60/.exec(example.comment)?.[1];
  assert.ok(code, name + " needs a TypeScript example");
  examples.push({ name, code });
}
const temporary = mkdtempSync(join(tmpdir(), "docture-jsdoc-"));
try {
  symlinkSync(resolve(root, "apps/docs/node_modules"), join(temporary, "node_modules"), "dir");
  const paths = examples.map(({ name, code }) => {
    const path = join(temporary, name + ".ts");
    writeFileSync(path, code);
    return path;
  });
  const program = ts.createProgram(paths, {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true,
    strict: true, noEmit: true, types: [],
  });
  const errors = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  console.log("Public class documentation passed: " + examples.length + " attached and typechecked examples.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
