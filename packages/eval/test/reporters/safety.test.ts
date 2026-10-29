import { expect, it } from "vitest";
import { buildResult, defineEval, exact } from "../../src/index.js";
import { renderHtml } from "../../src/reporters/html/index.js";
import { junitReporter, renderJunit } from "../../src/reporters/junit/index.js";
import { renderScoreboard, terminalReporter } from "../../src/reporters/terminal/index.js";
import { savedResult } from "./fixture.js";

it("escapes every terminal control in metadata, case lines, errors and the scoreboard", async () => {
  const controls = Array.from({ length: 160 }, (_, code) => code).filter((code) => code < 32 || code >= 127).map((code) => String.fromCharCode(code)).join("");
  const hostile = `safe${controls}FORGED PASS`;
  const source = savedResult();
  const result = { ...source, run: { ...source.run, id: hostile }, warnings: [hostile], cases: source.cases.map((row) => row.outcome === "errored" ? { ...row, caseId: hostile, error: { ...row.error, message: hostile } } : { ...row, caseId: hostile }) };
  const writes: string[] = [];
  const reporter = terminalReporter({ stream: { write: (text) => writes.push(text) } });
  await reporter.onRunStart?.(result.run);
  await reporter.onCase?.(result.cases[2]!, { completed: 1, total: 1, scored: 0, errored: 1, skipped: 0, elapsedMs: 1 });
  await reporter.onResult(result);
  for (const text of [...writes, renderScoreboard(result)]) {
    expect(text).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
    expect(text).toContain("\\x1b");
    expect(text).toContain("\\x0a");
  }
});

it("fails a scored case with nothing gradable under a JUnit threshold", () => {
  const source = savedResult();
  const row = source.cases.find((row) => row.outcome === "scored")!;
  const spec = defineEval({ type: "object", properties: { x: { type: "string" } }, required: ["x"] }, { fields: { x: { weight: 0, compare: exact() } } });
  const expected = { x: "expected" };
  const actual = { x: "wrong" };
  const score = spec.score(expected, actual);
  const result = buildResult({ run: { ...source.run, spec: spec.info }, cases: [{ ...row, expected, actual, score }] });
  expect(score.metrics.f1).toBeNull();
  expect(renderJunit(result, { threshold: 0.9 })).toContain('<failure message="F1 n/a: nothing gradable');
});

it.each([NaN, Infinity, -Infinity, -0.1, 1.1])("rejects invalid JUnit threshold %s", (threshold) => {
  expect(() => renderJunit(savedResult(), { threshold })).toThrow(TypeError);
  expect(() => renderJunit(savedResult(), { threshold })).toThrow("threshold");
  expect(() => junitReporter({ out: "junit.xml", threshold })).toThrow(TypeError);
  expect(() => junitReporter({ out: "junit.xml", threshold })).toThrow("threshold");
});

it.each(['@import "https://example.com/x.css";', 'body{background:url(https://example.com/x)}', 'body{background:url(//example.com/x)}', 'body{background:url(/x)}', '@im\\70ort "x";', 'body{background:u\\72l(https://example.com/x)}',
  'body{background-image:image-set("https://example.com/x.png" 1x)}', "body{background-image:-webkit-image-set('//example.com/x.png' 1x)}",
  'body{background-image:image-set(url(https://example.com/x.png) 1x)}', 'body{background-image:image-set(https://example.com/x.png 1x)}',
  'body{background-image:src("https://example.com/x.png")}', '@font-face{font-family:x;src:url("ht\\74ps://example.com/x.woff")}',
  'body{mask:image("HTTPS://example.com/x.svg")}', 'body{background-image:image-set("ht\\\ntps://example.com/x.png" 1x)}'])("rejects CSS network references: %s", (css) => {
  expect(() => renderHtml(savedResult(), { theme: { css } })).toThrow(TypeError);
  expect(() => renderHtml(savedResult(), { theme: { css } })).toThrow("theme.css");
});

it("allows data URLs and places the offline CSP before style and script elements", () => {
  const html = renderHtml(savedResult(), { theme: { css: 'body{background:url("data:image/png;base64,AAAA")}' } });
  expect(html).toContain(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"`);
  expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(html.indexOf("<style>"));
});

it("allows inline SVG data URLs whose markup names an XML namespace", () => {
  const svg = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>`;
  expect(() => renderHtml(savedResult(), { theme: { css: `body{background:url("${svg}")}` } })).not.toThrow();
  expect(() => renderHtml(savedResult(), { theme: { css: `body{background-image:image-set("${svg}" 1x)}` } })).not.toThrow();
  expect(() => renderHtml(savedResult(), { theme: { css: `body{font-family:"Inter",sans-serif;content:"a: b"}` } })).not.toThrow();
});

it("hands the offline CSP to a template and rejects a template page without it or with it after a style", () => {
  const page = renderHtml(savedResult(), { template: (parts) => `<!doctype html><head>${parts.csp}<style>${parts.css}</style></head><body>${parts.body}${parts.data}<script>${parts.script}</script></body>` });
  expect(page).toContain(`<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>`);
  expect(() => renderHtml(savedResult(), { template: (parts) => `<!doctype html><style>${parts.css}</style>${parts.body}${parts.data}<script>${parts.script}</script>` }))
    .toThrow("The HTML template must place parts.csp in the page's head, before any <style>, <script> or <body>.");
  expect(() => renderHtml(savedResult(), { template: (parts) => `<!doctype html><style>${parts.css}</style>${parts.csp}${parts.body}${parts.data}<script>${parts.script}</script>` }))
    .toThrow(TypeError);
});
