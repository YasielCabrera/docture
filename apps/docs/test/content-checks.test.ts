import { describe, expect, it } from "vitest";
import { checkRepeatedParagraphs } from "../scripts/page-rules";
import { checkCliInvocations } from "../scripts/doc-rules";
import { remarkCodeExamples } from "../lib/code-examples";
import type { Root } from "mdast";

describe("documentation content contracts", () => {
  it("rejects adjacent repeated prose without merging sections or code examples", () => {
    const prose = "Returns the result with the recorded confidence and evidence.";
    expect(checkRepeatedParagraphs({ route: "/docs/example", source: `${prose}\n\n${prose}` })).toHaveLength(1);
    expect(checkRepeatedParagraphs({ route: "/docs/example", source: `${prose}\n\n## Other\n\n${prose}` })).toEqual([]);
    expect(checkRepeatedParagraphs({ route: "/docs/example", source: `${prose}\n\n\`\`\`ts\nx();\n\`\`\`\n\n${prose}` })).toEqual([]);
    expect(checkRepeatedParagraphs({ route: "/docs/example", source: `~~~text\n\n${prose}\n\n${prose}\n\n~~~` })).toEqual([]);
  });

  it("accepts the documented local CLI prerequisite and rejects an unexplained invocation", () => {
    const bins = new Map([["docture", false]]);
    expect(checkCliInvocations("Install the [local CLI](/docs/cli/quick-start#install).\n\nnpx docture inspect invoice.pdf", bins)).toEqual([]);
    expect(checkCliInvocations("npx docture inspect invoice.pdf", bins)).toEqual(["Command package has no binary: docture"]);
  });

  it("labels code regions uniquely within each document and states their verification level", () => {
    const tree: Root = { type: "root", children: [
      { type: "code", lang: "ts", meta: "check", value: "const a = 1;" },
      { type: "code", lang: "ts", meta: "signature", value: "extract(source: DocumentSource): Promise<Result>" },
    ] };
    remarkCodeExamples()(tree);
    expect(tree.children[0]).toMatchObject({ meta: 'check data-example-label="Type-checked example 1"' });
    expect(tree.children[1]).toMatchObject({ meta: 'signature data-example-label="Reference signature 2"' });
  });
});
