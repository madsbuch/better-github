// Spec: SR18, RW16, S36
import { describe, expect, it } from "vitest";
import { buildSpec, relatedTo, type SpecFile } from "./spec";
import { diffSpecs } from "./specDiff";
import { reconcileLines, toReconcile } from "./specReconcile";

const file = (path: string, value: unknown): SpecFile => ({ path, text: JSON.stringify(value), truncated: false });

/** A language app seen two ways: what motivates, and what makes a language stick. */
const spec = (streak: string, extra: unknown[] = []) =>
  buildSpec([
    file("index.json", { title: "Lingo" }),
    file("drives.json", {
      title: "What motivates",
      stories: [{ id: "US-1", as: "a learner", want: "to see my streak", requirements: ["#OCT-1"] }],
      requirements: [{ id: "OCT-1", text: streak, related: ["#ACQ-1", "#streak.grace", "practice"] }, { id: "OCT-2", text: "A finished lesson shows what was learned." }, ...extra],
    }),
    file("acquisition.json", {
      title: "What makes it stick",
      requirements: [
        { id: "ACQ-1", text: "A word comes back when it is about to be forgotten." },
        { id: "ACQ-2", text: "A missed day loses nothing that was learned.", related: ["#OCT-1"] },
        { id: "ACQ-3", text: "Lessons are spoken before they are read.", deprecation: { reason: "No evidence it helps." }, related: ["#OCT-1"] },
      ],
      values: [{ id: "streak.grace", type: "duration", value: "2d" }],
    }),
    file("practice.json", { title: "Practice", summary: "Daily practice." }),
  ]);

describe("related entries", () => {
  it("hold from both ends, whichever says so, and a story is related to what makes it true", () => {
    const lingo = spec("A streak counts days in a row.");
    expect(lingo.problems).toEqual([]);
    expect(relatedTo(lingo, "#OCT-1").map((entry) => entry.key)).toEqual(["#ACQ-1", "#ACQ-2", "#ACQ-3", "#streak.grace", "#US-1", "practice"]);
    // Written at the other end only.
    expect(relatedTo(lingo, "#ACQ-1").map((entry) => entry.key)).toEqual(["#OCT-1"]);
    expect(relatedTo(lingo, "practice").map((entry) => entry.key)).toEqual(["#OCT-1"]);
    expect(relatedTo(lingo, "#OCT-2")).toEqual([]);
  });

  it("have to be in the spec", () => {
    const broken = buildSpec([file("a.json", { title: "A", requirements: [{ id: "A-1", text: "x", related: ["#A-9", "#A-1"] }], values: [{ id: "v", type: "text", value: "x", related: ["nowhere"] }] })]);
    expect(broken.problems.map((problem) => problem.message)).toEqual(['Requirement A-1 is related to "#A-9", which isn\'t in the spec.', 'Value v is related to "nowhere", which isn\'t in the spec.']);
    // Being related to itself says nothing.
    expect(relatedTo(broken, "#A-1")).toEqual([]);
  });
});

describe("what to reconcile after a change", () => {
  const [before, after] = [spec("A streak counts days in a row."), spec("A streak counts days in a row, and a missed day ends it.")];

  it("is everything related to what changed that wasn't changed itself, as it is now", () => {
    const list = toReconcile(diffSpecs(before, after), before, after);
    expect(list.map((entry) => [entry.key, entry.kind, entry.label, entry.because])).toEqual([
      ["#ACQ-1", "requirement", "ACQ-1", ["OCT-1"]],
      // It only says so at its own end.
      ["#ACQ-2", "requirement", "ACQ-2", ["OCT-1"]],
      ["#streak.grace", "value", "streak.grace", ["OCT-1"]],
      ["#US-1", "story", "US-1", ["OCT-1"]],
      ["practice", "part", "Practice", ["OCT-1"]],
    ]);
    // What was dropped isn't looked at again: ACQ-3 is not in the list.
    expect(list.find((entry) => entry.key === "#ACQ-2")?.text).toBe("A missed day loses nothing that was learned.");
    expect(reconcileLines(list)[0]).toBe('- ACQ-1: "A word comes back when it is about to be forgotten." Related to OCT-1.');
    expect(reconcileLines(list)[4]).toBe('- the part Practice (`practice`): "Daily practice." Related to OCT-1.');
  });

  it("leaves out what the change already touched, and is empty when nothing related changed", () => {
    const both = buildSpec([
      file("a.json", { title: "A", requirements: [{ id: "A-1", text: "x2", related: ["#A-2"] }, { id: "A-2", text: "y2" }, { id: "A-3", text: "z", related: ["#A-2"] }] }),
    ]);
    const old = buildSpec([
      file("a.json", { title: "A", requirements: [{ id: "A-1", text: "x", related: ["#A-2"] }, { id: "A-2", text: "y" }, { id: "A-3", text: "z", related: ["#A-2"] }] }),
    ]);
    expect(toReconcile(diffSpecs(old, both), old, both).map((entry) => [entry.key, entry.because])).toEqual([["#A-3", ["A-2"]]]);
    expect(toReconcile(diffSpecs(before, spec("A streak counts days in a row.", [{ id: "OCT-3", text: "New and unrelated." }])), before, before)).toEqual([]);
  });

  it("still lists what a deleted entry, or a removed pointer, used to touch", () => {
    const gone = buildSpec([file("a.json", { title: "A", requirements: [{ id: "A-2", text: "y" }] })]);
    const had = buildSpec([file("a.json", { title: "A", requirements: [{ id: "A-1", text: "x", related: ["#A-2"] }, { id: "A-2", text: "y" }] })]);
    expect(toReconcile(diffSpecs(had, gone), had, gone).map((entry) => [entry.key, entry.because])).toEqual([["#A-2", ["A-1"]]]);
  });
});
