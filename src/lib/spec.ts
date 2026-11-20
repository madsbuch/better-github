// Spec: a `.spec` folder at the root of a repository says what its code is
// meant to do. Every `.json` file in it is one item of the spec, and all of
// them follow one schema (`SpecItem` below, published as
// schema/spec.schema.json). Anything else in the folder is an asset, such as
// a picture an item shows.
//
//   .spec/
//     index.json                the root: what the product is
//     uploads/
//       index.json              "Uploads", with the items below as its children
//       retries.json            "Retries": requirements R1, R2, ...
//       limits.json
//     assets/
//       retry-timeline.png      shown by uploads/retries.json
//
// The folders are the outline. An item's id is its path without `.spec/` and
// `.json` ("uploads/retries"); a folder's own item is its `index.json`
// ("uploads"). A folder without one is still a group, named after the folder.

import { z } from "zod";

/** At the root of the repository. */
export const SPEC_DIR = ".spec";
export const SPEC_SCHEMA_URL = "https://raw.githubusercontent.com/madsbuch/better-github/main/schema/spec.schema.json";

// ------------------------------------------------------------------ schema

export const SpecStatus = z
  .enum(["draft", "accepted", "implemented", "deprecated"])
  .describe(
    'draft: still being written. accepted: agreed on, not built yet. implemented: the code does this. deprecated: no longer wanted; kept, with a "deprecation" saying why.',
  );
export type SpecStatus = z.infer<typeof SpecStatus>;

export const SpecLevel = z.enum(["must", "should", "may"]).describe("How binding a requirement is. Defaults to must.");
export type SpecLevel = z.infer<typeof SpecLevel>;

const Text = z
  .string()
  .describe("Plain text. A blank line starts a new paragraph, lines starting with \"- \" form a list, and `backticks` mark code.");

const RepoPath = z
  .string()
  .min(1)
  .regex(/^[^/]/, "is relative to the repository's root, without a leading slash");

export const SpecDeprecation = z
  .strictObject({
    reason: Text.min(1).describe("Why it is no longer wanted."),
    replacedBy: z
      .array(z.string().min(1))
      .optional()
      .describe('What takes its place, if anything: requirements ("#RET-7") or items ("uploads/resume").'),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("When it was deprecated, as YYYY-MM-DD."),
  })
  .describe(
    'The record of a deprecation. Goes with "status": "deprecated": a requirement or item that is no longer wanted stays in the spec, marked deprecated with the reason, so it stays known that it existed, that it was dropped, and why. It is never deleted, and its id is never used again.',
  );
export type SpecDeprecation = z.infer<typeof SpecDeprecation>;

export const SpecRequirement = z
  .strictObject({
    id: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      .describe(
        'Unique in the whole spec, not just in its item, and stable once written: code, tests and other items refer to it by this id alone. A prefix per item ("RET-1", "RET-2") keeps ids apart.',
      ),
    text: Text.min(1).describe("One statement that can be checked against the code."),
    level: SpecLevel.optional(),
    status: SpecStatus.optional().describe("Defaults to the item's status."),
    deprecation: SpecDeprecation.optional(),
  })
  .describe("A single testable statement.");
export type SpecRequirement = z.infer<typeof SpecRequirement>;

export const SpecFigure = z
  .strictObject({
    src: RepoPath.describe('An image in the spec folder, as a path from that folder: "assets/retry-timeline.png".'),
    alt: z.string().optional().describe("What the image shows, for when it can't be seen."),
    caption: z.string().optional(),
  })
  .describe("A picture: a mockup, a diagram, a screenshot.");
export type SpecFigure = z.infer<typeof SpecFigure>;

export const SpecItem = z
  .strictObject({
    $schema: z.string().optional().describe("Where this schema lives, so editors can check the file."),
    title: z.string().min(1),
    summary: z.string().optional().describe("One line, shown wherever the item is listed."),
    status: SpecStatus.optional(),
    deprecation: SpecDeprecation.optional(),
    order: z.number().optional().describe("Position among its siblings, lowest first. Items without one come last, by title."),
    description: Text.optional().describe("What this part does and why."),
    requirements: z.array(SpecRequirement).optional(),
    figures: z.array(SpecFigure).optional(),
    questions: z.array(Text).optional().describe("What is still undecided."),
    code: z
      .array(RepoPath)
      .optional()
      .describe('Where this is implemented: paths from the repository\'s root, or patterns with * and ** ("src/upload/**").'),
    related: z
      .array(z.string().min(1))
      .optional()
      .describe('Ids of other items ("uploads/limits"), or requirements: "#LIM-2" wherever it is, or "uploads/limits#LIM-2".'),
  })
  .describe("One item of a repository's spec: a .json file in its .spec folder.");
export type SpecItem = z.infer<typeof SpecItem>;

/** The schema as JSON Schema, for schema/spec.schema.json. */
export function specJsonSchema(): unknown {
  return { $id: SPEC_SCHEMA_URL, ...z.toJSONSchema(SpecItem, { target: "draft-2020-12" }) };
}

// -------------------------------------------------------------------- tree

/** A file in the spec folder. */
export interface SpecFile {
  /** From the spec folder: "uploads/retries.json". */
  path: string;
  /**
   * An item's JSON. Null for assets, and for an item whose contents haven't
   * been loaded: a large spec is listed first and read as it is looked at.
   */
  text: string | null;
  /** Too large for GitHub to send whole. */
  truncated?: boolean | undefined;
  /** The file's git object id: the same for the same content, on any branch. */
  oid?: string | undefined;
}

export interface SpecProblem {
  /** From the repository's root. */
  file: string;
  message: string;
}

export interface SpecNode {
  /** "" for the root. */
  id: string;
  /** The last part of the id. */
  name: string;
  /** The item's title, or the folder's name when it has no item. */
  title: string;
  /** Null for a folder without an index.json, or when its file couldn't be read. */
  item: SpecItem | null;
  /** The item's file, from the repository's root. */
  file: string | null;
  /** Why `file` couldn't be read; it's also among the spec's problems. */
  error: string | null;
  /** False while the item's file is known but its contents aren't loaded yet. */
  loaded: boolean;
  /** The file's git object id, when known. */
  oid: string | null;
  parent: SpecNode | null;
  children: SpecNode[];
}

export interface Spec {
  root: SpecNode;
  nodes: Map<string, SpecNode>;
  /**
   * Every requirement by its id, with the item it is in. Ids are unique in
   * the whole spec; of two with the same id, this is the first by file path.
   */
  requirements: Map<string, { node: SpecNode; requirement: SpecRequirement }>;
  /** Everything that isn't an item, by its path from the spec folder, with its git object id when known. */
  assets: Map<string, string | null>;
  problems: SpecProblem[];
}

const inSpec = (path: string) => `${SPEC_DIR}/${path}`;

type ReadItem = { item: SpecItem } | { error: string };

/** What each file read as, by git object id: a spec is rebuilt as its files arrive, and most don't change. */
const readItems = new Map<string, ReadItem>();
const READ_ITEMS_MAX = 20_000;

function readItem(file: SpecFile): ReadItem {
  if (file.oid === undefined) return parseItem(file);
  const known = readItems.get(file.oid);
  if (known) return known;
  const read = parseItem(file);
  if (readItems.size >= READ_ITEMS_MAX) readItems.clear();
  readItems.set(file.oid, read);
  return read;
}

function parseItem(file: SpecFile): ReadItem {
  if (file.truncated === true) return { error: "The file is too large to read." };
  let value: unknown;
  try {
    value = JSON.parse(file.text ?? "");
  } catch {
    return { error: "The file isn't valid JSON." };
  }
  const result = SpecItem.safeParse(value);
  if (result.success) return { item: result.data };
  const issues = result.error.issues.map((issue) => {
    const at = issue.path.map((part) => part.toString()).join(".");
    return at !== "" ? `${at}: ${issue.message}` : issue.message;
  });
  return { error: issues.join("; ") };
}

/** Splits "uploads/limits#R2" into the item's id and the requirement's. */
export function splitSpecRef(ref: string): { id: string; requirement: string | null } {
  const hash = ref.indexOf("#");
  return hash === -1 ? { id: ref, requirement: null } : { id: ref.slice(0, hash), requirement: ref.slice(hash + 1) };
}

/**
 * Builds the outline from the spec folder's files. Files that can't be read
 * and references that lead nowhere become problems; the rest still shows.
 */
export function buildSpec(files: SpecFile[], listingCutOff = false): Spec {
  const root: SpecNode = { id: "", name: "", title: "Spec", item: null, file: null, error: null, loaded: true, oid: null, parent: null, children: [] };
  const nodes = new Map<string, SpecNode>([["", root]]);
  const assets = new Map<string, string | null>();
  const problems: SpecProblem[] = listingCutOff
    ? [{ file: SPEC_DIR, message: "The folder has more files than GitHub lists in one go. Some items are missing here." }]
    : [];

  const nodeFor = (id: string): SpecNode => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const slash = id.lastIndexOf("/");
    const parent = nodeFor(slash === -1 ? "" : id.slice(0, slash));
    const name = id.slice(slash + 1);
    const node: SpecNode = { id, name, title: name, item: null, file: null, error: null, loaded: true, oid: null, parent, children: [] };
    nodes.set(id, node);
    parent.children.push(node);
    return node;
  };

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!file.path.endsWith(".json")) {
      assets.set(file.path, file.oid ?? null);
      continue;
    }
    const withoutExtension = file.path.slice(0, -".json".length);
    const id = withoutExtension === "index" ? "" : withoutExtension.endsWith("/index") ? withoutExtension.slice(0, -"/index".length) : withoutExtension;
    const node = nodeFor(id);
    if (node.file !== null) {
      problems.push({ file: inSpec(file.path), message: `${node.file} already describes "${id}". This file isn't shown.` });
      continue;
    }
    node.file = inSpec(file.path);
    node.oid = file.oid ?? null;
    if (file.text === null && file.truncated !== true) {
      // Listed, not read yet: it shows under its file's name until its contents arrive.
      node.loaded = false;
      continue;
    }
    const read = readItem(file);
    if ("error" in read) {
      node.error = read.error;
      problems.push({ file: node.file, message: read.error });
    } else {
      node.item = read.item;
      node.title = read.item.title;
    }
  }

  const allLoaded = [...nodes.values()].every((node) => node.loaded);
  // Requirement ids are unique in the whole spec. Items are visited by file
  // path, so of two with the same id the later file is the one at fault.
  const requirements: Spec["requirements"] = new Map();
  for (const node of nodes.values()) {
    for (const requirement of node.item?.requirements ?? []) {
      const taken = requirements.get(requirement.id);
      if (taken === undefined) requirements.set(requirement.id, { node, requirement });
      else if (node.file !== null) {
        const where = taken.node === node ? "more than once in this item" : `already in ${taken.node.file ?? taken.node.id}`;
        problems.push({ file: node.file, message: `Requirement id ${requirement.id} is ${where}. Ids are unique in the whole spec.` });
      }
    }
  }

  for (const node of nodes.values()) {
    node.children.sort((a, b) => {
      const byOrder = (a.item?.order ?? Infinity) - (b.item?.order ?? Infinity);
      // Infinity - Infinity is NaN: neither has an order.
      return byOrder < 0 ? -1 : byOrder > 0 ? 1 : a.title.localeCompare(b.title);
    });
    const { item, file } = node;
    if (item === null || file === null) continue;
    for (const figure of item.figures ?? []) {
      if (!assets.has(figure.src)) problems.push({ file, message: `Figure ${figure.src} isn't in ${SPEC_DIR}.` });
    }
    // Deprecated things stay, with the reason: a status and its record go together.
    const records = [
      { what: "The item", status: item.status, deprecation: item.deprecation },
      ...(item.requirements ?? []).map((r) => ({ what: `Requirement ${r.id}`, status: r.status, deprecation: r.deprecation })),
    ];
    for (const { what, status, deprecation } of records) {
      if (status === "deprecated" && deprecation === undefined) {
        problems.push({ file, message: `${what} is deprecated without saying why. Add "deprecation": { "reason": "..." }.` });
      } else if (status !== "deprecated" && deprecation !== undefined) {
        problems.push({ file, message: `${what} has a deprecation, but its status isn't "deprecated".` });
      }
      for (const ref of deprecation?.replacedBy ?? []) {
        const { id, requirement } = splitSpecRef(ref);
        if (requirement !== null && id === "" ? !allLoaded : nodes.get(id)?.loaded === false) continue;
        if (resolveSpecRef({ nodes, requirements }, ref) === null) problems.push({ file, message: `${what} is replaced by "${ref}", which isn't in the spec.` });
      }
    }
    for (const ref of item.related ?? []) {
      // Whether an item that isn't loaded has the requirement can't be said yet;
      // nor, while any item is unread, where a requirement named by its id alone is.
      const { id, requirement } = splitSpecRef(ref);
      if (requirement !== null && id === "" ? !allLoaded : nodes.get(id)?.loaded === false) continue;
      if (resolveSpecRef({ nodes, requirements }, ref) === null) problems.push({ file, message: `Nothing in the spec is called "${ref}".` });
    }
  }

  return { root, nodes, requirements, assets, problems };
}

/**
 * What a `related` entry points at; null when it leads nowhere. A requirement
 * can be named by its id alone ("#RET-1"), which still finds it after it
 * moves to another item, or together with its item ("uploads/retries#RET-1").
 */
export function resolveSpecRef(spec: Pick<Spec, "nodes" | "requirements">, ref: string): { node: SpecNode; requirement: SpecRequirement | null } | null {
  const { id, requirement: requirementId } = splitSpecRef(ref);
  if (requirementId !== null && id === "") return spec.requirements.get(requirementId) ?? null;
  const node = spec.nodes.get(id);
  if (!node) return null;
  if (requirementId === null) return { node, requirement: null };
  const requirement = node.item?.requirements?.find((r) => r.id === requirementId);
  return requirement ? { node, requirement } : null;
}

/** The root's children down to `node`, without the root itself. */
export function specTrail(node: SpecNode): SpecNode[] {
  const trail: SpecNode[] = [];
  for (let at: SpecNode | null = node; at !== null && at.id !== ""; at = at.parent) trail.unshift(at);
  return trail;
}

/** A requirement's status: its own, or its item's. Everything in a deprecated item is deprecated. */
export function requirementStatus(item: SpecItem | null | undefined, requirement: SpecRequirement): SpecStatus | undefined {
  return item?.status === "deprecated" ? "deprecated" : (requirement.status ?? item?.status);
}

export interface SpecCounts {
  /** Items below (not counting the node itself). */
  items: number;
  /** Requirements of the node and everything below it. */
  requirements: number;
  /** How many of those are implemented. */
  implemented: number;
  /** Deprecated requirements: kept for the record, not counted among the requirements. */
  deprecated: number;
  /** Items below (and the node itself) whose contents aren't loaded: their requirements aren't counted yet. */
  unloaded: number;
}

export function specCounts(node: SpecNode): SpecCounts {
  const counts: SpecCounts = { items: 0, requirements: 0, implemented: 0, deprecated: 0, unloaded: 0 };
  const visit = (at: SpecNode) => {
    if (!at.loaded) counts.unloaded++;
    for (const requirement of at.item?.requirements ?? []) {
      const status = requirementStatus(at.item, requirement);
      if (status === "deprecated") counts.deprecated++;
      else counts.requirements++;
      if (status === "implemented") counts.implemented++;
    }
    for (const child of at.children) {
      if (child.file !== null) counts.items++;
      visit(child);
    }
  };
  visit(node);
  return counts;
}

export interface SpecMatch {
  node: SpecNode;
  /** The requirements that match; empty when the item itself does. */
  requirements: SpecRequirement[];
}

/** Items whose title, summary, description or requirements contain every word of `query`. */
export function searchSpec(spec: Spec, query: string): SpecMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [];
  const has = (text: string) => {
    const lower = text.toLowerCase();
    return words.every((word) => lower.includes(word));
  };
  const matches: SpecMatch[] = [];
  const visit = (node: SpecNode) => {
    const item = node.item;
    const requirements = (item?.requirements ?? []).filter((r) => has(`${r.id} ${r.text} ${r.deprecation?.reason ?? ""}`));
    const own = has([node.id, node.title, item?.summary ?? "", item?.description ?? "", ...(item?.questions ?? [])].join("\n"));
    if (node.id !== "" && (own || requirements.length > 0)) matches.push({ node, requirements: own ? [] : requirements });
    node.children.forEach(visit);
  };
  visit(spec.root);
  return matches;
}

// -------------------------------------------------------------------- text

export type SpecTextBlock = { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };

/** Splits text into paragraphs and "- " lists. A list can follow its paragraph without a blank line. */
export function specTextBlocks(text: string): SpecTextBlock[] {
  const blocks: SpecTextBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    if (list.length > 0) blocks.push({ kind: "list", items: list });
    paragraph = [];
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") flush();
    else if (line.startsWith("- ")) list.push(line.slice(2));
    else {
      // Text after a list starts a new paragraph.
      if (list.length > 0) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** Whether a `code` entry is a pattern rather than one path. */
export const isSpecPattern = (path: string) => path.includes("*");

/** The files a node needs to show properly: its own, its children's, and those of the folders above it. */
export function specFilesAround(node: SpecNode): SpecNode[] {
  return [...specTrail(node), ...node.children, ...(node.id === "" ? [node] : [])];
}

/** Every item below `node` (and itself) that isn't loaded. */
export function unloadedBelow(node: SpecNode): SpecNode[] {
  const found: SpecNode[] = [];
  const visit = (at: SpecNode) => {
    if (!at.loaded) found.push(at);
    at.children.forEach(visit);
  };
  visit(node);
  return found;
}
