import { afterAll, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

it("eval reports OCR confidence calibration in JSON and text without applying a threshold", async () => {
  const cwd = await tempDir("eval-calibration");
  await writeFixture(cwd, "docture.config.mjs", `export default {
    loaders: [{name:"text",capabilities:{text:true,geometry:true,images:false,mimeTypes:["text/plain"]},async load(raw) {
      const text=new TextDecoder().decode(raw.bytes); const line={text,y:1,height:1,spans:[{text,x:1,y:1,width:20,height:1,confidence:.9}]};
      return {loader:"text",form:"digital",text,pages:[{pageNumber:1,width:100,height:100,text,lines:[line]}]};
    }}],
    strategies:[{name:"labelled",async extract(ctx) {const value=Number(ctx.document.text);return {data:{amount:value},citations:[{path:["amount"],status:"verified",ids:["p1-line-1"],value,spans:[{line:"p1-line-1",span:0}]}]};}}]
  };`);
  await writeFixture(cwd, "schema.json", '{"type":"object","properties":{"amount":{"type":"number"}},"required":["amount"]}');
  for (const [name, text] of [["a", "10"], ["b", "11"]]) {
    await writeFixture(cwd, `${name}.txt`, text ?? "");
    await writeFixture(cwd, `${name}.expected.json`, '{"amount":10}');
  }
  const args = ["eval", "a.txt", "b.txt", "--schema", "schema.json", "--calibrate", "--target-precision", ".5", "--min-support", "2"];
  const json = await cli([...args, "--format", "json"], { cwd });
  expect(json.code, json.stderr).toBe(0);
  expect(JSON.parse(json.stdout).summary.calibration).toMatchObject({
    targetPrecision: 0.5,
    minSupport: 2,
    experiments: { docture: { graded: 2, overall: { support: 2, scores: [{ confidence: 0.9, count: 2, correct: 1 }], ece: 0.4 } } },
  });
  const text = await cli([...args, "--format", "text"], { cwd });
  expect(text.code, text.stderr).toBe(0);
  expect(text.stdout).toContain("2 of 2 produced fields carried a confidence (100.0% confidence coverage). 0 omissions. Auto-accept target 50.0%, minimum support 2.");
  const invalid = await cli([...args, "--align-by", "id"], { cwd });
  expect(invalid.code).toBe(2);
  expect(invalid.stderr).toContain("does not support --align-by");
});
