// Spec: RW3, RW4, RW5, RW11, RW12, RW15

import { deprecateValue, reviseValue, withValue } from "./specRework";
import type { SpecValue } from "./spec";
import { specPullBranch } from "./specRework";
import { describe, expect, it } from "vitest";
import { buildSpec, SpecItem, type SpecFile } from "./spec";
import { diffSpecs } from "./specDiff";
import {
  applyRework,
  deprecateRequirement,
  newItemId,
  reviseRequirement,
  specReworkPrompt,
  suggestRequirementId,
  withFields,
  withNewRequirement,
  withRequirement,
  type SpecReworkDraft,
} from "./specRework";

const file = (path: string, value: unknown): SpecFile => ({ path, text: JSON.stringify(value), oid: path });
const RETRIES = {
  $schema: "../../schema/spec.schema.json",
  title: "Retries",
  status: "accepted",
  requirements: [
    { id: "RET-1", text: "Retried five times." },
    { id: "RET-2", text: "Pauses doubel.", level: "should" },
    { id: "RET-3", text: "Can be cancelled.", version: 2, history: [{ version: 1, text: "Can be stopped.", reason: "Stopping isn't cancelling." }] },
  ],
};
const FILES = [file("index.json", { title: "Rocket" }), file("uploads/retries.json", RETRIES), file("cli.json", { title: "Command line", requirements: [{ id: "C1", text: "Exits with 1." }] })];
const spec = buildSpec(FILES);
const retries = spec.nodes.get("uploads/retries");
const item = SpecItem.parse(RETRIES);
const requirement = (id: string) => {
  const found = item.requirements?.find((r) => r.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

describe("editing a requirement", () => {
  it("makes a new version when what it means changes, with what it said and why", () => {
    const revised = reviseRequirement(requirement("RET-1"), { text: "Retried three times.", level: "must", reason: "Five kept phones awake." }, "2026-11-20");
    expect(revised).toEqual({
      id: "RET-1",
      text: "Retried three times.",
      version: 2,
      history: [{ version: 1, text: "Retried five times.", reason: "Five kept phones awake.", date: "2026-11-20" }],
    });
    // From a later version, the history grows; the level it had is on record.
    const again = reviseRequirement(requirement("RET-3"), { text: "Can be cancelled at any time.", level: "should", reason: "Made optional." }, "2026-11-20");
    expect([again.version, again.level, again.status, again.history?.map((h) => h.version)]).toEqual([3, "should", undefined, [1, 2]]);
    const lowered = reviseRequirement(requirement("RET-2"), { text: "Pauses double.", level: "may", reason: "Not worth requiring." }, "2026-11-20");
    expect(lowered.history).toEqual([{ version: 1, text: "Pauses doubel.", level: "should", reason: "Not worth requiring.", date: "2026-11-20" }]);
  });

  it("leaves the version alone for a wording fix", () => {
    expect(reviseRequirement(requirement("RET-2"), { text: "Pauses double.", level: "should", reason: null })).toEqual({
      id: "RET-2",
      text: "Pauses double.",
      level: "should",
    });
  });

  it("deprecates with the reason, keeping what it said", () => {
    expect(deprecateRequirement(requirement("RET-1"), "Nobody retries.", ["#RET-2"], "2026-11-20")).toEqual({
      id: "RET-1",
      text: "Retried five times.",
      status: "deprecated",
      deprecation: { reason: "Nobody retries.", replacedBy: ["#RET-2"], date: "2026-11-20" },
    });
  });

  it("adds, replaces and takes back requirements of an item", () => {
    const added = withNewRequirement(item, { id: "RET-4", text: "Gives up after a minute.", level: "should" });
    // It says what is wanted and nothing about what is built: it has its item's status.
    expect(added.requirements?.at(-1)).toEqual({ id: "RET-4", text: "Gives up after a minute.", level: "should" });
    expect(withRequirement(added, "RET-4", null).requirements?.map((r) => r.id)).toEqual(["RET-1", "RET-2", "RET-3"]);
    expect(withRequirement(item, "RET-1", { id: "RET-1", text: "New." }).requirements?.[0]?.text).toBe("New.");
  });

  it("edits an item's own fields, and deprecates it with a reason", () => {
    const edited = withFields(item, { title: "Retrying", summary: "Trying again.", description: "", status: "deprecated", deprecationReason: "Uploads resume now." }, "2026-11-20");
    expect([edited.title, edited.summary, edited.description, edited.status, edited.deprecation]).toEqual([
      "Retrying",
      "Trying again.",
      undefined,
      "deprecated",
      { reason: "Uploads resume now.", date: "2026-11-20" },
    ]);
    // Back to a live status, the record goes.
    expect(withFields(edited, { title: "Retrying", summary: "", description: "", status: "accepted", deprecationReason: "" }).deprecation).toBeUndefined();
  });
});

describe("ids for what is new", () => {
  it("continues an item's numbering with an id nothing in the spec has", () => {
    if (!retries) throw new Error("no retries");
    expect(suggestRequirementId(spec, retries)).toBe("RET-4");
    // The spec already has a C1 elsewhere: ids are unique in the whole spec.
    const clash = buildSpec([file("a.json", { title: "A", requirements: [{ id: "C2", text: "x" }] }), file("c.json", { title: "C", requirements: [{ id: "C1", text: "y" }] })]);
    expect(suggestRequirementId(clash, clash.nodes.get("c") ?? clash.root)).toBe("C3");
    // An item without requirements gets a prefix from its name.
    expect(suggestRequirementId(spec, spec.root.children.find((n) => n.id === "uploads") ?? spec.root)).toBe("UPL-1");
  });

  it("names a new item after its title, without taking an id that exists", () => {
    expect(newItemId(spec, spec.nodes.get("uploads") ?? spec.root, "Resuming uploads!")).toBe("uploads/resuming-uploads");
    expect(newItemId(spec, spec.root, "CLI")).toBe("cli-2");
    expect(newItemId(spec, spec.root, "…")).toBe("item");
  });
});

describe("a draft over a spec", () => {
  const revised = withRequirement(item, "RET-1", reviseRequirement(requirement("RET-1"), { text: "Retried three times.", level: "must", reason: "Five kept phones awake." }, "2026-11-20"));
  const draft: SpecReworkDraft = {
    active: true,
    note: "Keep the old constant around for the migration.",
    items: {
      "uploads/retries": withNewRequirement(withRequirement(revised, "RET-2", deprecateRequirement(requirement("RET-2"), "Never mattered.", [], "2026-11-20")), {
        id: "RET-4",
        text: "Gives up after a minute.",
        level: "must",
      }),
      "uploads/resume": { title: "Resuming", requirements: [{ id: "RES-1", text: "Asks the server how much it has." }] },
      // The repository already says this: nothing to hand over.
      cli: { title: "Command line", requirements: [{ id: "C1", text: "Exits with 1." }] },
      // Stored by an older version of the app, say: dropped.
      broken: { titel: "Oops" },
    },
  };
  const reworked = applyRework(FILES, spec, draft);

  it("gives the spec as it would be, and the files to write", () => {
    expect(reworked.settled).toEqual(["cli"]);
    expect(reworked.files.map((f) => [f.path, f.isNew])).toEqual([
      [".spec/uploads/retries.json", false],
      [".spec/uploads/resume.json", true],
    ]);
    expect(reworked.spec.problems).toEqual([]);
    expect(reworked.spec.requirements.get("RET-1")?.requirement.version).toBe(2);
    // An existing file keeps pointing at the schema the way it did.
    expect(reworked.files[0]?.text.startsWith('{\n  "$schema": "../../schema/spec.schema.json",\n  "title": "Retries",')).toBe(true);
    expect(reworked.files[0]?.text.endsWith("}\n")).toBe(true);
  });

  it("hands over what changed, why, the whole files and what to do about the code", () => {
    const prompt = specReworkPrompt({ repo: "acme/rocket", branch: "main", diff: diffSpecs(spec, reworked.spec), files: reworked.files, note: draft.note });
    expect(prompt).toMatch(/^Update the spec of acme\/rocket, and the code to match it\./);
    expect(prompt).toContain("### uploads / Retries (`.spec/uploads/retries.json`): changed");
    expect(prompt).toContain('- RET-1: version 1 to 2; was "Retried five times.", now "Retried three times.". Why: Five kept phones awake.');
    expect(prompt).toContain("- RET-2: deprecated. Why: Never mattered.");
    expect(prompt).toContain('- RET-4: new (must). "Gives up after a minute."');
    expect(prompt).toContain("### uploads / Resuming (`.spec/uploads/resume.json`): new item");
    expect(prompt).toContain("## Also\n\nKeep the old constant around for the migration.");
    // The complete files, to be written as they are.
    expect(prompt).toContain('### `.spec/uploads/resume.json` (new)\n\n    {\n      "title": "Resuming",');
    expect(prompt).toContain("requirement by requirement: RES-1, RET-1, RET-2, RET-4");
    expect(prompt).not.toContain("cli.json");
  });
});

describe("a pull request for a rework", () => {
  it("names its branch after the title, and stays a valid ref", () => {
    expect(specPullBranch("Spec: Retries & Errors!", "1a2b3c")).toBe("spec/retries-errors-1a2b3c");
    expect(specPullBranch("Spec: ", "1a2b3c")).toBe("spec/rework-1a2b3c");
    expect(specPullBranch(`Spec: ${"long ".repeat(30)}`, "1a2b3c").length).toBeLessThanOrEqual(52);
  });
});

describe("reworking a named value", () => {
  const original: SpecValue = { id: "retry.max", type: "number", value: 5, unit: "times", description: "Tries." };

  it("records what it was, with why, when what it is changes", () => {
    expect(reviseValue(original, { ...original, value: 3 }, "Phones stayed awake.", "2026-11-20")).toEqual({
      ...original,
      value: 3,
      history: [{ value: 5, reason: "Phones stayed awake.", date: "2026-11-20" }],
    });
  });

  it("leaves no record for a new description, and keeps the history it had", () => {
    const withPast: SpecValue = { ...original, history: [{ value: 8, reason: "Too many." }] };
    expect(reviseValue(withPast, { ...original, description: "How often it is tried again." }, "")).toEqual({ ...withPast, description: "How often it is tried again." });
  });

  it("keeps a color's dark value in the record, and deprecates with why", () => {
    const color: SpecValue = { id: "c", type: "color", value: "#000000", dark: "#ffffff" };
    expect(reviseValue(color, { id: "c", type: "color", value: "#111111" }, "Softer.", "2026-11-20").history).toEqual([{ value: "#000000", dark: "#ffffff", reason: "Softer.", date: "2026-11-20" }]);
    expect(deprecateValue(original, "Unlimited now.", "2026-11-20")).toMatchObject({ status: "deprecated", deprecation: { reason: "Unlimited now.", date: "2026-11-20" } });
  });

  it("puts a value into an item, replaces it, and takes a new one out again", () => {
    const item = { title: "Retries" };
    const added = withValue(item, original.id, original);
    expect(added.values).toEqual([original]);
    expect(withValue(added, original.id, { ...original, value: 3 }).values?.[0]?.value).toBe(3);
    expect(withValue(added, original.id, null)).toEqual(item);
  });
});

