import { describe, expect, it } from "vitest";
import committedSchema from "../../schema/spec.schema.json";
import { buildSpec, searchSpec, SpecItem, specCounts, specJsonSchema, specTextBlocks, specTrail, resolveSpecRef, unloadedBelow, type SpecFile } from "./spec";

const file = (path: string, value: unknown): SpecFile => ({ path, text: typeof value === "string" ? value : JSON.stringify(value), truncated: false });

const FILES: SpecFile[] = [
  file("index.json", { title: "Rocket", summary: "Uploads that don't give up." }),
  file("uploads/index.json", { title: "Uploads", order: 1 }),
  file("uploads/retries.json", {
    title: "Retries",
    status: "implemented",
    requirements: [
      { id: "R1", text: "A failed upload is retried up to five times." },
      { id: "R2", text: "Retries wait twice as long each time.", level: "should", status: "accepted" },
    ],
    figures: [{ src: "assets/timeline.png", caption: "Backoff" }],
    related: ["uploads/limits", "cli#C1"],
  }),
  file("uploads/limits.json", { title: "Limits", order: 1 }),
  file("cli.json", { title: "Command line", requirements: [{ id: "C1", text: "Exits with 1 when an upload fails." }] }),
  { path: "assets/timeline.png", text: null, truncated: false },
];

describe("buildSpec", () => {
  const spec = buildSpec(FILES);

  it("makes the folders the outline, with index.json as the folder's own item", () => {
    expect(spec.problems).toEqual([]);
    expect(spec.root.title).toBe("Rocket");
    expect(spec.root.file).toBe(".spec/index.json");
    // Ordered items first, then the rest by title; assets is a folder without items.
    expect(spec.root.children.map((n) => n.id)).toEqual(["uploads", "cli"]);
    expect(spec.nodes.get("uploads")?.children.map((n) => n.title)).toEqual(["Limits", "Retries"]);
    expect([...spec.assets.keys()]).toEqual(["assets/timeline.png"]);
  });

  it("names a folder without an index.json after the folder", () => {
    const loose = buildSpec([file("auth/tokens.json", { title: "Tokens" })]);
    expect(loose.root.title).toBe("Spec");
    expect(loose.root.children.map((n) => [n.title, n.item, n.file])).toEqual([["auth", null, null]]);
    expect(specTrail(loose.nodes.get("auth/tokens") ?? loose.root).map((n) => n.title)).toEqual(["auth", "Tokens"]);
  });

  it("counts items and requirements below a node", () => {
    expect(specCounts(spec.root)).toEqual({ items: 4, requirements: 3, implemented: 1, deprecated: 0, unloaded: 0 });
    expect(specCounts(spec.nodes.get("uploads") ?? spec.root)).toEqual({ items: 2, requirements: 2, implemented: 1, deprecated: 0, unloaded: 0 });
  });

  it("wants requirement ids to be unique in the whole spec, not just in their item", () => {
    const clash = buildSpec([
      file("a.json", { title: "A", requirements: [{ id: "R1", text: "first" }, { id: "A-2", text: "fine" }] }),
      file("b/c.json", { title: "C", requirements: [{ id: "R1", text: "second" }, { id: "r1", text: "ids are case-sensitive" }] }),
    ]);
    expect(clash.problems).toEqual([{ file: ".spec/b/c.json", message: "Requirement id R1 is already in .spec/a.json. Ids are unique in the whole spec." }]);
    // The first by file path keeps the id.
    expect(clash.requirements.get("R1")?.node.id).toBe("a");
    expect([...clash.requirements.keys()]).toEqual(["R1", "A-2", "r1"]);
  });

  it("keeps deprecated requirements, with why, and wants the status and the record to go together", () => {
    const kept = buildSpec([
      file("a.json", {
        title: "A",
        status: "implemented",
        requirements: [
          { id: "A-1", text: "Still wanted." },
          { id: "A-2", text: "Dropped.", status: "deprecated", deprecation: { reason: "Nobody used it.", replacedBy: ["#A-1", "b"], date: "2026-03-01" } },
          { id: "A-3", text: "Dropped without a word.", status: "deprecated" },
          { id: "A-4", text: "Not deprecated at all.", deprecation: { reason: "A leftover.", replacedBy: ["#A-9"] } },
        ],
      }),
      file("b.json", { title: "B", status: "deprecated", deprecation: { reason: "Folded into A." }, requirements: [{ id: "B-1", text: "Goes with its item." }] }),
      file("c.json", { title: "C", status: "deprecated" }),
    ]);
    expect(kept.problems.map((p) => `${p.file}: ${p.message}`)).toEqual([
      '.spec/a.json: Requirement A-3 is deprecated without saying why. Add "deprecation": { "reason": "..." }.',
      '.spec/a.json: Requirement A-4 has a deprecation, but its status isn\'t "deprecated".',
      '.spec/a.json: Requirement A-4 is replaced by "#A-9", which isn\'t in the spec.',
      '.spec/c.json: The item is deprecated without saying why. Add "deprecation": { "reason": "..." }.',
    ]);
    // Deprecated requirements aren't counted among the requirements; a deprecated item's are all deprecated.
    expect(specCounts(kept.root)).toEqual({ items: 3, requirements: 2, implemented: 2, deprecated: 3, unloaded: 0 });
    // They are still there to be found, by what they said and by why they went.
    expect(searchSpec(kept, "nobody used").map((m) => m.requirements.map((r) => r.id))).toEqual([["A-2"]]);
    expect(SpecItem.safeParse({ title: "X", deprecation: { reason: "" } }).success).toBe(false);
    expect(SpecItem.safeParse({ title: "X", status: "deprecated", deprecation: { reason: "Why.", date: "March" } }).success).toBe(false);
  });

  it("keeps a requirement's earlier versions, each with why it changed", () => {
    const earlier = (version: number, text: string) => ({ version, text, reason: `Why ${version} went.` });
    const versioned = buildSpec([
      file("a.json", {
        title: "A",
        requirements: [
          { id: "A-1", text: "Never changed." },
          { id: "A-2", text: "Third wording.", version: 3, history: [earlier(1, "First wording."), earlier(2, "Second wording.")] },
          { id: "A-3", text: "Says 2, shows nothing.", version: 2 },
          { id: "A-4", text: "Says 4, shows one.", version: 4, history: [earlier(1, "One.")] },
          { id: "A-5", text: "Forgot to count.", history: [earlier(1, "One.")] },
          { id: "A-6", text: "Out of order.", version: 3, history: [earlier(2, "Two."), earlier(1, "One.")] },
        ],
        related: ["#A-2@1", "#A-2@3", "#A-2@4", "a#A-1@1", "a#A-1@2"],
      }),
    ]);
    expect(versioned.problems.map((p) => p.message)).toEqual([
      "Requirement A-3 is at version 2, but its history has no earlier versions. Add what each earlier version said, and why it changed.",
      "Requirement A-4 is at version 4, but its history has only 1. Add what each earlier version said, and why it changed.",
      "Requirement A-5 has a history of 1 earlier version, so it is at version 2, not 1.",
      "Requirement A-6's history isn't in order: its versions run 1, 2, 3, oldest first.",
      // A reference can name a version, but only one the requirement has reached.
      'Nothing in the spec is called "#A-2@4".',
      'Nothing in the spec is called "a#A-1@2".',
    ]);
    // Found by what it used to say, and by why that changed.
    expect(searchSpec(versioned, "first wording").map((m) => m.requirements.map((r) => r.id))).toEqual([["A-2"]]);
    expect(searchSpec(versioned, "second wording why 2 went").map((m) => m.requirements.map((r) => r.id))).toEqual([["A-2"]]);
    expect(SpecItem.safeParse({ title: "X", requirements: [{ id: "1", text: "t", version: 2, history: [{ version: 1, text: "old" }] }] }).success).toBe(false);
    expect(SpecItem.safeParse({ title: "X", requirements: [{ id: "1", text: "t", version: 0 }] }).success).toBe(false);
  });

  it("reads an item that still lists code files, without them, and says the format no longer has that", () => {
    const old = buildSpec([file("a.json", { title: "A", code: ["src/a.ts", "src/b/**"], requirements: [{ id: "A-1", text: "x" }] })]);
    expect(old.nodes.get("a")?.item).toEqual({ title: "A", requirements: [{ id: "A-1", text: "x" }] });
    expect(old.problems).toEqual([
      { file: ".spec/a.json", message: "`code` is no longer part of the format: a spec doesn't point into a code base. Remove it." },
    ]);
    // The schema itself has no such field.
    expect(SpecItem.safeParse({ title: "A", code: ["src/a.ts"] }).success).toBe(false);
  });

  it("resolves references to items and requirements", () => {
    // A requirement by its id alone, wherever it is.
    expect(resolveSpecRef(spec, "#C1")?.node.id).toBe("cli");
    expect(resolveSpecRef(spec, "#C9")).toBeNull();
    expect(resolveSpecRef(spec, "cli#C1")?.requirement?.text).toBe("Exits with 1 when an upload fails.");
    expect(resolveSpecRef(spec, "uploads")?.node.title).toBe("Uploads");
    expect(resolveSpecRef(spec, "cli#C9")).toBeNull();
  });

  it("lists items whose contents aren't loaded yet under their file's name, without calling them broken", () => {
    const partial = buildSpec([
      file("index.json", { title: "Rocket" }),
      { path: "uploads/index.json", text: null, oid: "a" },
      { ...file("uploads/retries.json", { title: "Retries", requirements: [{ id: "R1", text: "x" }], related: ["uploads/limits#L9", "cli"] }), oid: "b" },
      { path: "uploads/limits.json", text: null, oid: "c" },
      { path: "a/b/c/d/e/deep.json", text: null, oid: "d" },
    ]);
    expect(partial.problems).toEqual([{ file: ".spec/uploads/retries.json", message: 'Nothing in the spec is called "cli".' }]);
    const uploads = partial.nodes.get("uploads") ?? partial.root;
    expect([uploads.title, uploads.loaded, uploads.oid]).toEqual(["uploads", false, "a"]);
    expect(uploads.children.map((n) => [n.title, n.loaded])).toEqual([["limits", false], ["Retries", true]]);
    expect(specCounts(partial.root)).toEqual({ items: 4, requirements: 1, implemented: 0, deprecated: 0, unloaded: 3 });
    expect(unloadedBelow(uploads).map((n) => n.id)).toEqual(["uploads", "uploads/limits"]);
    // Folders nest as deep as they like.
    expect(partial.nodes.get("a/b/c/d/e/deep")?.file).toBe(".spec/a/b/c/d/e/deep.json");
  });

  it("keeps what it can read and reports the rest", () => {
    const broken = buildSpec(
      [
        file("ok.json", { title: "Fine", figures: [{ src: "assets/missing.png" }], related: ["nowhere"] }),
        file("bad.json", "{ not json"),
        file("typo.json", { title: "Typo", sumary: "…" }),
        file("empty.json", { title: "" }),
        file("twice.json", { title: "Twice", requirements: [{ id: "A", text: "x" }, { id: "A", text: "y" }] }),
        file("dup.json", { title: "One" }),
        file("dup/index.json", { title: "Other" }),
        { path: "huge.json", text: '{"title":', truncated: true },
      ],
      true,
    );
    expect(broken.root.children.map((n) => [n.id, n.item !== null])).toEqual([
      ["bad", false],
      ["empty", false],
      ["ok", true],
      ["huge", false],
      ["dup", true],
      ["twice", true],
      ["typo", false],
    ]);
    expect(broken.problems.map((p) => `${p.file}: ${p.message}`)).toEqual([
      ".spec: The folder has more files than GitHub lists in one go. Some items are missing here.",
      ".spec/bad.json: The file isn't valid JSON.",
      `.spec/dup/index.json: .spec/dup.json already describes "dup". This file isn't shown.`,
      ".spec/empty.json: title: Too small: expected string to have >=1 characters",
      ".spec/huge.json: The file is too large to read.",
      '.spec/typo.json: Unrecognized key: "sumary"',
      ".spec/twice.json: Requirement id A is more than once in this item. Ids are unique in the whole spec.",
      ".spec/ok.json: Figure assets/missing.png isn't in .spec.",
      '.spec/ok.json: Nothing in the spec is called "nowhere".',
    ]);
  });
});

describe("searchSpec", () => {
  const spec = buildSpec(FILES);
  it("finds items by their own text, and requirements by theirs", () => {
    expect(searchSpec(spec, "retries").map((m) => [m.node.id, m.requirements.map((r) => r.id)])).toEqual([["uploads/retries", []]]);
    expect(searchSpec(spec, "upload FAIL").map((m) => [m.node.id, m.requirements.map((r) => r.id)])).toEqual([
      ["uploads/retries", ["R1"]],
      ["cli", ["C1"]],
    ]);
    expect(searchSpec(spec, "  ")).toEqual([]);
  });
});

describe("specTextBlocks", () => {
  it("splits paragraphs and lists", () => {
    expect(specTextBlocks("One\nline.\n\n- a\n- b\n\n\nIt covers:\n- c\nLast.")).toEqual([
      { kind: "paragraph", text: "One line." },
      { kind: "list", items: ["a", "b"] },
      { kind: "paragraph", text: "It covers:" },
      { kind: "list", items: ["c"] },
      { kind: "paragraph", text: "Last." },
    ]);
  });
});

describe("schema/spec.schema.json", () => {
  it("is the schema the app reads specs with (npm run spec:schema writes it)", () => {
    expect(committedSchema).toEqual(specJsonSchema());
  });
});

describe("this repository's own .spec", () => {
  // Vite reads the folder at build time: the items' text, and the other files' paths.
  const items = import.meta.glob<string>("../../.spec/**/*.json", { query: "?raw", import: "default", eager: true });
  const files = import.meta.glob("../../.spec/**/*");
  const path = (key: string) => key.slice("../../.spec/".length);

  it("reads without problems", () => {
    const spec = buildSpec([
      ...Object.entries(items).map(([key, text]) => ({ path: path(key), text, truncated: false })),
      ...Object.keys(files)
        .filter((key) => !key.endsWith(".json"))
        .map((key) => ({ path: path(key), text: null, truncated: false })),
    ]);
    expect(spec.problems).toEqual([]);
    expect(spec.root.item).not.toBeNull();
  });
});
