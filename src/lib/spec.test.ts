// Spec: S1, S3, S4, S15, S16, S19, S24, S25, S26, S28, S30

import { describe, expect, it } from "vitest";
import committedSchema from "../../schema/spec.schema.json";
import { buildSpec, findInSpec, searchSpec, specFindCounts, SpecItem, storySentence, valueText, specCounts, specJsonSchema, specTextBlocks, specTrail, resolveSpecRef, unloadedBelow, type SpecFile } from "./spec";

const file = (path: string, value: unknown): SpecFile => ({ path, text: typeof value === "string" ? value : JSON.stringify(value), truncated: false });

const FILES: SpecFile[] = [
  file("index.json", { title: "Rocket", summary: "Uploads that don't give up." }),
  file("uploads/index.json", { title: "Uploads", order: 1 }),
  file("uploads/retries.json", {
    title: "Retries",
    requirements: [
      { id: "R1", text: "A failed upload is retried up to five times." },
      { id: "R2", text: "Retries wait twice as long each time.", level: "should" },
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
    expect(specCounts(spec.root)).toEqual({ items: 4, requirements: 3, deprecated: 0, stories: 0, values: 0, unloaded: 0 });
    expect(specCounts(spec.nodes.get("uploads") ?? spec.root)).toEqual({ items: 2, requirements: 2, deprecated: 0, stories: 0, values: 0, unloaded: 0 });
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

  it("keeps deprecated requirements, with why: what has the record is deprecated", () => {
    const kept = buildSpec([
      file("a.json", {
        title: "A",
        requirements: [
          { id: "A-1", text: "Still wanted." },
          { id: "A-2", text: "Dropped.",  deprecation: { reason: "Nobody used it.", replacedBy: ["#A-1", "b"], date: "2026-03-01" } },
          { id: "A-4", text: "Dropped for something that isn't there.", deprecation: { reason: "Replaced.", replacedBy: ["#A-9"] } },
        ],
      }),
      file("b.json", { title: "B",  deprecation: { reason: "Folded into A." }, requirements: [{ id: "B-1", text: "Goes with its item." }] }),
      file("c.json", { title: "C" }),
    ]);
    expect(kept.problems.map((p) => `${p.file}: ${p.message}`)).toEqual([
      '.spec/a.json: Requirement A-4 is replaced by "#A-9", which isn\'t in the spec.',
    ]);
    // Deprecated requirements aren't counted among the requirements; a deprecated item's are all deprecated.
    expect(specCounts(kept.root)).toEqual({ items: 3, requirements: 1, deprecated: 3, stories: 0, values: 0, unloaded: 0 });
    // They are still there to be found, by what they said and by why they went.
    expect(searchSpec(kept, "nobody used").map((m) => m.requirements.map((r) => r.id))).toEqual([["A-2"]]);
    expect(SpecItem.safeParse({ title: "X", deprecation: { reason: "" } }).success).toBe(false);
    expect(SpecItem.safeParse({ title: "X",  deprecation: { reason: "Why.", date: "March" } }).success).toBe(false);
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
      { file: ".spec/a.json", message: "`code` is no longer part of the format: a spec has no list of code references. Remove it." },
    ]);
    // The schema itself has no such field.
    expect(SpecItem.safeParse({ title: "A", code: ["src/a.ts"] }).success).toBe(false);
  });

  it("has no statuses, and reads a file that still has them without them", () => {
    expect(SpecItem.safeParse({ title: "A", status: "accepted" }).success).toBe(false);
    const old = buildSpec([
      file("a.json", { title: "A", status: "implemented", requirements: [{ id: "A-1", text: "x", status: "draft" }, { id: "A-2", text: "y", status: "deprecated", deprecation: { reason: "Gone." } }] }),
      file("b.json", { title: "B", stories: [{ id: "US-1", as: "a", want: "b", status: "deprecated" }], values: [{ id: "v", type: "text", value: "x", status: "accepted" }] }),
      file("c.json", { title: "C" }),
    ]);
    expect(old.nodes.get("a")?.item).toEqual({ title: "A", requirements: [{ id: "A-1", text: "x" }, { id: "A-2", text: "y", deprecation: { reason: "Gone." } }] });
    const note = "`status` is no longer part of the format: what is in a spec is what the product is to do, and what was dropped has a `deprecation`. Remove it.";
    expect(old.problems).toEqual([
      { file: ".spec/a.json", message: note },
      { file: ".spec/b.json", message: note },
      // It said deprecated and nothing says so now: the record is missing.
      { file: ".spec/b.json", message: 'User story US-1 was marked deprecated without saying why. Add "deprecation": { "reason": "..." }.' },
    ]);
    // What carries the record is deprecated; nothing else says where it stands.
    expect(specCounts(old.root)).toMatchObject({ requirements: 1, deprecated: 1, stories: 1, values: 1 });
  });

  it("has user stories: who wants what and why, and the requirements that make it true", () => {
    const told = buildSpec([
      file("uploads.json", {
        title: "Uploads",
        stories: [
          { id: "US-1", as: "a commuter uploading on a train", want: "to send a file without watching it", soThat: "I can put the phone away", requirements: ["#RET-1", "retries#RET-2"] },
          { id: "US-2", as: "a caller", want: "to know when an upload failed for good" },
          { id: "US-3", as: "an admin", want: "a log of every byte",  deprecation: { reason: "Nobody read it." } },
          { id: "US-4", as: "a tester", want: "something vague", requirements: ["#RET-9", "#US-1"] },
          // Stories and requirements share one set of ids.
          { id: "RET-1", as: "a duplicate", want: "trouble" },
        ],
        related: ["#US-1", "uploads#US-2", "#US-1@2"],
      }),
      file("retries.json", { title: "Retries", requirements: [{ id: "RET-1", text: "Retried five times." }, { id: "RET-2", text: "Pauses double." }, { id: "US-2", text: "Clash." }] }),
    ]);
    expect(storySentence(told.stories.get("US-1")?.story ?? { id: "", as: "", want: "" })).toBe(
      "As a commuter uploading on a train, I want to send a file without watching it, so that I can put the phone away.",
    );
    expect(storySentence({ id: "x", as: "a caller", want: "to know" })).toBe("As a caller, I want to know.");
    expect(told.problems.map((p) => `${p.file}: ${p.message}`)).toEqual([
      ".spec/uploads.json: User story id US-2 is already in .spec/retries.json. Ids are unique in the whole spec.",
      ".spec/uploads.json: User story id RET-1 is already in .spec/retries.json. Ids are unique in the whole spec.",
      // A story's requirements have to be requirements: not missing, and not another story.
      '.spec/uploads.json: User story US-4 names "#RET-9", which isn\'t a requirement in the spec.',
      '.spec/uploads.json: User story US-4 names "#US-1", which isn\'t a requirement in the spec.',
      // A story has no versions.
      '.spec/uploads.json: Nothing in the spec is called "#US-1@2".',
    ]);
    expect(resolveSpecRef(told, "#US-1")?.story?.as).toBe("a commuter uploading on a train");
    expect(resolveSpecRef(told, "#RET-1")?.requirement?.text).toBe("Retried five times.");
    // Deprecated stories aren't counted among the stories.
    expect(specCounts(told.root).stories).toBe(4);
    expect(searchSpec(told, "put the phone away").map((m) => [m.node.id, m.stories.map((story) => story.id)])).toEqual([["uploads", ["US-1"]]]);
    expect(SpecItem.safeParse({ title: "X", stories: [{ id: "US-1", as: "a user" }] }).success).toBe(false);
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
    expect(specCounts(partial.root)).toEqual({ items: 4, requirements: 1, deprecated: 0, stories: 0, values: 0, unloaded: 3 });
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

  it("has named values: typed, named once in the whole spec, changed and dropped with a reason", () => {
    const named = buildSpec([
      file("index.json", { title: "Rocket" }),
      file("tokens.json", {
        title: "Tokens",
        values: [
          { id: "color.accent", type: "color", value: "#0969da", dark: "#4493f8", description: "Links and the primary button." },
          { id: "retry.max", type: "number", value: 3, unit: "times", history: [{ value: 5, reason: "Phones stayed awake." }] },
          { id: "space.gutter", type: "dimension", value: "16px" },
          { id: "toast.stay", type: "duration", value: "4s" },
          { id: "roles", type: "list", value: ["admin", "member"] },
          { id: "old.name", type: "text", value: "Rocket Pro", deprecation: { reason: "Renamed." } },
          // One set of ids, for values too.
          { id: "RET-1", type: "text", value: "clash" },
        ],
        related: ["#retry.max", "#nope.value"],
      }),
      file("retries.json", { title: "Retries", requirements: [{ id: "RET-1", text: "Retried `retry.max` times." }] }),
    ]);
    expect(named.problems.map((p) => p.message)).toEqual([
      "Value id RET-1 is already in .spec/retries.json. Ids are unique in the whole spec.",
      'Nothing in the spec is called "#nope.value".',
    ]);
    expect(resolveSpecRef(named, "#retry.max")?.value?.value).toBe(3);
    expect(resolveSpecRef(named, "tokens#color.accent")?.value?.type).toBe("color");
    // Deprecated ones aren't counted.
    expect(specCounts(named.root).values).toBe(6);
    // Found by name, by what it is, and by why it changed.
    expect(searchSpec(named, "#4493f8").map((m) => m.values.map((v) => v.id))).toEqual([["color.accent"]]);
    expect(searchSpec(named, "stayed awake").map((m) => m.values.map((v) => v.id))).toEqual([["retry.max"]]);
    expect(valueText({ value: 3, unit: "times" })).toBe("3 times");
    // Each type takes only its own form.
    const bad = [
      { id: "a", type: "color", value: "blue" },
      { id: "a", type: "dimension", value: "16" },
      { id: "a", type: "duration", value: "soon" },
      { id: "a", type: "number", value: "5" },
      { id: "a", type: "list", value: "admin" },
      { id: "a", type: "number", value: 5, dark: "#000000" },
      { id: "a", type: "money", value: 5 },
    ];
    for (const value of bad) expect(SpecItem.safeParse({ title: "X", values: [value] }).success).toBe(false);
  });
});

describe("the index of a spec, and the search over it", () => {
  const spec = buildSpec([
    file("index.json", { title: "Rocket" }),
    file("uploads/index.json", { title: "Uploads", summary: "Sending a file." }),
    file("uploads/retries.json", {
      title: "Retries",
      stories: [{ id: "US-1", as: "a commuter", want: "uploads to survive tunnels" }],
      requirements: [
        { id: "R10", text: "Gives up after a minute." },
        { id: "R2", text: "Resumes where it stopped.", version: 2, history: [{ version: 1, text: "Starts over.", reason: "Trains have tunnels." }] },
        { id: "R1", text: "Retried up to `retry.max` times." },
        { id: "R3", text: "Writes a log of every retry.", deprecation: { reason: "Nobody read the log." } },
      ],
      values: [{ id: "retry.max", type: "number", value: 5, unit: "times" }],
    }),
    file("old.json", { title: "Legacy uploader", deprecation: { reason: "Replaced by resumable uploads." }, requirements: [{ id: "L1", text: "Uploads in one request." }] }),
  ]);
  const ids = (entries: { kind: string; id: string }[]) => entries.map((entry) => `${entry.kind}:${entry.id}`);

  it("lists every entry of a kind by id, the way a person orders ids, and what was dropped apart", () => {
    expect(ids(findInSpec(spec, "", "requirements"))).toEqual(["requirement:R1", "requirement:R2", "requirement:R10"]);
    expect(ids(findInSpec(spec, "", "stories"))).toEqual(["story:US-1"]);
    expect(ids(findInSpec(spec, "", "values"))).toEqual(["value:retry.max"]);
    // What was dropped, of any kind. A dropped part stands for what is in it.
    expect(ids(findInSpec(spec, "", "deprecated"))).toEqual(["part:old", "requirement:R3"]);
    // Everything, unasked, is the outline's to show.
    expect(findInSpec(spec, "", "all")).toEqual([]);
    expect(specFindCounts(spec)).toEqual({ requirements: 3, stories: 1, values: 1, deprecated: 3 });
  });

  it("finds by id first, then by what an entry says, then by what it used to say and why it went", () => {
    // The entry whose id it is comes before ids that only start with it.
    expect(ids(findInSpec(spec, "r1", "all"))).toEqual(["requirement:R1", "requirement:R10"]);
    expect(ids(findInSpec(spec, "retry", "all"))).toEqual(["value:retry.max", "requirement:R1", "requirement:R3"]);
    // By what it used to say, and by why it changed.
    expect(ids(findInSpec(spec, "tunnels", "all"))).toEqual(["story:US-1", "requirement:R2"]);
    // A search over everything shows what was dropped too, marked: the idea has been here before.
    expect(findInSpec(spec, "log", "all").map((entry) => [entry.id, entry.deprecated])).toEqual([["R3", true]]);
    expect(findInSpec(spec, "log", "requirements")).toEqual([]);
    expect(ids(findInSpec(spec, "resumable", "deprecated"))).toEqual(["part:old"]);
    // A part is found by its path, its title and its summary.
    expect(ids(findInSpec(spec, "uploads", "all")).slice(0, 2)).toEqual(["part:uploads", "part:uploads/retries"]);
    expect(ids(findInSpec(spec, "legacy uploader", "all"))).toEqual(["part:old"]);
    expect(findInSpec(spec, "nothing like this", "all")).toEqual([]);
  });
});


// Spec: S39, S40, S41
describe("parts imported from a shared spec", () => {
  const TREE = "9e2d7b1c4a6f0e8d3b5c7a9f1e2d4b6c8a0f3e5d";
  const shared = [
    file("sync/index.json", { title: "Sync", order: 1, requirements: [{ id: "SYN-1", text: "Devices sync." }], values: [{ id: "sync.lifetime", type: "duration", value: "10min" }] }),
    file("sync/pairing.json", { title: "Pairing", requirements: [{ id: "SYN-2", text: "A device joins by a code." }] }),
  ];
  const imported = (entry: Record<string, unknown>, more: SpecFile[] = []) =>
    buildSpec(
      [
        file("index.json", { title: "App", imports: [{ at: "sync", from: "acme/shared", commit: "4f1c2a9e0b7d3c6a8e5f1b2d9c0a7e6f3b4d5c8a", tree: TREE, ...entry }] }),
        file("book.json", { title: "Book", order: 1, requirements: [{ id: "B1", text: "A book has pages.", related: ["#SYN-1"] }] }),
        ...shared,
        ...more,
      ],
      false,
      new Map([["sync", TREE]]),
    );

  it("reads the copy like any other part, placed where the product puts it", () => {
    const spec = imported({ order: 0, values: [{ id: "sync.lifetime", value: "5min", reason: "Shorter." }], waived: [{ ref: "#SYN-2", reason: "No pairing." }, { ref: "sync/pairing", reason: "No pairing." }] });
    expect(spec.problems).toEqual([]);
    expect(spec.root.children.map((node) => node.id)).toEqual(["sync", "book"]);
    expect(imported({}).root.children.map((node) => node.id)).toEqual(["book", "sync"]);
  });

  it("says when the copy was edited, so the change goes to the shared spec instead", () => {
    const spec = buildSpec([file("index.json", { title: "App", imports: [{ at: "sync", from: "acme/shared", commit: "4f1c2a9e0b7d3c6a8e5f1b2d9c0a7e6f3b4d5c8a", tree: TREE }] }), ...shared], false, new Map([["sync", "0".repeat(40)]]));
    expect(spec.problems.map((problem) => problem.message)).toEqual([".spec/sync isn't what was copied from acme/shared at 4f1c2a9: it was edited here. Change it in acme/shared and import it again."]);
    // Without git's ids for the folders (an older listing, a draft), there is nothing to compare.
    expect(buildSpec([file("index.json", { title: "App", imports: [{ at: "sync", from: "acme/shared", commit: "4f1c2a9e0b7d3c6a8e5f1b2d9c0a7e6f3b4d5c8a", tree: TREE }] }), ...shared]).problems).toEqual([]);
  });

  it("lists what an import says about something that isn't in the part", () => {
    const messages = (entry: Record<string, unknown>) => imported(entry).problems.map((problem) => problem.message);
    expect(messages({ values: [{ id: "sync.nope", value: "1min", reason: "x" }] })).toEqual([".spec/sync sets sync.nope, which isn't a named value of it."]);
    expect(messages({ values: [{ id: "sync.lifetime", value: 5, reason: "x" }] })).toEqual([".spec/sync sets sync.lifetime to 5, which a duration can't be."]);
    expect(messages({ waived: [{ ref: "#B1", reason: "x" }] })).toEqual(['.spec/sync waives "#B1", which isn\'t a requirement, story or part of it.']);
    expect(messages({ waived: [{ ref: "book", reason: "x" }] })).toEqual(['.spec/sync waives "book", which isn\'t a requirement, story or part of it.']);
    expect(messages({ at: "nothing" })).toEqual([".spec/nothing is imported from acme/shared, but the spec has no such folder."]);
  });

  it("keeps imports on the root item", () => {
    const spec = buildSpec([file("index.json", { title: "App" }), file("other.json", { title: "Other", imports: [] })]);
    expect(spec.problems).toEqual([{ file: ".spec/other.json", message: "Only the root item lists imports. These are left out." }]);
    expect(SpecItem.safeParse({ title: "x", imports: [{ at: "/sync", from: "a/b", commit: "x", tree: "y" }] }).success).toBe(false);
  });
});
