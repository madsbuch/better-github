import { describe, expect, it } from "vitest";
import { buildSpec, type SpecFile } from "./spec";
import { diffSpecs } from "./specDiff";

const file = (path: string, value: unknown): SpecFile => ({ path, text: typeof value === "string" ? value : JSON.stringify(value), truncated: false });
const picture = (path: string, oid: string): SpecFile => ({ path, text: null, truncated: false, oid });

const BASE: SpecFile[] = [
  file("index.json", { title: "Rocket" }),
  file("uploads/index.json", { title: "Uploads" }),
  file("uploads/retries.json", {
    title: "Retries",
    status: "accepted",
    requirements: [
      { id: "R1", text: "Retried up to five times." },
      { id: "R2", text: "Resumes where it stopped." },
      { id: "R3", text: "Pauses double.", level: "should" },
      { id: "R4", text: "Can be cancelled." },
    ],
    figures: [{ src: "assets/a.png" }, { src: "assets/b.png", caption: "Old" }, { src: "assets/gone.png" }],
    questions: ["Retry on 429?"],
    code: ["src/client.rs"],
  }),
  file("cli.json", { title: "Command line", requirements: [{ id: "C1", text: "Exits with 1." }] }),
  picture("assets/a.png", "1"),
  picture("assets/b.png", "2"),
  picture("assets/gone.png", "3"),
];

const HEAD: SpecFile[] = [
  file("index.json", { title: "Rocket" }),
  file("uploads/index.json", { title: "Uploads" }),
  file("uploads/retries.json", {
    title: "Retries",
    status: "implemented",
    requirements: [
      { id: "R1", text: "Retried up to three times." },
      // "must" is the default: not a change.
      { id: "R2", text: "Resumes where it stopped.", level: "must" },
      { id: "R3", text: "Pauses double." },
      { id: "R5", text: "Gives up after a minute." },
    ],
    figures: [{ src: "assets/a.png" }, { src: "assets/b.png", caption: "New" }, { src: "assets/new.png" }],
    code: ["src/client.rs", "src/retry/**"],
  }),
  file("uploads/resume.json", { title: "Resuming", order: 1, requirements: [{ id: "U1", text: "Asks the server how much it has." }] }),
  picture("assets/a.png", "1-changed"),
  picture("assets/b.png", "2"),
  picture("assets/new.png", "4"),
];

describe("diffSpecs", () => {
  const diff = diffSpecs(buildSpec(BASE), buildSpec(HEAD));
  const retries = diff.items.find((item) => item.id === "uploads/retries");

  it("lists added, removed and changed items in the outline's order, and leaves out the rest", () => {
    expect(diff.items.map((item) => [item.id, item.kind])).toEqual([
      ["uploads/resume", "added"],
      ["uploads/retries", "changed"],
      ["cli", "removed"],
    ]);
    expect(diff.counts).toEqual({ items: { added: 1, removed: 1, changed: 1 }, requirements: { added: 2, removed: 2, changed: 2 } });
  });

  it("says which fields of an item changed", () => {
    expect(retries?.fields).toEqual([{ field: "status", before: "accepted", after: "implemented" }]);
    // A new item's fields are all new; its position isn't worth a line.
    expect(diff.items[0]?.fields).toEqual([{ field: "title", before: undefined, after: "Resuming" }]);
  });

  it("matches requirements by id, keeping removed ones where they were", () => {
    expect(retries?.requirements.map((r) => [r.id, r.kind])).toEqual([
      ["R1", "changed"],
      ["R3", "changed"],
      ["R4", "removed"],
      ["R5", "added"],
    ]);
    expect(diff.items[2]?.requirements.map((r) => [r.id, r.kind])).toEqual([["C1", "removed"]]);
  });

  it("tells a changed picture from a changed caption", () => {
    expect(retries?.figures.map((f) => [f.src, f.kind, f.picture])).toEqual([
      ["assets/a.png", "changed", true],
      ["assets/b.png", "changed", false],
      ["assets/new.png", "added", true],
      ["assets/gone.png", "removed", true],
    ]);
  });

  it("lists what was added to and removed from questions, code and related", () => {
    expect(retries?.lists).toEqual([
      { field: "questions", added: [], removed: ["Retry on 429?"] },
      { field: "code", added: ["src/retry/**"], removed: [] },
    ]);
  });

  it("treats a missing spec as an empty one, and equal specs as no change", () => {
    expect(diffSpecs(buildSpec(BASE), buildSpec(BASE)).items).toEqual([]);
    expect(diffSpecs(null, buildSpec(BASE)).items.map((item) => item.kind)).toEqual(["added", "added", "added", "added"]);
    expect(diffSpecs(buildSpec(BASE), null).counts.items.removed).toBe(4);
    expect(diffSpecs(null, null).items).toEqual([]);
  });

  it("says when an item stopped being readable", () => {
    const broken = diffSpecs(buildSpec(BASE), buildSpec([...BASE.filter((f) => f.path !== "cli.json"), file("cli.json", { titel: "Command line" })]));
    expect(broken.items.map((item) => [item.id, item.kind, item.unreadable?.side])).toEqual([["cli", "changed", "after"]]);
  });
});
