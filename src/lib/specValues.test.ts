import { describe, expect, it } from "vitest";
import type { SpecValue } from "./spec";
import { draftOf, emptyDraft, pickerColor, valueOf } from "./specValues";

describe("a named value in a form", () => {
  it("goes into a draft and comes back the same, for every type", () => {
    const values: SpecValue[] = [
      { id: "color.accent", type: "color", value: "#0969da", dark: "#4493f8" },
      { id: "space.gutter", type: "dimension", value: "1.5rem" },
      { id: "toast.stay", type: "duration", value: "30min" },
      { id: "retry.max", type: "number", value: 5, unit: "times" },
      { id: "name", type: "text", value: "Rocket" },
      { id: "font.body", type: "font", value: "Inter, sans-serif" },
      { id: "roles", type: "list", value: ["admin", "member"] },
    ];
    for (const value of values) expect(valueOf(draftOf(value), { id: value.id })).toEqual(value);
  });

  it("isn't a value until it is complete and well formed", () => {
    expect(valueOf({ ...emptyDraft("dimension"), text: "" }, { id: "a" })).toBeNull();
    expect(valueOf({ ...emptyDraft("dimension"), text: "16" }, { id: "a" })).toEqual({ id: "a", type: "dimension", value: "16px" });
    expect(valueOf({ ...emptyDraft("color"), text: "blue" }, { id: "a" })).toBeNull();
    expect(valueOf({ ...emptyDraft("color"), text: "#FFF000", dark: "nope" }, { id: "a" })).toBeNull();
    expect(valueOf({ ...emptyDraft("number"), text: "" }, { id: "a" })).toBeNull();
    expect(valueOf({ ...emptyDraft("number"), text: "five" }, { id: "a" })).toBeNull();
    expect(valueOf({ ...emptyDraft("list"), text: "\n \n" }, { id: "a" })).toBeNull();
    expect(valueOf({ ...emptyDraft("text"), text: "Save", unit: "" }, { id: "a", description: " The primary action. " })).toEqual({
      id: "a",
      type: "text",
      value: "Save",
      description: "The primary action.",
    });
  });

  it("gives a color picker six digits", () => {
    expect(pickerColor("#0969DA80")).toBe("#0969da");
    expect(pickerColor("")).toBe("#000000");
  });
});
