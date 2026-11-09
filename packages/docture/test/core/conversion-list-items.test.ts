import { describe, expect, it } from "vitest";
import { DocumentConverter, DocumentLoaderData, type LoadedDocument } from "../../src/core/index.js";
import { block, listDocument, textLayerDocument } from "./conversion-fixtures.js";

async function markdown(loaded: LoadedDocument): Promise<string> {
  return (await new DocumentConverter().convert({ loaded })).content;
}

describe("list items and section headings", () => {
  it("ends a numbered list at a larger numbered section heading", async () => {
    const loaded = textLayerDocument([
      [100, ["1. Apples", 36, 40]],
      [112, ["2. Pears", 36, 36]],
      [140, ["2. Methods", 36, 70, 14]],
      [160, ["We counted the fruit by hand.", 36, 130]],
    ]);
    expect(await markdown(loaded)).toBe([
      "<!-- page: 1 -->",
      "1. Apples\n2. Pears",
      "# 2\\. Methods",
      "We counted the fruit by hand.",
    ].join("\n\n"));
  });

  it("reads a bold numbered line followed by body text as a section heading", async () => {
    const loaded = textLayerDocument([
      [80, ["Sinusoidal parameter estimation is a fundamental task in many fields.", 36, 300]],
      [110, ["1. INTRODUCTION", 36, 75, 10, true]],
      [125, ["Differentiable digital signal processing has grown quickly in recent years.", 36, 300]],
    ]);
    expect(await markdown(loaded)).toBe([
      "<!-- page: 1 -->",
      "Sinusoidal parameter estimation is a fundamental task in many fields.",
      "# 1\\. INTRODUCTION",
      "Differentiable digital signal processing has grown quickly in recent years.",
    ].join("\n\n"));
  });

  it("keeps a list of bold numbered items as a list", async () => {
    const loaded = textLayerDocument([
      [100, ["1. Apples", 36, 40, 10, true]],
      [112, ["2. Pears", 36, 36, 10, true]],
      [140, ["We counted the fruit by hand.", 36, 130]],
    ]);
    expect(await markdown(loaded)).toBe("<!-- page: 1 -->\n\n1. Apples\n2. Pears\n\nWe counted the fruit by hand.");
  });

  it("splits plain-text list lines into items", async () => {
    const converter = new DocumentConverter().loadDocumentLoader(new DocumentLoaderData());
    const result = await converter.convert({
      bytes: new TextEncoder().encode("Shopping:\n1. Apples\n2. Pears\n- Milk\n- Bread"),
      mimeType: "text/plain",
    });
    expect(result.content).toBe("<!-- page: 1 -->\n\nShopping:\n\n1. Apples\n2. Pears\n\n- Milk\n- Bread");
  });

  it("keeps a wrapped line that starts with a year inside its item", async () => {
    const loaded = textLayerDocument([
      [100, ["1. Accounts opened before 1984 and considered active during", 36, 250]],
      [111.5, ["1983. You must sign the certification.", 36, 160]],
    ]);
    expect(await markdown(loaded)).toBe(
      "<!-- page: 1 -->\n\n1. Accounts opened before 1984 and considered active during\n1983\\. You must sign the certification.",
    );
  });

  it("starts a new list when a tagged item's marker changes kind", async () => {
    const loaded = listDocument([block("• Alpha", 20, "list-item"), block("2. Beta", 50, "list-item")]);
    expect(await markdown(loaded)).toBe("<!-- page: 1 -->\n\n- Alpha\n\n2. Beta");
  });

  it("joins a tagged item's wrapped lines to that item", async () => {
    const loaded = listDocument([
      block("4. Certify to your non-foreign status for purposes of withholding", 20, "list-item"),
      block("5. Certify that FATCA code(s) entered on this form indicating", 32, "list-item"),
      block("that you are exempt from the FATCA reporting is correct.", 44, "list-item"),
      block("See the instructions for further information.", 56, "list-item"),
    ]);
    expect(await markdown(loaded)).toBe(
      "<!-- page: 1 -->\n\n4. Certify to your non-foreign status for purposes of withholding\n" +
        "5. Certify that FATCA code(s) entered on this form indicating\n" +
        "that you are exempt from the FATCA reporting is correct.\n" +
        "See the instructions for further information.",
    );
  });

  it("numbers an ordered item without its own number after the item before it", async () => {
    const box = { x: 0, y: 0, width: 100, height: 10 };
    const loaded: LoadedDocument = {
      loader: "native",
      form: "digital",
      text: "source",
      pages: [{
        pageNumber: 1, width: 600, height: 800, text: "source",
        layout: [{
          id: "list", kind: "list", ordered: true, provenance: { pageNumber: 1, box, sourceIds: ["list"] },
          items: [
            { text: "Second", runs: [{ text: "Second" }], marker: "2. " },
            { text: "Third", runs: [{ text: "Third" }] },
          ],
        }],
      }],
    };
    expect(await markdown(loaded)).toBe("<!-- page: 1 -->\n\n2. Second\n3. Third");
    expect((await new DocumentConverter().convert({ loaded }, { format: "text" })).content).toBe("2. Second\n3. Third");
  });

  it("keeps a link inside a list item", async () => {
    const page = textLayerDocument([
      [100, ["• Read the", 36, 45], ["guide", 83, 22]],
      [112, ["• Then start", 36, 50]],
    ]);
    const first = page.pages[0];
    const blocks = first?.blocks?.map((block, index) => index !== 0 || block.kind !== "text" ? block : {
      ...block,
      lines: block.lines.map((value) => ({ ...value, spans: value.spans.map((span) => span.text === "guide" ? { ...span, href: "https://example.com/guide" } : span) })),
    });
    const loaded = { ...page, pages: [{ ...first!, ...(blocks === undefined ? {} : { blocks }) }] };
    expect(await markdown(loaded)).toBe("<!-- page: 1 -->\n\n- Read the [guide](https://example.com/guide)\n- Then start");
  });
});

describe("heading levels", () => {
  it("assigns levels from the document's heading sizes, largest first", async () => {
    const loaded = textLayerDocument(
      [
        [60, ["Annual Report", 36, 160, 24]],
        [100, ["Summary", 36, 70, 14]],
        [130, ["Revenue grew in every region this year.", 36, 180]],
      ],
      [
        [60, ["Details", 36, 60, 14]],
        [90, ["Costs", 36, 40, 12]],
        [120, ["Costs fell slightly in the second half.", 36, 180]],
      ],
    );
    expect(await markdown(loaded)).toBe([
      "<!-- page: 1 -->",
      "# Annual Report",
      "## Summary",
      "Revenue grew in every region this year.",
      "<!-- page: 2 -->",
      "## Details",
      "### Costs",
      "Costs fell slightly in the second half.",
    ].join("\n\n"));
  });
});
