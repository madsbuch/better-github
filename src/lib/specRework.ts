// Reworking a spec in the app: revising, deprecating and adding requirements
// and items while reading it. Nothing here writes to the repository. The
// changes are a draft kept on the device, laid over the spec that was read;
// what goes out is a handover for a coding agent (specReworkPrompt), which
// makes the change to the spec and to the code in one pull request.
//
// A draft holds whole items as they should become, by item id. Every edit
// below is made from the item as the repository has it, not from an earlier
// edit, so revising a requirement twice still gives one new version.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import { parseJson } from "./schema";
import {
  buildSpec,
  requirementStatus,
  requirementVersion,
  SPEC_DIR,
  SPEC_SCHEMA_URL,
  SpecItem,
  specTrail,
  storySentence,
  type Spec,
  type SpecFile,
  type SpecLevel,
  type SpecNode,
  type SpecRequirement,
  type SpecStatus,
  type SpecStory,
} from "./spec.ts";
import type { ItemChange, RequirementChange, SpecDiff } from "./specDiff";

// -------------------------------------------------------------------- edits

/** Today as YYYY-MM-DD, for the records edits leave. */
export const today = () => new Date().toISOString().slice(0, 10);

export interface Revision {
  text: string;
  level: SpecLevel;
  /**
   * Why what it means changed: makes this a new version. Null for a wording
   * fix that changes nothing about what is promised.
   */
  reason: string | null;
}

/**
 * A requirement as revised. With a reason it becomes a new version: what it
 * said goes into its history, with the reason.
 */
export function reviseRequirement(original: SpecRequirement, revision: Revision, date = today()): SpecRequirement {
  const { level: _level, ...rest } = original;
  const level = revision.level === "must" ? {} : { level: revision.level };
  if (revision.reason === null) return { ...rest, ...level, text: revision.text };
  const version = requirementVersion(original);
  const was = (original.level ?? "must") === "must" ? {} : { level: original.level };
  return {
    ...rest,
    ...level,
    text: revision.text,
    version: version + 1,
    history: [...(original.history ?? []), { version, text: original.text, ...was, reason: revision.reason, date }],
  };
}

/** A requirement as deprecated: it stays, with why. */
export function deprecateRequirement(original: SpecRequirement, reason: string, replacedBy: string[], date = today()): SpecRequirement {
  return { ...original, status: "deprecated", deprecation: { reason, ...(replacedBy.length > 0 ? { replacedBy } : {}), date } };
}

/** `item` with one requirement replaced (or, with null, taken out again: only for ones the draft added). */
export function withRequirement(item: SpecItem, id: string, requirement: SpecRequirement | null): SpecItem {
  const requirements = (item.requirements ?? []).flatMap((r) => (r.id === id ? (requirement === null ? [] : [requirement]) : [r]));
  return { ...item, requirements };
}

/** `item` with a new requirement at the end. */
export function withNewRequirement(item: SpecItem, requirement: { id: string; text: string; level: SpecLevel }): SpecItem {
  const added: SpecRequirement = {
    id: requirement.id,
    text: requirement.text,
    ...(requirement.level === "must" ? {} : { level: requirement.level }),
  };
  return { ...item, requirements: [...(item.requirements ?? []), added] };
}

/** `item` with one user story replaced, added (when it has none with that id) or, with null, taken out again. */
export function withStory(item: SpecItem, id: string, story: SpecStory | null): SpecItem {
  const stories = item.stories ?? [];
  const has = stories.some((candidate) => candidate.id === id);
  const next = has ? stories.flatMap((candidate) => (candidate.id === id ? (story === null ? [] : [story]) : [candidate])) : story === null ? stories : [...stories, story];
  // Before the requirements: who it is for comes first.
  const { stories: _stories, ...rest } = item;
  return next.length === 0 ? rest : { ...rest, stories: next };
}

/** A user story as deprecated: it stays, with why. */
export function deprecateStory(original: SpecStory, reason: string, date = today()): SpecStory {
  return { ...original, status: "deprecated", deprecation: { reason, date } };
}

/** An id for a new user story that nothing in the spec has: "US-1", "US-2", continuing the highest in use. */
export function suggestStoryId(spec: Spec): string {
  let next = 1;
  for (const id of spec.stories.keys()) {
    const match = /^US-(\d+)$/.exec(id);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  while (spec.stories.has(`US-${next}`) || spec.requirements.has(`US-${next}`)) next++;
  return `US-${next}`;
}

export interface ItemFields {
  title: string;
  summary: string;
  description: string;
  status: SpecStatus | undefined;
  /** Why, when the status is deprecated. */
  deprecationReason: string;
}

/** `item` with its own fields edited. Empty text removes the field. */
export function withFields(item: SpecItem, fields: ItemFields, date = today()): SpecItem {
  const { summary: _summary, description: _description, status: _status, deprecation, ...rest } = item;
  return {
    ...rest,
    title: fields.title,
    ...(fields.summary !== "" ? { summary: fields.summary } : {}),
    ...(fields.status !== undefined ? { status: fields.status } : {}),
    // The record of an earlier deprecation is kept as it is unless its reason changes.
    ...(fields.status === "deprecated"
      ? { deprecation: deprecation?.reason === fields.deprecationReason ? deprecation : { reason: fields.deprecationReason, date } }
      : {}),
    ...(fields.description !== "" ? { description: fields.description } : {}),
  };
}

/**
 * An id for a new requirement in `item` that nothing in the spec has: the
 * prefix its requirements share with the next number, or one made from the
 * item's name ("uploads/retries" gives "RET-1").
 */
export function suggestRequirementId(spec: Spec, node: SpecNode): string {
  const taken = (id: string) => spec.requirements.has(id);
  const numbered = (node.item?.requirements ?? []).flatMap((r) => {
    const match = /^(.*?)(\d+)$/.exec(r.id);
    return match ? [{ prefix: match[1] ?? "", number: Number(match[2]) }] : [];
  });
  const last = numbered.at(-1);
  let prefix = last?.prefix;
  let next = last === undefined ? 1 : Math.max(...numbered.filter((n) => n.prefix === last.prefix).map((n) => n.number)) + 1;
  if (prefix === undefined) {
    const letters = node.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
    prefix = `${letters !== "" ? letters : "REQ"}-`;
  }
  while (taken(`${prefix}${next}`)) next++;
  return `${prefix}${next}`;
}

/** An id for a new item under `parent`, from its title: "Resuming uploads" gives "uploads/resuming-uploads". */
export function newItemId(spec: Spec, parent: SpecNode, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = `${parent.id !== "" ? `${parent.id}/` : ""}${slug !== "" && slug !== "index" ? slug : "item"}`;
  let id = base;
  for (let n = 2; spec.nodes.has(id); n++) id = `${base}-${n}`;
  return id;
}

// -------------------------------------------------------------------- draft

export const SpecReworkDraft = z.object({
  /** Items as they should become, by id. Parsed one by one when used: a stored item that no longer fits the schema is dropped. */
  items: z.record(z.string(), z.unknown()),
  /** Anything else the agent should know. */
  note: z.string(),
  /** Whether the browser is showing the spec with these changes, and the means to make more. */
  active: z.boolean(),
});
export type SpecReworkDraft = z.infer<typeof SpecReworkDraft>;

const EMPTY: SpecReworkDraft = { items: {}, note: "", active: false };
const cache = new Map<string, SpecReworkDraft>();
const listeners = new Map<string, Set<() => void>>();
const storageKey = (key: string) => `ghc.spec-rework.${key}`;

function read(key: string): SpecReworkDraft {
  const cached = cache.get(key);
  if (cached) return cached;
  let draft = EMPTY;
  try {
    draft = parseJson(SpecReworkDraft, window.localStorage.getItem(storageKey(key))) ?? EMPTY;
  } catch {
    // Storage unavailable: start empty.
  }
  cache.set(key, draft);
  return draft;
}

function write(key: string, draft: SpecReworkDraft) {
  cache.set(key, draft);
  try {
    if (Object.keys(draft.items).length === 0 && draft.note === "" && !draft.active) window.localStorage.removeItem(storageKey(key));
    else window.localStorage.setItem(storageKey(key), JSON.stringify(draft));
  } catch {
    // Keep the in-memory copy.
  }
  listeners.get(key)?.forEach((listener) => listener());
}

/** The draft of changes to the spec of a repository on a branch. */
export function useSpecRework(owner: string, repo: string, ref: string) {
  const key = `${owner}/${repo}@${ref}`.toLowerCase();
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    [key],
  );
  const draft = useSyncExternalStore(subscribe, () => read(key));
  return useMemo(
    () => ({
      draft,
      setActive: (active: boolean) => write(key, { ...read(key), active }),
      setNote: (note: string) => write(key, { ...read(key), note }),
      /** Sets what an item should become; null takes its change back. */
      setItem: (id: string, item: SpecItem | null) => {
        const { [id]: _previous, ...others } = read(key).items;
        write(key, { ...read(key), items: item === null ? others : { ...others, [id]: item } });
      },
      discard: () => write(key, { ...EMPTY, active: read(key).active }),
    }),
    [draft, key],
  );
}
export type SpecRework = ReturnType<typeof useSpecRework>;

/** Keys in a fixed order, so the same item always reads the same. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === "object" && inner !== null && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b))) : inner,
  );

/** An item's file as the handover writes it: the schema first, two-space indent, a final newline. */
export function specItemText(item: SpecItem, schema: string | undefined): string {
  const { $schema: _schema, ...rest } = item;
  return `${JSON.stringify({ ...(schema !== undefined ? { $schema: schema } : {}), ...rest }, null, 2)}\n`;
}

export interface ReworkedSpec {
  /** The spec with the draft's changes laid over it. */
  spec: Spec;
  /** The files the draft changes or adds: path from the repository's root, and the new contents. */
  files: { path: string; id: string; text: string; isNew: boolean }[];
  /** Ids in the draft that change nothing any more: the repository caught up, or the edit was undone. */
  settled: string[];
}

/**
 * Lays a draft over the files of a spec. An item in the draft that is the same
 * as the repository's (the agent's pull request merged, say) no longer counts.
 */
export function applyRework(files: SpecFile[], original: Spec, draft: SpecReworkDraft): ReworkedSpec {
  const changed: ReworkedSpec["files"] = [];
  const settled: string[] = [];
  const texts = new Map<string, string>();
  for (const [id, stored] of Object.entries(draft.items)) {
    const parsed = SpecItem.safeParse(stored);
    const node = original.nodes.get(id);
    // Unreadable, or about an item that isn't read (or is gone): nothing to lay it over.
    if (!parsed.success || (node !== undefined && node.file !== null && !node.loaded)) continue;
    const existing = node !== undefined && node.file !== null ? node : null;
    if (existing?.item && stable({ ...existing.item, $schema: undefined }) === stable({ ...parsed.data, $schema: undefined })) {
      settled.push(id);
      continue;
    }
    // A folder that had no item of its own gets its index.json; anything else new is a file named after its id.
    const folder = node !== undefined && node.children.length > 0;
    const path = existing?.file?.slice(SPEC_DIR.length + 1) ?? (folder ? `${id !== "" ? `${id}/` : ""}index.json` : `${id}.json`);
    // New files point at the schema the way their neighbors do, else at the published one.
    const text = specItemText(parsed.data, existing?.item ? existing.item.$schema : (original.root.item?.$schema === undefined ? undefined : SPEC_SCHEMA_URL));
    texts.set(path, text);
    changed.push({ path: `${SPEC_DIR}/${path}`, id, text, isNew: existing === null });
  }
  const laid = files.map((file) => {
    const text = texts.get(file.path);
    if (text === undefined) return file;
    texts.delete(file.path);
    return { path: file.path, text, oid: `rework:${text}` };
  });
  for (const [path, text] of texts) laid.push({ path, text, oid: `rework:${text}` });
  return { spec: buildSpec(laid), files: changed, settled };
}

// ------------------------------------------------------------------ handover

const quote = (text: string) => `"${text}"`;

function requirementLine(change: RequirementChange): string {
  const { before, after } = change;
  if (after === null) return `- ${change.id}: deleted.`;
  const level = after.level ?? "must";
  if (before === null) return `- ${change.id}: new (${level}). ${quote(after.text)}`;
  if (after.status === "deprecated" && before.status !== "deprecated") {
    const replaced = (after.deprecation?.replacedBy ?? []).join(", ");
    return `- ${change.id}: deprecated. Why: ${after.deprecation?.reason ?? "no reason given"}${replaced !== "" ? ` Replaced by ${replaced}.` : ""}`;
  }
  const parts: string[] = [];
  if (change.version?.kind === "bumped") parts.push(`version ${change.version.from} to ${change.version.to}`);
  if (before.text !== after.text) parts.push(`was ${quote(before.text)}, now ${quote(after.text)}`);
  if ((before.level ?? "must") !== level) parts.push(`${before.level ?? "must"} to ${level}`);
  if (before.status !== after.status) parts.push(`status ${before.status ?? "the item's"} to ${after.status ?? "the item's"}`);
  const why = change.version?.kind === "bumped" && change.version.reason !== null ? ` Why: ${change.version.reason}` : "";
  const wording = change.version?.kind === "same" ? " A wording fix: what it means is the same." : "";
  return `- ${change.id}: ${parts.join("; ")}.${why}${wording}`;
}

function storyLine(change: ItemChange["stories"][number]): string {
  const { before, after } = change;
  if (after === null) return `- ${change.id}: user story deleted.`;
  if (before === null) return `- ${change.id}: new user story. ${quote(storySentence(after))}`;
  if (after.status === "deprecated" && before.status !== "deprecated") return `- ${change.id}: user story deprecated. Why: ${after.deprecation?.reason ?? "no reason given"}`;
  return `- ${change.id}: user story was ${quote(storySentence(before))}, now ${quote(storySentence(after))}.`;
}

function itemSection(change: ItemChange, path: string): string {
  const node = change.after ?? change.before;
  const title = node ? specTrail(node).map((n) => n.title).join(" / ") : change.id;
  const lines = [
    ...change.fields.map((field) =>
      change.kind === "added"
        ? null
        : `- ${field.field}: ${field.before !== undefined ? quote(field.before) : "none"} to ${field.after !== undefined ? quote(field.after) : "none"}.`,
    ),
    ...change.stories.map(storyLine),
    ...change.requirements.map(requirementLine),
  ].filter((line) => line !== null);
  return `### ${title} (\`${path}\`): ${change.kind === "added" ? "new item" : "changed"}\n\n${lines.length > 0 ? lines.join("\n") : "- See the file below."}`;
}

export interface ReworkPromptInput {
  /** "owner/name". */
  repo: string;
  branch: string;
  diff: SpecDiff;
  files: ReworkedSpec["files"];
  note: string;
}

/**
 * The handover: what was changed in the spec and why, the complete new
 * contents of each changed file, and what to do about the code. It stands on
 * its own, for an agent that has the repository and nothing else.
 */
export function specReworkPrompt({ repo, branch, diff, files, note }: ReworkPromptInput): string {
  const byId = new Map(files.map((file) => [file.id, file]));
  const changes = diff.items.flatMap((change) => {
    const file = byId.get(change.id);
    return file ? [itemSection(change, file.path)] : [];
  });
  const affected = diff.items.flatMap((change) =>
    change.requirements
      .filter((r) => r.after !== null && (r.kind === "added" || r.version?.kind === "bumped" || requirementStatus(change.after?.item, r.after) === "deprecated"))
      .map((r) => r.id),
  );
  const sections = [
    `Update the spec of ${repo}, and the code to match it.

The spec is the \`${SPEC_DIR}\` folder at the root of the repository: one JSON file per part of the product, with the requirements the code has to meet. I reworked it on ${branch}. Below is what I changed and why, then the complete new contents of each file I changed. Nothing has been written to the repository yet: that is your job.`,

    `## What changed\n\n${changes.join("\n\n")}`,

    ...(note.trim() !== "" ? [`## Also\n\n${note.trim()}`] : []),

    `## The files

Write each of these exactly as it is here. They replace the whole file.

${files.map((file) => `### \`${file.path}\`${file.isNew ? " (new)" : ""}\n\n${file.text.trimEnd().split("\n").map((line) => `    ${line}`).join("\n")}`).join("\n\n")}`,

    `## What to do

1. Start from ${branch}, on a new branch. If a file below has changed there since I read it, keep those changes and apply mine on top; don't drop either.
2. Write the files above.
3. Then bring the product in line with the spec${affected.length > 0 ? `, requirement by requirement: ${affected.join(", ")}` : ""}. The spec says what it must do, not where or how that is built: find out what the product does today, compare, and change it and its tests until each new requirement, and each new version of one, holds. For a deprecated one, remove the behavior it described unless its reason says otherwise.
4. Keep the spec's rules:
   - The spec doesn't say what is built. It has no status for that and names no files; don't add either.
   - A requirement's \`id\` is unique in the whole spec and never changes or gets reused.
   - A requirement is never deleted. One that is no longer wanted has \`"status": "deprecated"\` and a \`deprecation\` with the \`reason\`.
   - When what a requirement means changes, its \`version\` goes up by one and what it said goes into its \`history\`, with the \`reason\`. History is never edited.
   - Every file fits the schema. Unknown keys are errors.
   The full format is at ${SPEC_SCHEMA_URL.replace("schema/spec.schema.json", "spec-llms.txt")}.
5. If something I changed can't be done, contradicts another requirement, or is unclear, don't guess: stop and tell me.
6. Open one pull request. In its description, list the requirement ids it touches, and say for each whether the product now meets it.`,
  ];
  return `${sections.join("\n\n")}\n`;
}

/** A title for the pull request that carries a rework: the part it is about, or how many. */
export function specPullTitle(diff: SpecDiff): string {
  const parts = diff.items.map((item) => (item.after ?? item.before)?.title ?? item.id);
  return parts.length === 1 ? `Spec: ${parts[0] ?? ""}` : `Spec: ${parts.length} parts`;
}

/** A branch name for it: "spec/retries-and-errors-1a2b". `salt` keeps two with one title apart. */
export function specPullBranch(title: string, salt: string): string {
  const slug = title
    .replace(/^Spec:\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `spec/${slug === "" ? "rework" : slug}-${salt}`;
}

/**
 * The description of a pull request that changes the spec and nothing else:
 * what changed and why, and what a coding agent pointed at the pull request
 * has to do to make the product follow. The files themselves are its diff.
 */
export function specPullBody({ diff, files, note }: Pick<ReworkPromptInput, "diff" | "files" | "note">): string {
  const byId = new Map(files.map((file) => [file.id, file]));
  const changes = diff.items.flatMap((change) => {
    const file = byId.get(change.id);
    return file ? [itemSection(change, file.path)] : [];
  });
  const affected = diff.items.flatMap((change) =>
    change.requirements
      .filter((r) => r.after !== null && (r.kind === "added" || r.version?.kind === "bumped" || requirementStatus(change.after?.item, r.after) === "deprecated"))
      .map((r) => r.id),
  );
  const sections = [
    `This pull request changes the spec (\`${SPEC_DIR}\`) and nothing else yet. The product has to follow: the implementation belongs in this same pull request.`,

    `## What changed in the spec\n\n${changes.join("\n\n")}`,

    ...(note.trim() !== "" ? [`## Also\n\n${note.trim()}`] : []),

    `## For the coding agent

1. Check out this pull request's branch. The spec files in it are final: don't rewrite them unless a step below says so.
2. Bring the product in line with the spec${affected.length > 0 ? `, requirement by requirement: ${affected.join(", ")}` : ""}. Find out what the product does today, compare, and change it and its tests until each new requirement, and each new version of one, holds. For a deprecated one, remove what it described unless its reason says otherwise.
3. Push your commits to this branch. Don't open a second pull request.
4. Keep the spec's rules if you have to touch it: ids never change or get reused, nothing is deleted (deprecate, with the reason), a change of meaning is a new version with its reason, and every file fits the schema. The full format is at ${SPEC_SCHEMA_URL.replace("schema/spec.schema.json", "spec-llms.txt")}.
5. If something can't be done, contradicts another requirement, or is unclear, don't guess: say so in a comment on this pull request and stop.
6. When you are done, comment with the requirement ids this touches and, for each, whether the product now meets it.`,
  ];
  return `${sections.join("\n\n")}\n`;
}

