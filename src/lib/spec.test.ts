import { describe, expect, it } from "vitest";
import committedSchema from "../../schema/spec.schema.json";
import { buildSpec, searchSpec, specCounts, specJsonSchema, specTextBlocks, specTrail, resolveSpecRef, type SpecFile } from "./spec";

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
    expect(specCounts(spec.root)).toEqual({ items: 4, requirements: 3, implemented: 1 });
    expect(specCounts(spec.nodes.get("uploads") ?? spec.root)).toEqual({ items: 2, requirements: 2, implemented: 1 });
  });

  it("resolves references to items and requirements", () => {
    expect(resolveSpecRef(spec, "cli#C1")?.requirement?.text).toBe("Exits with 1 when an upload fails.");
    expect(resolveSpecRef(spec, "uploads")?.node.title).toBe("Uploads");
    expect(resolveSpecRef(spec, "cli#C9")).toBeNull();
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
      ["a/b/c/d"],
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
      ".spec/a/b/c/d: Items can be at most 3 folders deep. What's in this folder isn't shown.",
      ".spec/bad.json: The file isn't valid JSON.",
      `.spec/dup/index.json: .spec/dup.json already describes "dup". This file isn't shown.`,
      ".spec/empty.json: title: Too small: expected string to have >=1 characters",
      ".spec/huge.json: The file is too large to read.",
      '.spec/typo.json: Unrecognized key: "sumary"',
      ".spec/ok.json: Figure assets/missing.png isn't in .spec.",
      '.spec/ok.json: Nothing in the spec is called "nowhere".',
      ".spec/twice.json: Requirement A is there more than once.",
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
