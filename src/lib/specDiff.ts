// The difference between two versions of a repository's spec (say, a branch
// and the branch it merges into), by meaning rather than by line: which items
// were added, removed or changed, and within a changed item which fields and
// which requirements. Items are matched by id, requirements by their id within
// the item, so rewording a requirement is a change and renumbering it is a
// removal and an addition.
// Spec: D1, D2, D3, D4, D5, D8, D10, D11, D14, D15, D16

import { requirementVersion, specStatus, type Spec, type SpecFigure, type SpecItem, type SpecNode, type SpecRequirement, type SpecStatus, type SpecStory, type SpecValue } from "./spec";

export type ChangeKind = "added" | "removed" | "changed";

/** A value that differs; `undefined` on the side that doesn't have it. */
export interface FieldChange {
  /** "deprecation" is the reason an item gives for being deprecated. */
  field: "title" | "summary" | "description" | "order" | "deprecation";
  before: string | undefined;
  after: string | undefined;
}

export interface RequirementChange {
  id: string;
  kind: ChangeKind;
  before: SpecRequirement | null;
  after: SpecRequirement | null;
  /** Why this change makes the spec promise less, if it does: what a reviewer should not miss. */
  weakened: string | null;
  /**
   * What happened to its version, when its meaning may have changed:
   * "bumped" with the reason the old version gives for being replaced (null
   * when it gives none), or "same" when its text or level changed while the
   * version stayed: right for a wording fix, wrong for a change of meaning.
   */
  version: { kind: "bumped"; from: number; to: number; reason: string | null } | { kind: "same"; at: number } | null;
  /**
   * The requirement went to, or came from, another item (ids are unique in
   * the whole spec, so the same id elsewhere is the same requirement). Where
   * it came from it is "removed" with `to`; where it is now it is "changed"
   * or, when nothing else about it changed, "added", with `from`.
   */
  moved: { from: string } | { to: string } | null;
}

export interface StoryChange {
  id: string;
  kind: ChangeKind;
  before: SpecStory | null;
  after: SpecStory | null;
  /** Why this change takes something away from the spec, if it does. */
  weakened: string | null;
}

export interface ValueChange {
  id: string;
  kind: ChangeKind;
  before: SpecValue | null;
  after: SpecValue | null;
  /** Why what it is changed, from its history, when the change recorded one. */
  reason: string | null;
  /** What it is changed, and nothing says why. */
  unexplained: boolean;
  /** Why this change takes something away from the spec, if it does. */
  weakened: string | null;
}

export interface FigureChange {
  src: string;
  kind: ChangeKind;
  before: SpecFigure | null;
  after: SpecFigure | null;
  /** The file itself differs, not (only) its caption. */
  picture: boolean;
}

/** Entries of a list of strings that are only on one side. */
export interface ListChange {
  field: "related";
  added: string[];
  removed: string[];
}

/** An item's file was moved (its id changed), with or without other changes. */
export type ItemKind = ChangeKind | "moved";

export interface ItemChange {
  id: string;
  kind: ItemKind;
  /** The id it had before, when it was moved. */
  movedFrom: string | null;
  /** The contents of a side aren't loaded yet, so what changed isn't known. */
  pending: boolean;
  /** Why the item as a whole promises less, if it does. */
  weakened: string | null;
  /** The requirements that didn't change, for context. */
  unchanged: SpecRequirement[];
  /** The item on each side; null where it doesn't exist. */
  before: SpecNode | null;
  after: SpecNode | null;
  fields: FieldChange[];
  stories: StoryChange[];
  requirements: RequirementChange[];
  values: ValueChange[];
  figures: FigureChange[];
  lists: ListChange[];
  /** It can be read on one side only: why it can't on the other. */
  unreadable: { side: "before" | "after"; error: string } | null;
}

export interface SpecDiff {
  /** In the outline's order: the newer spec's, with removed items where they used to be. */
  items: ItemChange[];
  counts: {
    items: Record<ItemKind, number>;
    stories: Record<ChangeKind, number>;
    values: Record<ChangeKind, number>;
    /** A requirement that moved between items counts once, as moved. */
    requirements: Record<ChangeKind | "moved", number>;
    /** Items and requirements that promise less than before. */
    weakened: number;
  };
}

const LEVEL_RANK = { may: 0, should: 1, must: 2 } as const;
/** Why an item being deprecated takes something away, with the reason it gives; null when it wasn't just deprecated. */
function itemStepBack(a: SpecItem | null, b: SpecItem | null): string | null {
  if (b?.deprecation === undefined || a?.deprecation !== undefined) return null;
  return `Deprecated: ${b.deprecation.reason}`;
}

function versionChange(before: SpecRequirement, after: SpecRequirement): RequirementChange["version"] {
  const [from, to] = [requirementVersion(before), requirementVersion(after)];
  if (to !== from) {
    // The version just left behind says why it was replaced.
    const left = (after.history ?? []).find((earlier) => earlier.version === from);
    return { kind: "bumped", from, to, reason: left?.reason ?? null };
  }
  const meaning = before.text !== after.text || (before.level ?? "must") !== (after.level ?? "must");
  return meaning ? { kind: "same", at: to } : null;
}

/** Why the record of a requirement's earlier versions is no longer what it was; null when it is intact. */
function historyBroken(before: SpecRequirement, after: SpecRequirement): string | null {
  const [old, current] = [before.history ?? [], after.history ?? []];
  const [from, to] = [requirementVersion(before), requirementVersion(after)];
  if (to < from) return `Its version went back from ${from} to ${to}.`;
  // What was recorded stays as it was recorded.
  if (old.some((earlier, index) => JSON.stringify(earlier) !== JSON.stringify(current[index]))) {
    return "The record of its earlier versions was changed or deleted.";
  }
  if (to === from) return null;
  // Each version left behind is recorded as it was, with why it went.
  const left = current.find((earlier) => earlier.version === from);
  if (left === undefined) return `It is at version ${to} without a record of version ${from} and why it changed.`;
  if (left.text !== before.text || (left.level ?? "must") !== (before.level ?? "must")) {
    return `Its history doesn't record version ${from} as it was.`;
  }
  return null;
}

function requirementWeakened(before: SpecRequirement | null, after: SpecRequirement | null, was: SpecStatus | undefined, is: SpecStatus | undefined): string | null {
  if (before === null) return null;
  const level = before.level ?? "must";
  const status = was ?? specStatus(before);
  if (after === null) {
    // Nothing is ever deleted from a spec: what is no longer wanted is deprecated, with the reason.
    return status === "deprecated"
      ? "A deprecated requirement is deleted. Keep it: it is the record of what was dropped and why."
      : `A ${level} requirement is deleted. Deprecate it instead, with the reason, so the record stays.`;
  }
  const broken = historyBroken(before, after);
  if (broken !== null) return broken;
  const next = after.level ?? "must";
  const nextStatus = is ?? specStatus(after);
  if (nextStatus === "deprecated" && status !== "deprecated") {
    const reason = after.deprecation?.reason;
    return reason !== undefined ? `Deprecated: ${reason}` : "Deprecated, without saying why.";
  }
  if (LEVEL_RANK[next] < LEVEL_RANK[level]) return `Lowered from ${level} to ${next}.`;
  return null;
}

const FIELDS = ["title", "summary", "description", "order"] as const;

function fieldText(item: SpecItem | null, field: (typeof FIELDS)[number]): string | undefined {
  const value = item?.[field];
  return typeof value === "number" ? value.toString() : value;
}

function sameRequirement(a: SpecRequirement, b: SpecRequirement): boolean {
  return (
    a.text === b.text &&
    (a.level ?? "must") === (b.level ?? "must") &&
    requirementVersion(a) === requirementVersion(b) &&
    // What it touches is part of it too, though not of what it means.
    JSON.stringify(a.related ?? []) === JSON.stringify(b.related ?? []) &&
    JSON.stringify(a.history ?? []) === JSON.stringify(b.history ?? []) &&
    // The record of a deprecation is part of the requirement: a new reason is a change.
    JSON.stringify(a.deprecation ?? null) === JSON.stringify(b.deprecation ?? null)
  );
}

function diffRequirements(before: SpecRequirement[], after: SpecRequirement[], was: SpecStatus | undefined, is: SpecStatus | undefined): RequirementChange[] {
  const changes: RequirementChange[] = [];
  const olds = new Map(before.map((r) => [r.id, r]));
  const current = new Set(after.map((r) => r.id));
  // The newer order, with each removed requirement after the one it used to follow.
  const removedAfter = new Map<string | null, SpecRequirement[]>();
  let anchor: string | null = null;
  for (const requirement of before) {
    if (current.has(requirement.id)) anchor = requirement.id;
    else removedAfter.set(anchor, [...(removedAfter.get(anchor) ?? []), requirement]);
  }
  const removed = (after: string | null) =>
    (removedAfter.get(after) ?? []).forEach((r) =>
      changes.push({ id: r.id, kind: "removed", before: r, after: null, weakened: requirementWeakened(r, null, was, is), moved: null, version: null }),
    );
  removed(null);
  for (const requirement of after) {
    const old = olds.get(requirement.id);
    if (old === undefined) changes.push({ id: requirement.id, kind: "added", before: null, after: requirement, weakened: null, moved: null, version: null });
    else if (!sameRequirement(old, requirement)) {
      changes.push({ id: requirement.id, kind: "changed", before: old, after: requirement, weakened: requirementWeakened(old, requirement, was, is), moved: null, version: versionChange(old, requirement) });
    }
    removed(requirement.id);
  }
  return changes;
}

/** User stories are matched by id, like requirements; the newer order, then the ones taken out. */
function diffStories(before: SpecStory[], after: SpecStory[], was: SpecStatus | undefined, is: SpecStatus | undefined): StoryChange[] {
  const changes: StoryChange[] = [];
  const olds = new Map(before.map((story) => [story.id, story]));
  for (const story of after) {
    const old = olds.get(story.id);
    olds.delete(story.id);
    if (old === undefined) changes.push({ id: story.id, kind: "added", before: null, after: story, weakened: null });
    else if (JSON.stringify(old) !== JSON.stringify(story)) {
      const [oldStatus, status] = [was ?? specStatus(old), is ?? specStatus(story)];
      const deprecated = status === "deprecated" && oldStatus !== "deprecated";
      const reason = story.deprecation?.reason;
      changes.push({
        id: story.id,
        kind: "changed",
        before: old,
        after: story,
        weakened: deprecated ? (reason !== undefined ? `Deprecated: ${reason}` : "Deprecated, without saying why.") : null,
      });
    }
  }
  // Nothing is deleted from a spec: a story that is no longer wanted is deprecated, with the reason.
  for (const story of olds.values()) {
    changes.push({ id: story.id, kind: "removed", before: story, after: null, weakened: "A user story is deleted. Deprecate it instead, with the reason, so the record stays." });
  }
  return changes;
}

/** What a value is, apart from its record: two values with the same are the same value. */
const valueCore = (value: SpecValue) => JSON.stringify([value.type, value.value, value.type === "color" ? value.dark : undefined, value.type === "number" ? value.unit : undefined]);

/** Named values are matched by id; the newer order, then the ones taken out. */
function diffValues(before: SpecValue[], after: SpecValue[], was: SpecStatus | undefined, is: SpecStatus | undefined): ValueChange[] {
  const changes: ValueChange[] = [];
  const olds = new Map(before.map((value) => [value.id, value]));
  for (const value of after) {
    const old = olds.get(value.id);
    olds.delete(value.id);
    if (old === undefined) changes.push({ id: value.id, kind: "added", before: null, after: value, reason: null, unexplained: false, weakened: null });
    else if (JSON.stringify(old) !== JSON.stringify(value)) {
      const [oldStatus, status] = [was ?? specStatus(old), is ?? specStatus(value)];
      const deprecated = status === "deprecated" && oldStatus !== "deprecated";
      const why = value.deprecation?.reason;
      const differs = valueCore(old) !== valueCore(value);
      const recorded = (value.history?.length ?? 0) > (old.history?.length ?? 0);
      changes.push({
        id: value.id,
        kind: "changed",
        before: old,
        after: value,
        reason: differs && recorded ? (value.history?.at(-1)?.reason ?? null) : null,
        unexplained: differs && !recorded,
        weakened: deprecated ? (why !== undefined ? `Deprecated: ${why}` : "Deprecated, without saying why.") : null,
      });
    }
  }
  // Nothing is deleted from a spec: a value that is no longer used is deprecated, with the reason.
  for (const value of olds.values()) {
    changes.push({ id: value.id, kind: "removed", before: value, after: null, reason: null, unexplained: false, weakened: "A named value is deleted. Deprecate it instead, with the reason, so the record stays." });
  }
  return changes;
}

function diffFigures(before: SpecFigure[], after: SpecFigure[], oids: { before: Spec["assets"]; after: Spec["assets"] }): FigureChange[] {
  const changes: FigureChange[] = [];
  const old = new Map(before.map((f) => [f.src, f]));
  for (const figure of after) {
    const was = old.get(figure.src);
    old.delete(figure.src);
    if (was === undefined) {
      changes.push({ src: figure.src, kind: "added", before: null, after: figure, picture: true });
      continue;
    }
    const [oldOid, newOid] = [oids.before.get(figure.src) ?? null, oids.after.get(figure.src) ?? null];
    // Without ids (or with the file missing on a side) there's nothing to say about the picture.
    const picture = oldOid !== null && newOid !== null && oldOid !== newOid;
    if (picture || was.caption !== figure.caption || was.alt !== figure.alt) {
      changes.push({ src: figure.src, kind: "changed", before: was, after: figure, picture });
    }
  }
  for (const figure of old.values()) changes.push({ src: figure.src, kind: "removed", before: figure, after: null, picture: true });
  return changes;
}

function diffList(field: ListChange["field"], before: string[], after: string[]): ListChange | null {
  const added = after.filter((entry) => !before.includes(entry));
  const removed = before.filter((entry) => !after.includes(entry));
  return added.length > 0 || removed.length > 0 ? { field, added, removed } : null;
}

/** Whether the spec has an item (a file, not just a folder) with this id. */
function isItem(spec: Spec | null, id: string): boolean {
  const file = spec?.nodes.get(id)?.file;
  return file !== undefined && file !== null;
}

type Oids = { before: Spec["assets"]; after: Spec["assets"] };

function diffItem(id: string, before: SpecNode | null, after: SpecNode | null, oids: Oids, movedFrom: string | null): ItemChange | null {
  // A folder without a file of its own isn't an item.
  const [old, current] = [before?.file === null ? null : before, after?.file === null ? null : after];
  if (old === null && current === null) return null;
  // The same file on both sides: nothing changed, whatever is in it. This is
  // what lets a huge spec be compared without reading it.
  if (old !== null && current !== null && old.oid !== null && old.oid === current.oid && movedFrom === null) return null;
  const [a, b] = [old?.item ?? null, current?.item ?? null];
  const kind: ItemKind = movedFrom !== null ? "moved" : old === null ? "added" : current === null ? "removed" : "changed";
  const both = old !== null && current !== null;
  const base = { id, kind, movedFrom, before: old, after: current };
  if (old?.loaded === false || current?.loaded === false) {
    return { ...base, pending: true, weakened: null, unchanged: [], fields: [], stories: [], requirements: [], values: [], figures: [], lists: [], unreadable: null };
  }

  const fields: FieldChange[] = [];
  for (const field of FIELDS) {
    const [was, is] = [fieldText(a, field), fieldText(b, field)];
    // The position among siblings only matters when it moves.
    if (was !== is && (field !== "order" || both)) fields.push({ field, before: was, after: is });
  }
  const lists = [
    diffList("related", a?.related ?? [], b?.related ?? []),
  ].filter((list) => list !== null);

  // The record of the item's own deprecation, when it is new or reworded.
  const [oldReason, newReason] = [a?.deprecation?.reason, b?.deprecation?.reason];
  if (both && oldReason !== newReason) fields.push({ field: "deprecation", before: oldReason, after: newReason });

  const [oldError, newError] = [old?.error ?? null, current?.error ?? null];
  const unreadable: ItemChange["unreadable"] =
    !both || (oldError === null) === (newError === null)
      ? null
      : newError !== null
        ? { side: "after", error: newError }
        : { side: "before", error: oldError ?? "" };

  const requirements = diffRequirements(a?.requirements ?? [], b?.requirements ?? [], specStatus(a), specStatus(b));
  const touched = new Set(requirements.map((r) => r.id));
  // An item is never deleted either; what `diffSpecs` makes of this once it knows which requirements moved on.
  const weakened = current === null ? "Deleted." : both ? itemStepBack(a, b) : null;

  const change: ItemChange = {
    ...base,
    pending: false,
    weakened,
    unchanged: (b?.requirements ?? []).filter((r) => !touched.has(r.id)),
    fields,
    stories: diffStories(a?.stories ?? [], b?.stories ?? [], specStatus(a), specStatus(b)),
    requirements,
    values: diffValues(a?.values ?? [], b?.values ?? [], specStatus(a), specStatus(b)),
    figures: diffFigures(a?.figures ?? [], b?.figures ?? [], oids),
    lists,
    unreadable,
  };
  const empty = fields.length === 0 && change.stories.length === 0 && requirements.length === 0 && change.values.length === 0 && change.figures.length === 0 && lists.length === 0 && unreadable === null;
  return kind === "changed" && empty ? null : change;
}

/**
 * What changed from `before` to `after`. A missing spec (null) counts as an empty one.
 * `renames` maps the new path of a moved file to its old one, both from the
 * spec folder ("uploads/retries.json"), as a pull request reports them; a file
 * that only moved is also found without it, by its unchanged contents.
 */
export function diffSpecs(before: Spec | null, after: Spec | null, renames?: Map<string, string>): SpecDiff {
  const none: Spec["assets"] = new Map();
  const oids = { before: before?.assets ?? none, after: after?.assets ?? none };
  const items: ItemChange[] = [];
  const seen = new Set<string>();

  // Items only one side has, by file: a pair with the same contents is one item that moved.
  const onlyBefore = new Map<string, SpecNode>();
  for (const node of before?.nodes.values() ?? []) {
    if (node.file !== null && node.oid !== null && !isItem(after, node.id)) onlyBefore.set(node.oid, node);
  }
  const byFile = new Map<string, SpecNode>();
  for (const node of before?.nodes.values() ?? []) if (node.file !== null) byFile.set(node.file, node);
  const moved = new Map<string, SpecNode>();
  for (const node of after?.nodes.values() ?? []) {
    if (node.file === null || isItem(before, node.id)) continue;
    // `node.file` is from the repository's root (".spec/a.json"); renames are from the spec folder.
    const slash = node.file.indexOf("/");
    const renamedFrom = renames?.get(node.file.slice(slash + 1));
    const from =
      (renamedFrom !== undefined ? byFile.get(`${node.file.slice(0, slash)}/${renamedFrom}`) : undefined) ??
      (node.oid !== null ? onlyBefore.get(node.oid) : undefined);
    // It has to be gone from where it was; a copy is an addition.
    if (from !== undefined && !isItem(after, from.id)) moved.set(node.id, from);
  }
  const movedAway = new Set([...moved.values()].map((node) => node.id));

  // Walks both outlines together: the newer one's children in their order,
  // then the ones only the older has.
  const visit = (old: SpecNode | null, current: SpecNode | null) => {
    const id = current?.id ?? old?.id ?? "";
    if (seen.has(id)) return;
    seen.add(id);
    const from = current !== null ? moved.get(id) : undefined;
    // Where a moved item used to be, it isn't listed as removed.
    const gone = current === null && old !== null && movedAway.has(old.id);
    const change = gone ? null : from !== undefined ? diffItem(id, from, current, oids, from.id) : diffItem(id, old, current, oids, null);
    if (change !== null) items.push(change);
    const oldChildren = new Map((old?.children ?? []).map((child) => [child.id, child]));
    for (const child of current?.children ?? []) {
      visit(oldChildren.get(child.id) ?? null, child);
      oldChildren.delete(child.id);
    }
    for (const child of oldChildren.values()) visit(child, null);
  };
  visit(before?.root ?? null, after?.root ?? null);

  // A requirement removed from one item and added to another, with the same
  // id, moved: ids are unique in the whole spec.
  const removed = new Map<string, { item: ItemChange; change: RequirementChange }>();
  for (const item of items) {
    for (const change of item.requirements) if (change.kind === "removed") removed.set(change.id, { item, change });
  }
  for (const item of items) {
    for (const change of item.requirements) {
      const from = change.kind === "added" ? removed.get(change.id) : undefined;
      if (from === undefined || from.item === item || change.after === null || from.change.before === null) continue;
      const [old, was] = [from.change.before, specStatus(from.item.before?.item)];
      change.moved = { from: from.item.id };
      change.before = old;
      if (!sameRequirement(old, change.after)) {
        change.kind = "changed";
        change.version = versionChange(old, change.after);
      }
      // It is still promised, unless it got weaker on the way.
      change.weakened = requirementWeakened(old, change.after, was, specStatus(item.after?.item));
      from.change.moved = { to: item.id };
      from.change.weakened = null;
    }
  }
  for (const item of items) {
    // A deleted item takes its requirements with it, less those that live on elsewhere.
    // One whose requirements all moved on, or that never had any, was only reorganized.
    if (item.kind !== "removed" || item.weakened === null) continue;
    const lost = item.requirements.filter((r) => r.moved === null).length;
    item.weakened =
      lost > 0
        ? `Deleted, with ${lost} requirement${lost === 1 ? "" : "s"}. Deprecate it instead, with the reason, so the record stays.`
        : item.requirements.length > 0 || specStatus(item.before?.item) !== "deprecated"
          ? null
          : "A deprecated item is deleted. Keep it: it is the record of what was dropped and why.";
  }

  const counts: SpecDiff["counts"] = {
    items: { added: 0, removed: 0, changed: 0, moved: 0 },
    stories: { added: 0, removed: 0, changed: 0 },
    values: { added: 0, removed: 0, changed: 0 },
    requirements: { added: 0, removed: 0, changed: 0, moved: 0 },
    weakened: 0,
  };
  for (const item of items) {
    counts.items[item.kind]++;
    if (item.weakened !== null) counts.weakened++;
    for (const story of item.stories) {
      counts.stories[story.kind]++;
      if (story.weakened !== null) counts.weakened++;
    }
    for (const value of item.values) {
      counts.values[value.kind]++;
      if (value.weakened !== null) counts.weakened++;
    }
    for (const requirement of item.requirements) {
      // Counted where it is now, not where it left.
      if (requirement.moved === null) counts.requirements[requirement.kind]++;
      else if ("from" in requirement.moved) counts.requirements.moved++;
      if (requirement.weakened !== null) counts.weakened++;
    }
  }
  return { items, counts };
}
