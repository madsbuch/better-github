// A spec: a `.spec` folder at the root of a repository says what its code is
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
// Spec: S1, S3, S4, S10, S15, S16, S19, S21, S22, S23, S24, S25, S26, S28, S30

import { z } from "zod";

/** At the root of the repository. */
export const SPEC_DIR = ".spec";
export const SPEC_SCHEMA_URL = "https://raw.githubusercontent.com/madsbuch/better-github/main/schema/spec.schema.json";

// ------------------------------------------------------------------ schema

/**
 * The one thing a spec says about where something stands: it was dropped.
 * Whatever has a \`deprecation\` is deprecated; everything else is the spec.
 * There is nothing for "draft", "accepted" or "built": planning lives where
 * the product is managed, and whether something is built is found out by
 * comparing the product with the spec.
 */
export type SpecStatus = "deprecated";

/** "deprecated" for what carries the record of being dropped. */
export function specStatus(entry: { deprecation?: unknown } | null | undefined): SpecStatus | undefined {
  return entry?.deprecation !== undefined ? "deprecated" : undefined;
}

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
    'Marks what was dropped from the spec. A requirement, story, value or item that is no longer wanted is not deleted from its file: it stays, with this record, so it stays known that it existed, that it was dropped, and why. It is never deleted, and its id is never used again.',
  );
export type SpecDeprecation = z.infer<typeof SpecDeprecation>;

/** Pointers from one entry to others it touches. They say nothing more than that: a change to one may matter to the other. */
const Related = z
  .array(z.string().min(1))
  .optional()
  .describe('What else in the spec this touches: requirements, stories or values ("#LIM-2"), or items ("uploads/limits"). A change here may matter there. Written at one end; it holds from both.');

export const SpecRequirementVersion = z
  .strictObject({
    version: z.number().int().min(1).describe("Which version this was: 1 for the first."),
    text: Text.min(1).describe("What the requirement said in this version."),
    level: SpecLevel.optional().describe("How binding it was in this version. Defaults to must."),
    reason: Text.min(1).describe("Why this version was replaced by the next one."),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("When it was replaced, as YYYY-MM-DD."),
  })
  .describe("An earlier version of a requirement: what it said, and why that changed.");
export type SpecRequirementVersion = z.infer<typeof SpecRequirementVersion>;

export const SpecRequirement = z
  .strictObject({
    id: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      .describe(
        'Unique in the whole spec, not just in its item, and stable once written: everything that refers to it does so by this id alone. A prefix per item ("RET-1", "RET-2") keeps ids apart.',
      ),
    text: Text.min(1).describe("One statement that can be checked against the product."),
    level: SpecLevel.optional(),
    version: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Which version of the requirement this is. Defaults to 1. It goes up by one each time what the requirement means changes; the id stays."),
    history: z
      .array(SpecRequirementVersion)
      .optional()
      .describe("Every earlier version, oldest first, each with why it was replaced. A requirement at version 3 has the history of versions 1 and 2."),
    related: Related,
    deprecation: SpecDeprecation.optional(),
  })
  .describe("A single testable statement.");
export type SpecRequirement = z.infer<typeof SpecRequirement>;

export const SpecStory = z
  .strictObject({
    id: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      .describe('Unique in the whole spec, among user stories and requirements alike, and stable once written. A prefix such as "US-" keeps stories apart from requirements.'),
    as: z.string().min(1).describe('Who wants it, as the words after "As": "a commuter uploading on a train".'),
    want: z.string().min(1).describe('What they want to do, as the words after "I want": "to send a file without watching it".'),
    soThat: z.string().min(1).optional().describe('What it is for, as the words after "so that": "I can put the phone away".'),
    requirements: z
      .array(z.string().min(1))
      .optional()
      .describe('The requirements that together make this story true, by id: "#RET-1". They can be in any item.'),
    related: Related,
    deprecation: SpecDeprecation.optional(),
  })
  .describe("A user story: who wants what, and why. It says what the product is for; requirements say what it must do to deliver that.");
export type SpecStory = z.infer<typeof SpecStory>;

/** A story as the sentence it is: "As a commuter, I want to send a file, so that I can put the phone away." */
export function storySentence(story: SpecStory): string {
  return `As ${story.as}, I want ${story.want}${story.soThat !== undefined ? `, so that ${story.soThat}` : ""}.`;
}

const valueId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .describe('Unique in the whole spec, among values, user stories and requirements alike, and stable once written. Dotted names group them: "color.accent", "retry.max".');

const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const DIMENSION_UNITS = ["px", "rem", "em", "%", "pt", "dp", "vw", "vh"] as const;
export const DURATION_UNITS = ["ms", "s", "min", "h", "d"] as const;
const DIMENSION = new RegExp(`^-?\\d+(?:\\.\\d+)?(?:${DIMENSION_UNITS.join("|")})$`);
const DURATION = new RegExp(`^\\d+(?:\\.\\d+)?(?:${DURATION_UNITS.join("|")})$`);

export const SpecValueChange = z
  .strictObject({
    value: z.union([z.string(), z.number(), z.array(z.string())]).describe("What the value was."),
    dark: z.string().optional().describe("A color's value in dark mode then, if it had one."),
    reason: Text.min(1).describe("Why it was replaced by the next one."),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("When it was replaced, as YYYY-MM-DD."),
  })
  .describe("What a named value used to be, and why that changed.");
export type SpecValueChange = z.infer<typeof SpecValueChange>;

const valueCommon = {
  id: valueId,
  description: z.string().optional().describe("What it is for, in a line."),
  related: Related,
  deprecation: SpecDeprecation.optional(),
  history: z.array(SpecValueChange).optional().describe("Everything it was before, oldest first, each with why it changed."),
};

export const SpecValue = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...valueCommon,
      type: z.literal("color"),
      value: z.string().regex(HEX_COLOR).describe('As hex: "#0969da", or "#0969da80" with transparency.'),
      dark: z.string().regex(HEX_COLOR).optional().describe("The color in dark mode, when it differs."),
    }),
    z.strictObject({ ...valueCommon, type: z.literal("dimension"), value: z.string().regex(DIMENSION).describe('A size with its unit: "16px", "1.5rem", "50%".') }),
    z.strictObject({ ...valueCommon, type: z.literal("duration"), value: z.string().regex(DURATION).describe('A length of time with its unit: "200ms", "30s", "14d".') }),
    z.strictObject({
      ...valueCommon,
      type: z.literal("number"),
      value: z.number(),
      unit: z.string().min(1).optional().describe('What is counted, for reading: "times", "MB", "items".'),
    }),
    z.strictObject({ ...valueCommon, type: z.literal("text"), value: z.string().describe("Wording: a name, a label, a message.") }),
    z.strictObject({ ...valueCommon, type: z.literal("font"), value: z.string().min(1).describe('A font family, or a stack of them: "Inter, system-ui, sans-serif".') }),
    z.strictObject({ ...valueCommon, type: z.literal("list"), value: z.array(z.string().min(1)).describe("A fixed set of names: roles, states, file types.") }),
  ])
  .describe(
    "A named value: something the product decides once and uses in many places, such as a color, a size, a limit, a timeout or a piece of wording. Requirements refer to it by its id in backticks instead of repeating the value.",
  );
export type SpecValue = z.infer<typeof SpecValue>;
export const SPEC_VALUE_TYPES = ["color", "dimension", "duration", "number", "text", "font", "list"] as const;
export type SpecValueType = SpecValue["type"];

/** A value as it is read: "#0969da", "5 times", "admin, member, guest". */
export function valueText(value: Pick<SpecValue, "value"> & { unit?: string | undefined }): string {
  if (Array.isArray(value.value)) return value.value.join(", ");
  return `${value.value}${value.unit !== undefined ? ` ${value.unit}` : ""}`;
}

export const SpecFigure = z
  .strictObject({
    src: RepoPath.describe('An image in the spec folder, as a path from that folder: "assets/retry-timeline.png".'),
    alt: z.string().optional().describe("What the image shows, for when it can't be seen."),
    caption: z.string().optional(),
  })
  .describe("A picture: a mockup, a diagram, a screenshot.");
export type SpecFigure = z.infer<typeof SpecFigure>;

const GitId = z.string().regex(/^[0-9a-f]{40}$/, "is a git object id: 40 hexadecimal digits");

export const SpecImport = z
  .strictObject({
    at: z
      .string()
      .regex(/^[^/.](?:.*[^/])?$/, "is a folder of the spec, without a leading or trailing slash")
      .describe('The folder the part fills, the same as in the spec it comes from: "sync" for .spec/sync.'),
    from: z.string().min(1).describe('The repository it comes from: "owner/repo".'),
    commit: GitId.describe("The commit it was copied from."),
    tree: GitId.describe("Git's id for the folder at that commit. The copy has the same id as long as nobody edits it."),
    order: z.number().optional().describe("Where the part sits among its siblings in this spec, in place of its own order."),
    values: z
      .array(
        z.strictObject({
          id: z.string().min(1).describe("A named value of the imported part."),
          value: z.union([z.string(), z.number(), z.array(z.string())]).describe("What it is in this product."),
          dark: z.string().optional().describe("For a color: what it is in dark mode in this product."),
          reason: z.string().min(1).describe("Why this product sets it differently."),
        }),
      )
      .optional()
      .describe("Named values of the part that this product sets differently."),
    waived: z
      .array(
        z.strictObject({
          ref: z.string().min(1).describe('A requirement or story of the part ("#SYN-17"), or a part of it ("sync/snapshots").'),
          reason: z.string().min(1).describe("Why it doesn't hold in this product."),
        }),
      )
      .optional()
      .describe("What of the part doesn't hold in this product."),
  })
  .describe("A part copied from a shared spec in another repository. The copy isn't edited; what this product does differently is recorded here.");
export type SpecImport = z.infer<typeof SpecImport>;

export const SpecItem = z
  .strictObject({
    $schema: z.string().optional().describe("Where this schema lives, so editors can check the file."),
    title: z.string().min(1),
    summary: z.string().optional().describe("One line, shown wherever the item is listed."),
    deprecation: SpecDeprecation.optional(),
    order: z.number().optional().describe("Position among its siblings, lowest first. Items without one come last, by title."),
    description: Text.optional().describe("What this part does and why."),
    stories: z.array(SpecStory).optional().describe("The user stories this part serves."),
    requirements: z.array(SpecRequirement).optional(),
    values: z.array(SpecValue).optional().describe("The named values this part defines."),
    figures: z.array(SpecFigure).optional(),
    related: z
      .array(z.string().min(1))
      .optional()
      .describe('Ids of other items ("uploads/limits"), or requirements: "#LIM-2" wherever it is, or "uploads/limits#LIM-2". "#LIM-2@1" names one version.'),
    imports: z.array(SpecImport).optional().describe("Only on the root item: the parts of this spec copied from a shared spec in another repository."),
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
  /** Every user story by its id, with the item it is in. Stories and requirements share one set of ids. */
  stories: Map<string, { node: SpecNode; story: SpecStory }>;
  /** Every named value by its id, with the item it is in. Values share the one set of ids too. */
  values: Map<string, { node: SpecNode; value: SpecValue }>;
  /**
   * What touches what, from both ends: an entry ("#RET-1") or a part
   * ("uploads/retries") to everything it is related to, whichever of the two
   * says so. A story and the requirements that make it true are related too.
   */
  relations: Map<string, string[]>;
  /** Everything that isn't an item, by its path from the spec folder, with its git object id when known. */
  assets: Map<string, string | null>;
  problems: SpecProblem[];
}

const inSpec = (path: string) => `${SPEC_DIR}/${path}`;

/** `notes`: what is wrong with a file that could still be read. */
type ReadItem = { item: SpecItem; notes: string[] } | { error: string };

/**
 * Items used to list the files that implement them, as `code`. References to
 * code are not part of the format (a spec can specify internals, but does so
 * in its requirements). A file that still has the list is read without it, and says so.
 */
const LEGACY_CODE = "`code` is no longer part of the format: a spec has no list of code references. Remove it.";

/**
 * Items used to hold open questions. What isn't decided is tracked where the
 * product is managed, not in the spec, which says what was decided.
 */
const LEGACY_QUESTIONS = "`questions` is no longer part of the format: open questions belong with product management, not in the spec. Remove them.";

/**
 * Items, requirements, stories and values used to have a \`status\`: draft,
 * accepted, deprecated, and once implemented. A spec doesn't track planning or
 * what is built, and what is dropped says so with its \`deprecation\`. A file
 * that still has statuses is read without them, and says so.
 */
const LEGACY_STATUS = "`status` is no longer part of the format: what is in a spec is what the product is to do, and what was dropped has a `deprecation`. Remove it.";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const ENTRY_LISTS = ["requirements", "stories", "values"] as const;

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
  const notes: string[] = [];
  if (isRecord(value) && "code" in value) {
    const { code: _code, ...rest } = value;
    value = rest;
    notes.push(LEGACY_CODE);
  }
  if (isRecord(value) && "questions" in value) {
    const { questions: _questions, ...rest } = value;
    value = rest;
    notes.push(LEGACY_QUESTIONS);
  }
  const dropped: string[] = [];
  if (isRecord(value)) {
    // Statuses go; one that said "deprecated" without the record is pointed out, since nothing says so now.
    const seen = { status: false };
    const strip = (entry: unknown, what: string): unknown => {
      if (!isRecord(entry) || !("status" in entry)) return entry;
      seen.status = true;
      const { status, ...rest } = entry;
      if (status === "deprecated" && rest.deprecation === undefined) dropped.push(what);
      return rest;
    };
    const own = strip(value, "The item");
    const next: Record<string, unknown> = isRecord(own) ? { ...own } : {};
    for (const list of ENTRY_LISTS) {
      const entries: unknown = next[list];
      if (!Array.isArray(entries)) continue;
      const label = list === "requirements" ? "Requirement" : list === "stories" ? "User story" : "Value";
      next[list] = entries.map((entry: unknown) => strip(entry, `${label} ${isRecord(entry) && typeof entry.id === "string" ? entry.id : "?"}`));
    }
    value = next;
    if (seen.status) notes.push(LEGACY_STATUS);
    for (const what of dropped) notes.push(`${what} was marked deprecated without saying why. Add "deprecation": { "reason": "..." }.`);
  }
  const result = SpecItem.safeParse(value);
  if (result.success) return { item: result.data, notes };
  const issues = result.error.issues.map((issue) => {
    const at = issue.path.map((part) => part.toString()).join(".");
    return at !== "" ? `${at}: ${issue.message}` : issue.message;
  });
  return { error: issues.join("; ") };
}

/** Splits "uploads/limits#R2" into the item's id and the requirement's. */
export function splitSpecRef(ref: string): { id: string; requirement: string | null; version: number | null } {
  const hash = ref.indexOf("#");
  if (hash === -1) return { id: ref, requirement: null, version: null };
  // "#RET-1@2" names one version of the requirement.
  const [, requirement = "", version] = /^(.*?)(?:@(\d+))?$/.exec(ref.slice(hash + 1)) ?? [];
  return { id: ref.slice(0, hash), requirement, version: version === undefined ? null : Number(version) };
}

/**
 * Builds the outline from the spec folder's files. Files that can't be read
 * and references that lead nowhere become problems; the rest still shows.
 * `folders` holds git's id for each folder ("uploads"), when it is known,
 * to tell whether an imported part is still what was copied.
 */
export function buildSpec(files: SpecFile[], listingCutOff = false, folders?: ReadonlyMap<string, string>): Spec {
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
      for (const message of read.notes) problems.push({ file: node.file, message });
    }
  }

  const allLoaded = [...nodes.values()].every((node) => node.loaded);
  // Requirement ids are unique in the whole spec. Items are visited by file
  // path, so of two with the same id the later file is the one at fault.
  const requirements: Spec["requirements"] = new Map();
  const stories: Spec["stories"] = new Map();
  const values: Spec["values"] = new Map();
  const relations: Spec["relations"] = new Map();
  for (const node of nodes.values()) {
    const entities = [
      ...(node.item?.stories ?? []).map((story) => ({ id: story.id, what: "User story", add: () => stories.set(story.id, { node, story }) })),
      ...(node.item?.requirements ?? []).map((requirement) => ({ id: requirement.id, what: "Requirement", add: () => requirements.set(requirement.id, { node, requirement }) })),
      ...(node.item?.values ?? []).map((value) => ({ id: value.id, what: "Value", add: () => values.set(value.id, { node, value }) })),
    ];
    for (const entity of entities) {
      // One set of ids for both: "#ID" always means one thing.
      const taken = requirements.get(entity.id) ?? stories.get(entity.id) ?? values.get(entity.id);
      if (taken === undefined) entity.add();
      else if (node.file !== null) {
        const where = taken.node === node ? "more than once in this item" : `already in ${taken.node.file ?? taken.node.id}`;
        problems.push({ file: node.file, message: `${entity.what} id ${entity.id} is ${where}. Ids are unique in the whole spec.` });
      }
    }
  }

  // An imported part can be placed differently in this spec than in its own.
  const placed = new Map((root.item?.imports ?? []).flatMap((entry) => (entry.order === undefined ? [] : [[entry.at, entry.order] as const])));
  const orderOf = (node: SpecNode) => placed.get(node.id) ?? node.item?.order ?? Infinity;
  for (const node of nodes.values()) {
    node.children.sort((a, b) => {
      const byOrder = orderOf(a) - orderOf(b);
      // Infinity - Infinity is NaN: neither has an order.
      return byOrder < 0 ? -1 : byOrder > 0 ? 1 : a.title.localeCompare(b.title);
    });
    const { item, file } = node;
    if (item === null || file === null) continue;
    for (const figure of item.figures ?? []) {
      if (!assets.has(figure.src)) problems.push({ file, message: `Figure ${figure.src} isn't in ${SPEC_DIR}.` });
    }
    // A requirement's version and its history go together: version 3 has the record of versions 1 and 2.
    for (const requirement of item.requirements ?? []) {
      const history = requirement.history ?? [];
      const version = requirementVersion(requirement);
      if (history.some((earlier, index) => earlier.version !== index + 1)) {
        problems.push({ file, message: `Requirement ${requirement.id}'s history isn't in order: its versions run 1, 2, 3, oldest first.` });
      } else if (version !== history.length + 1) {
        const missing = version > history.length + 1;
        problems.push({
          file,
          message: missing
            ? `Requirement ${requirement.id} is at version ${version}, but its history has ${history.length === 0 ? "no earlier versions" : `only ${history.length}`}. Add what each earlier version said, and why it changed.`
            : `Requirement ${requirement.id} has a history of ${history.length} earlier version${history.length === 1 ? "" : "s"}, so it is at version ${history.length + 1}, not ${version}.`,
        });
      }
    }
    // A story names the requirements that make it true; each has to be one.
    for (const story of item.stories ?? []) {
      for (const ref of story.requirements ?? []) {
        const { id, requirement } = splitSpecRef(ref);
        if (requirement !== null && id === "" ? !allLoaded : nodes.get(id)?.loaded === false) continue;
        const made = resolveSpecRef({ nodes, requirements, stories, values }, ref);
        if ((made?.requirement ?? null) === null) {
          problems.push({ file, message: `User story ${story.id} names "${ref}", which isn't a requirement in the spec.` });
        } else if (made !== null && requirementStatus(item, story) === undefined && requirementStatus(made.node.item, made.requirement ?? {}) !== undefined) {
          // What can be checked without judgment: a story that is still wanted can't rest on something that was dropped.
          problems.push({ file, message: `User story ${story.id} is made true by ${made.requirement?.id ?? ref}, which is deprecated.` });
        }
      }
    }
    const records = [
      { what: "The item", deprecation: item.deprecation },
      ...(item.stories ?? []).map((story) => ({ what: `User story ${story.id}`, deprecation: story.deprecation })),
      ...(item.requirements ?? []).map((r) => ({ what: `Requirement ${r.id}`, deprecation: r.deprecation })),
      ...(item.values ?? []).map((v) => ({ what: `Value ${v.id}`, deprecation: v.deprecation })),
    ];
    for (const { what, deprecation } of records) {
      for (const ref of deprecation?.replacedBy ?? []) {
        const { id, requirement } = splitSpecRef(ref);
        if (requirement !== null && id === "" ? !allLoaded : nodes.get(id)?.loaded === false) continue;
        if (resolveSpecRef({ nodes, requirements, stories, values }, ref) === null) problems.push({ file, message: `${what} is replaced by "${ref}", which isn't in the spec.` });
      }
    }
    const pointers = [
      { from: node.id, what: null, refs: item.related ?? [] },
      ...(item.requirements ?? []).map((r) => ({ from: `#${r.id}`, what: `Requirement ${r.id}`, refs: r.related ?? [] })),
      ...(item.stories ?? []).map((story) => ({ from: `#${story.id}`, what: `User story ${story.id}`, refs: [...(story.related ?? []), ...(story.requirements ?? [])] })),
      ...(item.values ?? []).map((v) => ({ from: `#${v.id}`, what: `Value ${v.id}`, refs: v.related ?? [] })),
    ];
    for (const { from, what, refs } of pointers) {
      for (const ref of refs) {
        // Whether an item that isn't loaded has the requirement can't be said yet;
        // nor, while any item is unread, where a requirement named by its id alone is.
        const { id, requirement } = splitSpecRef(ref);
        if (requirement !== null && id === "" ? !allLoaded : nodes.get(id)?.loaded === false) continue;
        const target = resolveSpecRef({ nodes, requirements, stories, values }, ref);
        if (target === null) {
          // A story's requirements are checked above, with their own message.
          if (what === null) problems.push({ file, message: `Nothing in the spec is called "${ref}".` });
          else if (!(item.stories ?? []).some((story) => `#${story.id}` === from && (story.requirements ?? []).includes(ref))) {
            problems.push({ file, message: `${what} is related to "${ref}", which isn't in the spec.` });
          }
          continue;
        }
        const to = specKey(target);
        if (to === from) continue;
        // It holds from both ends, whichever says so.
        for (const [a, b] of [[from, to], [to, from]] as const) {
          const known = relations.get(a);
          if (known === undefined) relations.set(a, [b]);
          else if (!known.includes(b)) known.push(b);
        }
      }
    }
  }

  problems.push(...importProblems({ root, nodes, requirements, stories, values }, allLoaded, folders));
  return { root, nodes, requirements, stories, values, relations, assets, problems };
}

/**
 * What is wrong with the parts copied from shared specs: a copy edited by
 * hand, and a value or waiver that isn't in the part it is about.
 */
// Spec: S39, S40, S41
function importProblems(spec: Pick<Spec, "root" | "nodes" | "requirements" | "stories" | "values">, allLoaded: boolean, folders: ReadonlyMap<string, string> | undefined): SpecProblem[] {
  const problems: SpecProblem[] = [];
  for (const node of spec.nodes.values()) {
    if (node.id !== "" && node.file !== null && node.item?.imports !== undefined) {
      problems.push({ file: node.file, message: "Only the root item lists imports. These are left out." });
    }
  }
  const file = spec.root.file;
  const imports = spec.root.item?.imports ?? [];
  if (file === null) return problems;
  const seen = new Set<string>();
  for (const entry of imports) {
    const { at, from } = entry;
    const where = `${SPEC_DIR}/${at}`;
    if (seen.has(at)) {
      problems.push({ file, message: `${where} is imported twice.` });
      continue;
    }
    seen.add(at);
    const outer = imports.find((other) => other !== entry && at.startsWith(`${other.at}/`));
    if (outer !== undefined) problems.push({ file, message: `${where} is inside ${SPEC_DIR}/${outer.at}, which is imported already.` });
    if (spec.nodes.get(at) === undefined) {
      problems.push({ file, message: `${where} is imported from ${from}, but the spec has no such folder.` });
      continue;
    }
    const copied = folders?.get(at);
    if (copied !== undefined && copied !== entry.tree) {
      problems.push({ file, message: `${where} isn't what was copied from ${from} at ${entry.commit.slice(0, 7)}: it was edited here. Change it in ${from} and import it again.` });
    }
    const inPart = (node: SpecNode) => node.id === at || node.id.startsWith(`${at}/`);
    for (const set of entry.values ?? []) {
      if (!allLoaded) break;
      const found = spec.values.get(set.id);
      if (found === undefined || !inPart(found.node)) {
        problems.push({ file, message: `${where} sets ${set.id}, which isn't a named value of it.` });
        continue;
      }
      // What it would be with this product's setting: the shared value's type, this value.
      const asSet = SpecValue.safeParse({ id: set.id, type: found.value.type, value: set.value, ...(set.dark === undefined ? {} : { dark: set.dark }) });
      if (!asSet.success) problems.push({ file, message: `${where} sets ${set.id} to ${JSON.stringify(set.value)}, which a ${found.value.type} can't be.` });
    }
    for (const { ref } of entry.waived ?? []) {
      const { id, requirement } = splitSpecRef(ref);
      if (requirement !== null && id === "" ? !allLoaded : spec.nodes.get(id)?.loaded === false) continue;
      const target = resolveSpecRef(spec, ref);
      if (target === null || !inPart(target.node) || (requirement !== null && target.requirement === null && target.story === null)) {
        problems.push({ file, message: `${where} waives "${ref}", which isn't a requirement, story or part of it.` });
      }
    }
  }
  return problems;
}

/** How something is named in `Spec.relations`: an entry by its id ("#RET-1"), a part by its path. */
export function specKey(target: { node: SpecNode; requirement: SpecRequirement | null; story: SpecStory | null; value: SpecValue | null }): string {
  const id = target.requirement?.id ?? target.story?.id ?? target.value?.id;
  return id !== undefined ? `#${id}` : target.node.id;
}

/** What an entry or a part is related to, from either end, in the order of their ids. */
export function relatedTo(spec: Spec, key: string): { key: string; node: SpecNode; requirement: SpecRequirement | null; story: SpecStory | null; value: SpecValue | null }[] {
  return (spec.relations.get(key) ?? [])
    .flatMap((other) => {
      const target = resolveSpecRef(spec, other);
      return target === null ? [] : [{ key: other, ...target }];
    })
    .sort((a, b) => byId.compare(a.key, b.key));
}

/**
 * What a `related` entry points at; null when it leads nowhere. A requirement
 * can be named by its id alone ("#RET-1"), which still finds it after it
 * moves to another item, or together with its item ("uploads/retries#RET-1").
 */
export function resolveSpecRef(
  spec: Pick<Spec, "nodes" | "requirements" | "stories" | "values">,
  ref: string,
): { node: SpecNode; requirement: SpecRequirement | null; story: SpecStory | null; value: SpecValue | null } | null {
  const { id, requirement: entityId, version } = splitSpecRef(ref);
  const node = spec.nodes.get(id);
  if (entityId === null) return node ? { node, requirement: null, story: null, value: null } : null;
  const requirement = id === "" ? spec.requirements.get(entityId) : node && { node, requirement: node.item?.requirements?.find((r) => r.id === entityId) };
  if (requirement && requirement.requirement !== undefined) {
    // A version it hasn't reached doesn't exist.
    if (version !== null && (version < 1 || version > requirementVersion(requirement.requirement))) return null;
    return { node: requirement.node, requirement: requirement.requirement, story: null, value: null };
  }
  // The same kind of id can be a user story; those have no versions.
  const story = id === "" ? spec.stories.get(entityId) : node && { node, story: node.item?.stories?.find((candidate) => candidate.id === entityId) };
  if (version !== null) return null;
  if (story && story.story !== undefined) return { node: story.node, requirement: null, story: story.story, value: null };
  // Or a named value.
  const value = id === "" ? spec.values.get(entityId) : node && { node, value: node.item?.values?.find((candidate) => candidate.id === entityId) };
  if (!value || value.value === undefined) return null;
  return { node: value.node, requirement: null, story: null, value: value.value };
}

/** The root's children down to `node`, without the root itself. */
export function specTrail(node: SpecNode): SpecNode[] {
  const trail: SpecNode[] = [];
  for (let at: SpecNode | null = node; at !== null && at.id !== ""; at = at.parent) trail.unshift(at);
  return trail;
}

/** Which version a requirement is at: 1 unless it says otherwise. */
export const requirementVersion = (requirement: SpecRequirement) => requirement.version ?? 1;

/** Whether something in an item is deprecated: by its own record, or with its item. */
export function requirementStatus(item: SpecItem | null | undefined, entry: { deprecation?: unknown }): SpecStatus | undefined {
  return specStatus(item) ?? specStatus(entry);
}

export interface SpecCounts {
  /** Items below (not counting the node itself). */
  items: number;
  /** Requirements of the node and everything below it. */
  requirements: number;
  /** Deprecated requirements: kept for the record, not counted among the requirements. */
  deprecated: number;
  /** User stories of the node and everything below it, not counting deprecated ones. */
  stories: number;
  /** Named values of the node and everything below it, not counting deprecated ones. */
  values: number;
  /** Items below (and the node itself) whose contents aren't loaded: their requirements aren't counted yet. */
  unloaded: number;
}

export function specCounts(node: SpecNode): SpecCounts {
  const counts: SpecCounts = { items: 0, requirements: 0, deprecated: 0, stories: 0, values: 0, unloaded: 0 };
  const visit = (at: SpecNode) => {
    if (!at.loaded) counts.unloaded++;
    for (const story of at.item?.stories ?? []) {
      if (requirementStatus(at.item, story) !== "deprecated") counts.stories++;
    }
    for (const value of at.item?.values ?? []) {
      if (requirementStatus(at.item, value) !== "deprecated") counts.values++;
    }
    for (const requirement of at.item?.requirements ?? []) {
      const status = requirementStatus(at.item, requirement);
      if (status === "deprecated") counts.deprecated++;
      else counts.requirements++;
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
  /** The user stories that match; empty when the item itself does. */
  stories: SpecStory[];
  /** The requirements that match; empty when the item itself does. */
  requirements: SpecRequirement[];
  /** The named values that match; empty when the item itself does. */
  values: SpecValue[];
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
    // Also by what a requirement used to say, and why that changed or why it was dropped.
    const requirements = (item?.requirements ?? []).filter((r) =>
      has([r.id, r.text, r.deprecation?.reason ?? "", ...(r.history ?? []).flatMap((earlier) => [earlier.text, earlier.reason])].join("\n")),
    );
    const stories = (item?.stories ?? []).filter((story) => has([story.id, storySentence(story), story.deprecation?.reason ?? ""].join("\n")));
    const values = (item?.values ?? []).filter((v) => has([v.id, valueText(v), v.type === "color" ? (v.dark ?? "") : "", v.description ?? "", v.deprecation?.reason ?? "", ...(v.history ?? []).map((h) => h.reason)].join("\n")));
    const own = has([node.id, node.title, item?.summary ?? "", item?.description ?? ""].join("\n"));
    if (node.id !== "" && (own || requirements.length > 0 || stories.length > 0 || values.length > 0)) {
      matches.push({ node, stories: own ? [] : stories, requirements: own ? [] : requirements, values: own ? [] : values });
    }
    node.children.forEach(visit);
  };
  visit(spec.root);
  return matches;
}

// ------------------------------------------------------------------- index

export type SpecEntryKind = "part" | "story" | "requirement" | "value";

/** One thing in a spec that can be found: a part, or a story, requirement or value in one. */
export interface SpecEntry {
  kind: SpecEntryKind;
  /** The entry's own id ("RET-1", "color.accent"); a part's is its path ("uploads/retries"). */
  id: string;
  /** The part it is, or is in. */
  node: SpecNode;
  /** What it says, in a line. */
  text: string;
  /** Dropped from the spec, by its own record or with its part. */
  deprecated: boolean;
}

/** What to look through: everything, one kind of entry, or what was dropped. */
export const SPEC_FINDS = ["all", "requirements", "stories", "values", "deprecated"] as const;
export type SpecFind = (typeof SPEC_FINDS)[number];

/** Ids the way a person orders them: R2 before R10, and color.accent next to color.danger. */
const byId = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const valueLine = (value: SpecValue) => `${value.type === "text" ? `“${value.value}”` : valueText(value)}${value.description !== undefined ? `: ${value.description}` : ""}`;

interface Indexed extends SpecEntry {
  /** Everything else it can be found by: what it used to say, why it changed, why it was dropped. */
  more: string;
}

function entries(spec: Spec): Indexed[] {
  const found: Indexed[] = [];
  for (const node of spec.nodes.values()) {
    const item = node.item;
    if (node.id !== "") {
      found.push({ kind: "part", id: node.id, node, text: item?.summary ?? node.title, deprecated: specStatus(item) !== undefined, more: [node.title, item?.description ?? "", item?.deprecation?.reason ?? ""].join("\n") });
    }
    for (const story of item?.stories ?? []) {
      found.push({ kind: "story", id: story.id, node, text: storySentence(story), deprecated: requirementStatus(item, story) !== undefined, more: story.deprecation?.reason ?? "" });
    }
    for (const requirement of item?.requirements ?? []) {
      found.push({
        kind: "requirement",
        id: requirement.id,
        node,
        text: requirement.text,
        deprecated: requirementStatus(item, requirement) !== undefined,
        more: [requirement.deprecation?.reason ?? "", ...(requirement.history ?? []).flatMap((earlier) => [earlier.text, earlier.reason])].join("\n"),
      });
    }
    for (const value of item?.values ?? []) {
      found.push({
        kind: "value",
        id: value.id,
        node,
        text: valueLine(value),
        deprecated: requirementStatus(item, value) !== undefined,
        more: [value.type === "color" ? (value.dark ?? "") : "", value.deprecation?.reason ?? "", ...(value.history ?? []).map((earlier) => earlier.reason)].join("\n"),
      });
    }
  }
  return found;
}

const FIND_KIND: Record<Exclude<SpecFind, "all" | "deprecated">, SpecEntryKind> = { requirements: "requirement", stories: "story", values: "value" };

/** How many entries each way of looking holds, for the index's tabs. Parts aren't counted: the outline is their index. */
export function specFindCounts(spec: Spec): Record<Exclude<SpecFind, "all">, number> {
  const counts = { requirements: 0, stories: 0, values: 0, deprecated: 0 };
  for (const entry of entries(spec)) {
    if (entry.deprecated) counts.deprecated++;
    else if (entry.kind === "requirement") counts.requirements++;
    else if (entry.kind === "story") counts.stories++;
    else if (entry.kind === "value") counts.values++;
  }
  return counts;
}

/**
 * The index of a spec, and the search over it. Without a query: every entry of
 * one kind in the order of its id (nothing for "all", which is the outline's).
 * With one: what contains every word, best first: the entry whose id it is,
 * ids that start with or contain it, then what an entry says, then what it
 * used to say and why it changed or was dropped. One kind holds only what is
 * still in the spec; "deprecated" holds what was dropped, of any kind; "all"
 * holds both, so a search shows when an idea was dropped before.
 */
export function findInSpec(spec: Spec, query: string, within: SpecFind): SpecEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0 && within === "all") return [];
  const whole = words.join(" ");
  const has = (text: string) => {
    const lower = text.toLowerCase();
    return words.every((word) => lower.includes(word));
  };
  const ranked: { entry: SpecEntry; rank: number }[] = [];
  for (const { more, ...entry } of entries(spec)) {
    if (within === "deprecated" ? !entry.deprecated : within !== "all" && (entry.kind !== FIND_KIND[within] || entry.deprecated)) continue;
    // In the index of what was dropped, a part stands for everything in it.
    if (within === "deprecated" && entry.kind !== "part" && specStatus(entry.node.item) !== undefined) continue;
    if (words.length === 0) {
      ranked.push({ entry, rank: 0 });
      continue;
    }
    const id = entry.id.toLowerCase();
    const title = entry.kind === "part" ? entry.node.title.toLowerCase() : "";
    const rank = id === whole || title === whole ? 0 : id.startsWith(whole) ? 1 : id.includes(whole) || (title !== "" && has(title)) ? 2 : has(entry.text) ? 3 : has(`${entry.id}\n${entry.text}\n${more}`) ? 4 : -1;
    if (rank !== -1) ranked.push({ entry, rank });
  }
  return ranked.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : byId.compare(a.entry.id, b.entry.id))).map(({ entry }) => entry);
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
