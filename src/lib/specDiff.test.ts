// Spec: D1, D2, D3, D8, D10, D11, D14, D15, D16

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
    status: "draft",
    requirements: [
      { id: "R1", text: "Retried up to five times." },
      { id: "R2", text: "Resumes where it stopped." },
      { id: "R3", text: "Pauses double.", level: "should" },
      { id: "R4", text: "Can be cancelled." },
    ],
    figures: [{ src: "assets/a.png" }, { src: "assets/b.png", caption: "Old" }, { src: "assets/gone.png" }],
    stories: [
      { id: "US-1", as: "a commuter", want: "uploads to survive tunnels", requirements: ["#R1"] },
      { id: "US-2", as: "a caller", want: "to cancel" },
      { id: "US-3", as: "an operator", want: "quiet restarts" },
    ],
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
    status: "accepted",
    stories: [
      { id: "US-1", as: "a commuter", want: "uploads to survive tunnels", soThat: "the phone stays in the pocket", requirements: ["#R1"] },
      { id: "US-2", as: "a caller", want: "to cancel", status: "deprecated", deprecation: { reason: "Nobody asked." } },
      { id: "US-4", as: "a server", want: "clients to back off" },
    ],
    requirements: [
      { id: "R1", text: "Retried up to three times." },
      // "must" is the default: not a change.
      { id: "R2", text: "Resumes where it stopped.", level: "must" },
      { id: "R3", text: "Pauses double." },
      { id: "R5", text: "Gives up after a minute." },
    ],
    figures: [{ src: "assets/a.png" }, { src: "assets/b.png", caption: "New" }, { src: "assets/new.png" }],
    related: ["cli"],
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
    expect(diff.counts).toEqual({ items: { added: 1, removed: 1, changed: 1, moved: 0 }, stories: { added: 1, removed: 1, changed: 2 }, values: { added: 0, removed: 0, changed: 0 }, requirements: { added: 2, removed: 2, changed: 2, moved: 0 }, weakened: 5 });
  });

  it("says which fields of an item changed", () => {
    expect(retries?.fields).toEqual([{ field: "status", before: "draft", after: "accepted" }]);
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

  it("lists what was added to and removed from related", () => {
    expect(retries?.lists).toEqual([{ field: "related", added: ["cli"], removed: [] }]);
  });

  it("follows user stories by id: reworded, deprecated with why, added, and deleted, which takes something away", () => {
    expect(retries?.stories.map((story) => [story.id, story.kind, story.weakened])).toEqual([
      ["US-1", "changed", null],
      ["US-2", "changed", "Deprecated: Nobody asked."],
      ["US-4", "added", null],
      ["US-3", "removed", "A user story is deleted. Deprecate it instead, with the reason, so the record stays."],
    ]);
    expect(diff.counts.stories).toEqual({ added: 1, removed: 1, changed: 2 });
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

  it("points out what takes something away from the spec", () => {
    // R4 is deleted; Command line goes with its one requirement. Nothing should be deleted: it should be deprecated.
    expect(retries?.requirements.map((r) => [r.id, r.weakened])).toEqual([
      ["R1", null],
      // should -> must is stronger.
      ["R3", null],
      ["R4", "A must requirement is deleted. Deprecate it instead, with the reason, so the record stays."],
      ["R5", null],
    ]);
    expect(retries?.weakened).toBeNull();
    expect(diff.items[2]?.weakened).toBe("Deleted, with 1 requirement. Deprecate it instead, with the reason, so the record stays.");
    expect(retries?.unchanged.map((r) => r.id)).toEqual(["R2"]);

    const item = (requirements: unknown[], status?: string) => buildSpec([file("a.json", { title: "A", status, requirements })]);
    const gone = { status: "deprecated", deprecation: { reason: "Nobody used it." } };
    const weaker = diffSpecs(
      item(
        [
          { id: "1", text: "x" },
          { id: "2", text: "y", status: "accepted" },
          { id: "3", text: "z", level: "may" },
          { id: "4", text: "w" },
          { id: "5", text: "v" },
          { id: "6", text: "u", ...gone },
          { id: "7", text: "t", ...gone },
        ],
        "accepted",
      ),
      item(
        [
          { id: "1", text: "x", level: "should" },
          { id: "2", text: "y", status: "draft" },
          { id: "4", text: "w", ...gone },
          { id: "5", text: "v", status: "deprecated" },
          // Deprecated before and after: nothing new.
          { id: "6", text: "u", ...gone },
        ],
        "draft",
      ),
    );
    expect(weaker.items[0]?.weakened).toBe("Back from accepted to draft.");
    expect(weaker.items[0]?.requirements.map((r) => [r.id, r.kind, r.weakened])).toEqual([
      ["1", "changed", "Lowered from must to should."],
      ["2", "changed", "Back from accepted to draft."],
      // Even an optional requirement is deprecated, not deleted.
      ["3", "removed", "A may requirement is deleted. Deprecate it instead, with the reason, so the record stays."],
      // The right way to drop a requirement: it stays, and says why.
      ["4", "changed", "Deprecated: Nobody used it."],
      ["5", "changed", "Deprecated, without saying why."],
      // The record of a deprecation is not to be thrown away.
      ["7", "removed", "A deprecated requirement is deleted. Keep it: it is the record of what was dropped and why."],
    ]);
    expect(weaker.counts.weakened).toBe(7);

    // A reworded reason is a change; an item's own deprecation shows as its status and its reason.
    const reworded = diffSpecs(item([{ id: "6", text: "u", ...gone }]), item([{ id: "6", text: "u", status: "deprecated", deprecation: { reason: "It leaked." } }]));
    expect(reworded.items[0]?.requirements.map((r) => [r.id, r.kind, r.weakened])).toEqual([["6", "changed", null]]);
    const dropped = diffSpecs(
      buildSpec([file("a.json", { title: "A", status: "accepted", requirements: [{ id: "1", text: "x" }] })]),
      buildSpec([file("a.json", { title: "A", status: "deprecated", deprecation: { reason: "Folded into B." }, requirements: [{ id: "1", text: "x" }] })]),
    );
    expect(dropped.items[0]?.weakened).toBe("Deprecated: Folded into B.");
    expect(dropped.items[0]?.fields).toEqual([
      { field: "status", before: "accepted", after: "deprecated" },
      { field: "deprecation", before: undefined, after: "Folded into B." },
    ]);
    // Its requirements go with it, without being flagged one by one.
    expect(dropped.items[0]?.requirements).toEqual([]);
  });

  it("skips files that are the same on both sides without reading them, and waits for the ones that differ", () => {
    const listed = (path: string, oid: string): SpecFile => ({ path, text: null, oid });
    const read = (path: string, oid: string, value: unknown): SpecFile => ({ ...file(path, value), oid });
    const old = buildSpec([listed("index.json", "root"), listed("a.json", "a1"), listed("b.json", "b1"), read("c.json", "c1", { title: "C" })]);
    const next = buildSpec([listed("index.json", "root"), listed("a.json", "a1"), listed("b.json", "b2"), read("c.json", "c2", { title: "See" })]);
    expect(diffSpecs(old, next).items.map((item) => [item.id, item.kind, item.pending])).toEqual([
      ["b", "changed", true],
      ["c", "changed", false],
    ]);
  });

  it("shows a moved item once, by its unchanged contents or by what the pull request says", () => {
    const read = (path: string, oid: string, value: unknown): SpecFile => ({ ...file(path, value), oid });
    const cli = { title: "Command line", requirements: [{ id: "C1", text: "Exits with 1." }] };
    const old = buildSpec([read("cli.json", "x", cli), read("keep.json", "k", { title: "Keep" })]);
    const sameContents = diffSpecs(old, buildSpec([read("tools/cli.json", "x", cli), read("keep.json", "k", { title: "Keep" })]));
    expect(sameContents.items.map((item) => [item.id, item.kind, item.movedFrom, item.requirements.length])).toEqual([["tools/cli", "moved", "cli", 0]]);
    expect(sameContents.counts.items).toEqual({ added: 0, removed: 0, changed: 0, moved: 1 });

    // Moved and reworded: only the pull request knows it's the same file.
    const edited = buildSpec([read("tools/cli.json", "y", { ...cli, title: "CLI" }), read("keep.json", "k", { title: "Keep" })]);
    expect(diffSpecs(old, edited).items.map((item) => item.kind)).toEqual(["added", "removed"]);
    const renamed = diffSpecs(old, edited, new Map([["tools/cli.json", "cli.json"]]));
    expect(renamed.items.map((item) => [item.id, item.kind, item.movedFrom, item.fields])).toEqual([
      ["tools/cli", "moved", "cli", [{ field: "title", before: "Command line", after: "CLI" }]],
    ]);

    // A copy isn't a move.
    const copied = diffSpecs(old, buildSpec([read("cli.json", "x", cli), read("tools/cli.json", "x", cli), read("keep.json", "k", { title: "Keep" })]));
    expect(copied.items.map((item) => [item.id, item.kind])).toEqual([["tools/cli", "added"]]);
  });

  it("follows a requirement that moves to another item, by its id", () => {
    const spec = (a: unknown[], b: unknown[], extra: SpecFile[] = []) =>
      buildSpec([file("a.json", { title: "A", requirements: a }), file("b.json", { title: "B", requirements: b }), ...extra]);
    const stays = { id: "A-1", text: "Stays." };
    const moves = { id: "A-2", text: "Moves as it is." };
    const reworded = { id: "A-3", text: "Moves and changes.", level: "must" };
    const moved = diffSpecs(spec([stays, moves, reworded], []), spec([stays], [moves, { id: "A-3", text: "Moved and changed.", level: "should" }]));
    expect(moved.items.map((item) => [item.id, item.requirements.map((r) => [r.id, r.kind, r.moved, r.weakened])])).toEqual([
      ["a", [["A-2", "removed", { to: "b" }, null], ["A-3", "removed", { to: "b" }, null]]],
      ["b", [["A-2", "added", { from: "a" }, null], ["A-3", "changed", { from: "a" }, "Lowered from must to should."]]],
    ]);
    // Where it is now, it has what it said before, to show what changed on the way.
    expect(moved.items[1]?.requirements[1]?.before?.text).toBe("Moves and changes.");
    expect(moved.counts.requirements).toEqual({ added: 0, removed: 0, changed: 0, moved: 2 });
    expect(moved.counts.weakened).toBe(1);

    // An item that goes away while its requirements live on elsewhere takes nothing away.
    const folded = diffSpecs(spec([stays], [moves]), buildSpec([file("a.json", { title: "A", requirements: [stays, moves] })]));
    expect(folded.items.map((item) => [item.id, item.kind, item.weakened])).toEqual([
      ["a", "changed", null],
      ["b", "removed", null],
    ]);
  });

  it("tells a new version, with its why, from a rewording at the same version", () => {
    const item = (requirements: unknown[]) => buildSpec([file("a.json", { title: "A", requirements })]);
    const v1 = { version: 1, text: "Retried five times.", reason: "Five kept phones awake." };
    const changes = diffSpecs(
      item([
        { id: "1", text: "Retried five times." },
        { id: "2", text: "Retried five times." },
        { id: "3", text: "Pauses doubel." },
        { id: "4", text: "Stays.", level: "should" },
        { id: "5", text: "Third.", version: 2, history: [{ version: 1, text: "First.", reason: "Too vague." }] },
      ]),
      item([
        { id: "1", text: "Retried three times.", version: 2, history: [v1] },
        { id: "2", text: "Retried three times.", version: 2 },
        { id: "3", text: "Pauses double." },
        { id: "4", text: "Stays.", level: "must" },
        { id: "5", text: "Third.", version: 2, history: [{ version: 1, text: "First, honest.", reason: "Too vague." }] },
      ]),
    );
    expect(changes.items[0]?.requirements.map((r) => [r.id, r.version, r.weakened])).toEqual([
      // The right way to change what a requirement means.
      ["1", { kind: "bumped", from: 1, to: 2, reason: "Five kept phones awake." }, null],
      // A new version has to say what the old one was and why it went.
      ["2", { kind: "bumped", from: 1, to: 2, reason: null }, "It is at version 2 without a record of version 1 and why it changed."],
      // The same version: right for a typo, for a reviewer to judge.
      ["3", { kind: "same", at: 1 }, null],
      ["4", { kind: "same", at: 1 }, null],
      // History isn't rewritten.
      ["5", null, "The record of its earlier versions was changed or deleted."],
    ]);

    const misrecorded = diffSpecs(
      item([{ id: "1", text: "Retried five times.", level: "should" }]),
      item([{ id: "1", text: "Retried three times.", version: 2, history: [{ ...v1, text: "Retried four times." }] }]),
    );
    expect(misrecorded.items[0]?.requirements[0]?.weakened).toBe("Its history doesn't record version 1 as it was.");
    const back = diffSpecs(item([{ id: "1", text: "b", version: 2, history: [{ version: 1, text: "a", reason: "r" }] }]), item([{ id: "1", text: "a" }]));
    expect(back.items[0]?.requirements[0]?.weakened).toBe("Its version went back from 2 to 1.");
  });

  it("follows named values by id: changed with or without a reason, deprecated, added, and deleted", () => {
    const tokens = (values: unknown[]) => buildSpec([file("index.json", { title: "Rocket" }), file("tokens.json", { title: "Tokens", values })]);
    const old = tokens([
      { id: "retry.max", type: "number", value: 5 },
      { id: "color.accent", type: "color", value: "#0969da" },
      { id: "name", type: "text", value: "Rocket", description: "The product." },
      { id: "old", type: "text", value: "x" },
      { id: "gone", type: "text", value: "y" },
      { id: "same", type: "dimension", value: "16px" },
    ]);
    const next = tokens([
      { id: "retry.max", type: "number", value: 3, history: [{ value: 5, reason: "Phones stayed awake." }] },
      { id: "color.accent", type: "color", value: "#0550ae" },
      { id: "name", type: "text", value: "Rocket", description: "The product's name." },
      { id: "old", type: "text", value: "x", status: "deprecated", deprecation: { reason: "Renamed." } },
      { id: "same", type: "dimension", value: "16px" },
      { id: "new", type: "list", value: ["a", "b"] },
    ]);
    const changes = diffSpecs(old, next);
    expect(changes.items[0]?.values.map((v) => [v.id, v.kind, v.reason, v.unexplained, v.weakened])).toEqual([
      ["retry.max", "changed", "Phones stayed awake.", false, null],
      // What it is changed, and nothing says why.
      ["color.accent", "changed", null, true, null],
      // Its description alone: no record needed.
      ["name", "changed", null, false, null],
      ["old", "changed", null, false, "Deprecated: Renamed."],
      ["new", "added", null, false, null],
      ["gone", "removed", null, false, "A named value is deleted. Deprecate it instead, with the reason, so the record stays."],
    ]);
    expect(changes.counts.values).toEqual({ added: 1, removed: 1, changed: 4 });
    expect(changes.counts.weakened).toBe(2);
  });
});

