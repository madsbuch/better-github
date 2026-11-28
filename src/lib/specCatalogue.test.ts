// Spec: SC1, SC2, SC4, SC5, SC7, SC8

import { describe, expect, it } from "vitest";
import { buildSpec, type SpecFile } from "./spec";
import { addSpecCatalogue, isRepoName, planImport, sharedParts, type ImportSource } from "./specCatalogue";

// Object ids are made from contents, and the reader parses a file once per id.
const file = (path: string, value: unknown): SpecFile => ({ path, text: JSON.stringify(value), truncated: false, oid: `oid:${path}:${JSON.stringify(value)}` });
const oid = (files: SpecFile[], path: string) => files.find((f) => f.path === path)?.oid ?? "";
const COMMIT = "c".repeat(40);
const TREE = "7".repeat(40);

const tandem = (folder: string): SpecFile[] => [
  file(`${folder}/index.json`, {
    title: "Tandem",
    shared: { id: "tandem", logo: `${folder}/logo.png` },
    requirements: [{ id: "tandem.SYN-1", text: "Devices sync." }],
    values: [{ id: "tandem.lifetime", type: "duration", value: "10min" }],
  }),
  file(`${folder}/pairing.json`, { title: "Pairing", requirements: [{ id: "tandem.SYN-2", text: "A device joins by a code." }] }),
  { path: `${folder}/logo.png`, text: null, truncated: false, oid: "oid:logo" },
];
const CATALOGUE: SpecFile[] = [file("index.json", { title: "Shared specs" }), ...tandem("tandem"), file("drafts/index.json", { title: "Not shared yet" }), file("loose.json", { title: "Not a part" })];
const catalogue = buildSpec(CATALOGUE);
const part = catalogue.nodes.get("tandem");
if (part === undefined) throw new Error("fixture");
const source: ImportSource = { from: "acme/shared", commit: COMMIT, tree: TREE, part, files: CATALOGUE };

const target = (files: SpecFile[] | null) => ({ name: "acme/app", spec: files === null ? null : buildSpec(files), files });
const APP: SpecFile[] = [file("index.json", { title: "App", summary: "An app." }), file("book.json", { title: "Book", requirements: [{ id: "B1", text: "Pages." }] })];
const imported = (entry: Record<string, unknown>) => ({ id: "tandem", from: "acme/shared", commit: "a".repeat(40), tree: "1".repeat(40), ...entry });

describe("the catalogue's parts", () => {
  it("are its top-level folders that are shared parts, with a permanent id", () => {
    expect(sharedParts(catalogue).map((node) => node.id)).toEqual(["tandem"]);
  });

  it("come from repositories named as owner/repo", () => {
    expect(isRepoName("madsbuch/spec-repo")).toBe(true);
    expect(isRepoName("spec-repo")).toBe(false);
    expect(isRepoName("a/..")).toBe(false);
    expect(addSpecCatalogue("https://github.com/acme/shared.git")).toBe(true);
    expect(addSpecCatalogue("ACME/shared")).toBe(false);
  });
});

describe("planImport", () => {
  it("copies the part's files, and records the part and where it came from in the root item", () => {
    const plan = planImport(source, target(APP));
    if (plan.kind !== "ready") throw new Error(JSON.stringify(plan));
    expect(plan.copies).toEqual([
      { path: ".spec/tandem/index.json", oid: oid(CATALOGUE, "tandem/index.json") },
      { path: ".spec/tandem/pairing.json", oid: oid(CATALOGUE, "tandem/pairing.json") },
      { path: ".spec/tandem/logo.png", oid: "oid:logo" },
    ]);
    expect(plan).toMatchObject({ deletes: [], updates: null, movesFrom: null, title: 'Spec: use the shared part "Tandem" from acme/shared' });
    const root: unknown = JSON.parse(plan.root.text);
    expect(root).toMatchObject({ title: "App", summary: "An app.", imports: [{ id: "tandem", at: "tandem", from: "acme/shared", commit: COMMIT, tree: TREE }] });
    expect(plan.body).toContain("// Spec: tandem.<id>");
    // What adopting the part takes is settled in the format, which the description points to.
    expect(plan.body).toContain("as **Adopting a shared part** in the spec format says: https://raw.githubusercontent.com/madsbuch/better-github/main/spec-llms.txt");
    // Taking a part means taking all of it: implementing is not a question.
    expect(plan.body).toContain("implement every requirement it doesn't meet yet, without asking whether to");
    // What it writes reads back without problems.
    expect(buildSpec([APP[1] ?? file("x.json", {}), file("index.json", root), ...tandem("tandem")]).problems).toEqual([]);
    // A part without groundwork has nothing to ask about.
    expect(plan.body).not.toContain("Groundwork");
    expect(plan.body).toContain("1. **Cite**");
  });

  it("makes the part's groundwork the first step, and the one thing to ask the operator about", () => {
    const files = [
      file("index.json", { title: "Shared specs" }),
      file("chat/index.json", { title: "Chat", shared: { id: "chat" }, groundwork: ["The app has settings the user can open.", { text: "The app has a place for a chat beside the screen.", ways: ["a side panel"] }] }),
    ];
    const chat = buildSpec(files).nodes.get("chat");
    if (chat === undefined) throw new Error("fixture");
    const plan = planImport({ ...source, part: chat, files }, target(APP));
    if (plan.kind !== "ready") throw new Error(JSON.stringify(plan));
    expect(plan.body).toContain("It settles what to do, apart from how to make the groundwork true, which is the operator's choice; in short:");
    expect(plan.body).toContain("1. **Groundwork first.** Before any of the part's code, check the 2 items of `groundwork` in `.spec/chat/index.json`");
    expect(plan.body).toContain("never a reason to decline the part or to stop");
    expect(plan.body).toContain("2. **Cite**");
    expect(plan.body).toContain("9. **Report** the groundwork found and how each item was made true");
  });

  it("starts a spec for a repository that has none", () => {
    const plan = planImport(source, target(null));
    if (plan.kind !== "ready") throw new Error(JSON.stringify(plan));
    expect(JSON.parse(plan.root.text)).toMatchObject({ title: "app", imports: [{ id: "tandem", at: "tandem" }] });
  });

  it("updates an earlier copy, keeping what the repository set, and removes what the part no longer has", () => {
    const before = [
      file("index.json", { title: "App", imports: [imported({ at: "tandem", order: 3, waived: [{ ref: "#tandem.SYN-2", reason: "No pairing." }] })] }),
      ...tandem("tandem").slice(0, 1),
      file("tandem/old.json", { title: "Old" }),
    ];
    const plan = planImport(source, target(before));
    if (plan.kind !== "ready") throw new Error(JSON.stringify(plan));
    expect(plan).toMatchObject({ updates: "a".repeat(40), movesFrom: null, deletes: [".spec/tandem/old.json"], title: `Spec: update the shared part "Tandem" to ${COMMIT.slice(0, 7)}` });
    expect(JSON.parse(plan.root.text)).toMatchObject({ imports: [{ id: "tandem", at: "tandem", commit: COMMIT, tree: TREE, order: 3, waived: [{ ref: "#tandem.SYN-2" }] }] });
    // The same version again changes nothing.
    const current = [file("index.json", { title: "App", imports: [imported({ at: "tandem", commit: COMMIT, tree: TREE })] }), ...before.slice(1)];
    expect(planImport(source, target(current))).toEqual({ kind: "current", commit: COMMIT });
  });

  it("follows a part that was renamed by its permanent id: the copy moves, its ids stay", () => {
    // It was called "sync" when it was copied.
    const before = [file("index.json", { title: "App", imports: [imported({ at: "sync", waived: [{ ref: "sync/pairing", reason: "No pairing." }, { ref: "#tandem.SYN-1", reason: "x" }] })] }), ...tandem("sync")];
    const plan = planImport(source, target(before));
    if (plan.kind !== "ready") throw new Error(JSON.stringify(plan));
    expect(plan.movesFrom).toBe("sync");
    expect(plan.deletes).toEqual([".spec/sync/index.json", ".spec/sync/pairing.json", ".spec/sync/logo.png"]);
    expect(plan.copies.map((copy) => copy.path)).toEqual([".spec/tandem/index.json", ".spec/tandem/pairing.json", ".spec/tandem/logo.png"]);
    expect(JSON.parse(plan.root.text)).toMatchObject({ imports: [{ id: "tandem", at: "tandem", waived: [{ ref: "tandem/pairing" }, { ref: "#tandem.SYN-1" }] }] });
    expect(plan.body).toContain("The part was renamed: it moves from `.spec/sync` to `.spec/tandem`.");
  });

  it("refuses what would break the spec, and says why", () => {
    const reasons = (files: SpecFile[]) => {
      const plan = planImport(source, target(files));
      return plan.kind === "blocked" ? plan.reasons : [];
    };
    expect(reasons([...APP, file("tandem.json", { title: "Our sync" })])).toEqual([
      "It already has its own part at .spec/tandem (.spec/tandem.json). Move it out of the way first, or deprecate it in favour of the shared one.",
    ]);
    expect(reasons([...APP, file("net.json", { title: "Net", requirements: [{ id: "tandem.SYN-2", text: "Taken." }] })])).toEqual([
      "It already uses an id of the part: tandem.SYN-2 (.spec/net.json). Ids are unique in the whole spec.",
    ]);
    expect(reasons([file("index.json", { title: "App", imports: [imported({ at: "tandem", from: "other/specs" })] }), ...tandem("tandem")])).toEqual([
      'It already has "Tandem" (tandem) from other/specs.',
    ]);
    expect(reasons([file("index.json", { title: "App", imports: [imported({ id: "duet", at: "tandem" })] }), file("tandem/index.json", { title: "Duet", shared: { id: "duet" } })])).toEqual([
      "It already has another shared part, duet, at .spec/tandem.",
    ]);
    expect(reasons([file("index.json", { title: "App", bogus: 1 })])).toEqual(["Its .spec/index.json can't be read, and the import is recorded there. Fix that first."]);
  });
});
