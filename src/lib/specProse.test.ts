// Spec: SR11, SR14

import { describe, expect, it } from "vitest";
import { foldUnchanged, proseDiff, proseUnits, sideParts } from "./specProse";

const OLD = `The auditor models deals and their audit.

What has a table today:
- ApiClient: a service allowed to call with a key.
- Actor: someone who did something to a deal.
- Organization: the tenant using the product.

Deliberately absent: a stored audit summary.

Cost is worked out and stored.

See REQ-COST-08.`;

const NEW = `The auditor models deals and their audit.

What has a table today:
- ApiClient: a service allowed to call with a key.
- Actor: someone who did something to a deal. A record of who, not an account.
- Deal, with the checklist items enabled on it.

Deliberately absent: a stored audit summary.

Roles and permissions now exist in TDC Auditor.

See REQ-COST-08.`;

describe("proseDiff", () => {
  const blocks = proseDiff(OLD, NEW);

  it("compares paragraph by paragraph and list item by list item, keeping what didn't change", () => {
    expect(blocks.map((block) => [block.kind, block.list, block.text.slice(0, 24)])).toEqual([
      ["same", false, "The auditor models deals"],
      ["same", false, "What has a table today:"],
      ["same", true, "ApiClient: a service all"],
      // Reworded: one block, with the words that changed.
      ["changed", true, "Actor: someone who did s"],
      // Nothing in common with what took its place: one out, one in.
      ["removed", true, "Organization: the tenant"],
      ["added", true, "Deal, with the checklist"],
      ["same", false, "Deliberately absent: a s"],
      ["removed", false, "Cost is worked out and s"],
      ["added", false, "Roles and permissions no"],
      ["same", false, "See REQ-COST-08."],
    ]);
    const reworded = blocks.find((block) => block.kind === "changed");
    expect(reworded?.kind === "changed" ? reworded.parts.filter((part) => part.kind !== "same") : []).toEqual([
      { text: " A record of who, not an account.", kind: "ins" },
    ]);
  });

  it("handles text that is new, gone or the same", () => {
    expect(proseDiff(undefined, "One.\n\n- a").map((block) => [block.kind, block.list])).toEqual([["added", false], ["added", true]]);
    expect(proseDiff("One.", undefined).map((block) => block.kind)).toEqual(["removed"]);
    expect(proseDiff("One.\n\nTwo.", "One.\n\nTwo.").map((block) => block.kind)).toEqual(["same", "same"]);
    expect(proseUnits("A\nwrapped line.\n\n- x\n- y")).toEqual([
      { list: false, text: "A wrapped line." },
      { list: true, text: "x" },
      { list: true, text: "y" },
    ]);
  });

  it("diffs a long paragraph by its words instead of replacing it whole", () => {
    const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const edited = proseDiff(long, long.replace("word150", "changed"));
    expect(edited.map((block) => block.kind)).toEqual(["changed"]);
    expect(edited[0]?.kind === "changed" ? edited[0].parts.filter((part) => part.kind !== "same").map((part) => part.text) : []).toEqual(["word150", "changed"]);
  });
});

describe("foldUnchanged", () => {
  it("keeps the block before and after each change, and folds longer unchanged runs", () => {
    const text = (changed: string) => ["one", "two", "three", "four", changed, "six", "seven", "eight", "nine"].join("\n\n");
    const stretches = foldUnchanged(proseDiff(text("five is here"), text("five was here")));
    expect(stretches.map((stretch) => [stretch.fold, stretch.blocks.map((block) => block.text.split(" ")[0])])).toEqual([
      [true, ["one", "two", "three"]],
      [false, ["four", "five", "six"]],
      [true, ["seven", "eight", "nine"]],
    ]);
  });

  it("doesn't fold a single block, or a text with nothing to fold", () => {
    const stretches = foldUnchanged(proseDiff("a\n\nb\n\nc old\n\nd", "a\n\nb\n\nc new\n\nd"));
    expect(stretches.map((stretch) => stretch.fold)).toEqual([false]);
  });

  it("gives each side of a reworded text, with a rewritten phrase marked as one stretch", () => {
    const [block] = proseDiff("An upload survives the tunnel, so that I start again.", "An upload survives the tunnel, so that my phone stays put.");
    if (block?.kind !== "changed") throw new Error("not a rewording");
    expect(sideParts(block.parts, "before").filter((part) => part.marked).map((part) => part.text)).toEqual(["I start again"]);
    expect(sideParts(block.parts, "after").filter((part) => part.marked).map((part) => part.text)).toEqual(["my phone stays put"]);
    expect(sideParts(block.parts, "after").map((part) => part.text).join("")).toBe("An upload survives the tunnel, so that my phone stays put.");
  });
});
