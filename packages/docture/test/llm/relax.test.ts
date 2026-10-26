import { expect, it } from "vitest";
import { relaxJsonSchema } from "docture/llm/relax";

it("preserves properties named required while removing required lists", () => {
  expect(relaxJsonSchema({
    type: "object",
    properties: {
      required: { type: "boolean" },
      name: { type: "string" },
      nested: {
        type: "object",
        properties: { required: { type: "string" } },
        required: ["required"],
      },
    },
    required: ["required", "name"],
  })).toEqual({
    type: "object",
    properties: {
      required: { type: "boolean" },
      name: { type: "string" },
      nested: { type: "object", properties: { required: { type: "string" } } },
    },
  });
});
