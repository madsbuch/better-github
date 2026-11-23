// Spec: SC1, SC2, SC4, SC5

import { describe, expect, it } from "vitest";
import { buildSpec, type SpecFile } from "./spec";
import { addSpecCatalogue, isRepoName, planImport, sharedParts, type ImportSource } from "./specCatalogue";

// Object ids are made from contents, and the reader parses a file once per id.
const file = (path: string, value: unknown): SpecFile => ({ path, text: JSON.stringify(value), truncated: false, oid: `oid:${path}:${JSON.stringify(value)}` });
const oid = (files: SpecFile[], path: string) => files.find((f) => f.path === path)?.oid ?? "";
const COMMIT = "c".repeat(40);
const TREE = "7".repeat(40);

const CATALOGUE: SpecFile[] = [
  file("index.json", { title: "Shared specs" }),
  file("sync/index.json", { title: "Sync", requirements: [{ id: "SYN-1", text: "Devices sync." }], values: [{ id: "sync.lifetime", type: "duration", value: "10min" }] }),
  file("sync/pairing.json", { title: "Pairing", requirements: [{ id: "SYN-2", text: "A device joins by a code." }] }),
  { path: "sync/assets/flow.png", text: null, truncated: false, oid: "oid:flow" },
  file("loose.json", { title: "Not a part" }),
];
const catalogue = buildSpec(CATALOGUE);
const sync = catalogue.nodes.get("sync");
if (sync === undefined) throw new Error("fixture");
const source: ImportSource = { from: "acme/shared", commit: COMMIT, tree: TREE, part: sync, files: CATALOGUE };

const target = (files: SpecFile[] | null) => ({ name: "acme/app", spec: files === null ? null : buildSpec(files), files });
const APP: SpecFile[] = [file("index.json", { title: "App", summary: "An app." }), file("book.json", { title: "Book", requirements: [{ id: "B1", text: "Pages." }] })];

describe("the catalogue's parts", () => {
  it("are its top-level folders with an index.json", () => {
    expect(sharedParts(catalogue).map((node) => node.id)).toEqual(["sync"]);
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
  it("copies the part's files, and records where they came from in the root item", () => {
    const plan = planImport(source, target(APP));
    if (plan.kind !== "ready") throw new Error(JSON.stringify(plan));
    expect(plan.copies).toEqual([
      { path: ".spec/sync/index.json", oid: oid(CATALOGUE, "sync/index.json") },
      { path: ".spec/sync/pairing.json", oid: oid(CATALOGUE, "sync/pairing.json") },
      { path: ".spec/sync/assets/flow.png", oid: "oid:flow" },
    ]);
    expect(plan.deletes).toEqual([]);
    expect(plan.updates).toBeNull();
    expect(plan.root.path).toBe(".spec/index.json");
    const root: unknown = JSON.parse(plan.root.text);
    expect(root).toMatchObject({ title: "App", summary: "An app.", imports: [{ at: "sync", from: "acme/shared", commit: COMMIT, tree: TREE }] });
    expect(plan.title).toBe('Spec: use the shared part "Sync" from acme/shared');
    expect(plan.body).toContain("For a coding agent");
    // What it writes reads back without problems.
    expect(buildSpec([...APP.filter((f) => f.path !== "index.json"), file("index.json", root), ...CATALOGUE.filter((f) => f.path.startsWith("sync/"))]).problems).toEqual([]);
  });

  it("starts a spec for a repository that has none", () => {
    const plan = planImport(source, target(null));
    if (plan.kind !== "ready") throw new Error(JSON.stringify(plan));
    expect(JSON.parse(plan.root.text)).toMatchObject({ title: "app", imports: [{ at: "sync" }] });
  });

  it("updates an earlier copy, keeping what the repository set, and removes what the part no longer has", () => {
    const before = [
      file("index.json", { title: "App", imports: [{ at: "sync", from: "acme/shared", commit: "a".repeat(40), tree: "1".repeat(40), order: 3, waived: [{ ref: "#SYN-2", reason: "No pairing." }] }] }),
      file("sync/index.json", { title: "Sync", requirements: [{ id: "SYN-1", text: "Devices sync." }] }),
      file("sync/old.json", { title: "Old", requirements: [{ id: "SYN-2", text: "A device joins by a code." }] }),
    ];
    const plan = planImport(source, target(before));
    if (plan.kind !== "ready") throw new Error(JSON.stringify(plan));
    expect(plan.updates).toBe("a".repeat(40));
    expect(plan.deletes).toEqual([".spec/sync/old.json"]);
    expect(JSON.parse(plan.root.text)).toMatchObject({ imports: [{ at: "sync", commit: COMMIT, tree: TREE, order: 3, waived: [{ ref: "#SYN-2" }] }] });
    expect(plan.title).toBe(`Spec: update the shared part "Sync" to ${COMMIT.slice(0, 7)}`);
    // The same version again changes nothing.
    const current = [file("index.json", { title: "App", imports: [{ at: "sync", from: "acme/shared", commit: COMMIT, tree: TREE }] }), ...before.slice(1)];
    expect(planImport(source, target(current))).toEqual({ kind: "current", commit: COMMIT });
  });

  it("refuses what would break the spec, and says why", () => {
    const reasons = (files: SpecFile[]) => {
      const plan = planImport(source, target(files));
      return plan.kind === "blocked" ? plan.reasons : [];
    };
    expect(reasons([...APP, file("sync.json", { title: "Our sync" })])).toEqual([
      "It already has its own part at .spec/sync (.spec/sync.json). Move it out of the way first, or deprecate it in favour of the shared one.",
    ]);
    expect(reasons([...APP, file("net.json", { title: "Net", requirements: [{ id: "SYN-2", text: "Taken." }] })])).toEqual([
      "It already uses an id of the part: SYN-2 (.spec/net.json). Ids are unique in the whole spec.",
    ]);
    expect(reasons([file("index.json", { title: "App", imports: [{ at: "sync", from: "other/specs", commit: COMMIT, tree: TREE }] }), file("sync/index.json", { title: "Sync" })])).toEqual([
      "It already has .spec/sync from other/specs.",
    ]);
    expect(reasons([file("index.json", { title: "App", bogus: 1 })])).toEqual(["Its .spec/index.json can't be read, and the import is recorded there. Fix that first."]);
  });
});
