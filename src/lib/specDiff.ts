// The difference between two versions of a repository's spec (say, a branch
// and the branch it merges into), by meaning rather than by line: which items
// were added, removed or changed, and within a changed item which fields and
// which requirements. Items are matched by id, requirements by their id within
// the item, so rewording a requirement is a change and renumbering it is a
// removal and an addition.

import type { Spec, SpecFigure, SpecItem, SpecNode, SpecRequirement, SpecStatus } from "./spec";

export type ChangeKind = "added" | "removed" | "changed";

/** A value that differs; `undefined` on the side that doesn't have it. */
export interface FieldChange {
  field: "title" | "summary" | "status" | "description" | "order";
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
  field: "questions" | "code" | "related";
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
  requirements: RequirementChange[];
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
    requirements: Record<ChangeKind, number>;
    /** Items and requirements that promise less than before. */
    weakened: number;
  };
}

const LEVEL_RANK = { may: 0, should: 1, must: 2 } as const;
const STATUS_RANK = { deprecated: 0, draft: 1, accepted: 2, implemented: 3 } as const;

/** Why going from one status to another is a step back; null when it isn't. */
function statusStepBack(before: SpecStatus | undefined, after: SpecStatus | undefined): string | null {
  if (before === undefined || after === undefined || STATUS_RANK[after] >= STATUS_RANK[before]) return null;
  return after === "deprecated" ? "Deprecated." : `Back from ${before} to ${after}.`;
}

function requirementWeakened(before: SpecRequirement | null, after: SpecRequirement | null, was: SpecStatus | undefined, is: SpecStatus | undefined): string | null {
  if (before === null) return null;
  const level = before.level ?? "must";
  const status = before.status ?? was;
  if (after === null) {
    // Dropping what was already deprecated, or only optional, takes nothing away.
    return status === "deprecated" || level === "may" ? null : `A ${level} requirement is removed.`;
  }
  const next = after.level ?? "must";
  if (LEVEL_RANK[next] < LEVEL_RANK[level]) return `Lowered from ${level} to ${next}.`;
  // A requirement that only follows its item's status isn't flagged again for the item's step back.
  if (before.status === undefined && after.status === undefined) return null;
  return statusStepBack(status, after.status ?? is);
}

const FIELDS = ["title", "summary", "status", "description", "order"] as const;

function fieldText(item: SpecItem | null, field: (typeof FIELDS)[number]): string | undefined {
  const value = item?.[field];
  return typeof value === "number" ? value.toString() : value;
}

function sameRequirement(a: SpecRequirement, b: SpecRequirement): boolean {
  return a.text === b.text && (a.level ?? "must") === (b.level ?? "must") && a.status === b.status;
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
      changes.push({ id: r.id, kind: "removed", before: r, after: null, weakened: requirementWeakened(r, null, was, is) }),
    );
  removed(null);
  for (const requirement of after) {
    const old = olds.get(requirement.id);
    if (old === undefined) changes.push({ id: requirement.id, kind: "added", before: null, after: requirement, weakened: null });
    else if (!sameRequirement(old, requirement)) {
      changes.push({ id: requirement.id, kind: "changed", before: old, after: requirement, weakened: requirementWeakened(old, requirement, was, is) });
    }
    removed(requirement.id);
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
    return { ...base, pending: true, weakened: null, unchanged: [], fields: [], requirements: [], figures: [], lists: [], unreadable: null };
  }

  const fields: FieldChange[] = [];
  for (const field of FIELDS) {
    const [was, is] = [fieldText(a, field), fieldText(b, field)];
    // The position among siblings only matters when it moves.
    if (was !== is && (field !== "order" || both)) fields.push({ field, before: was, after: is });
  }
  const lists = [
    diffList("questions", a?.questions ?? [], b?.questions ?? []),
    diffList("code", a?.code ?? [], b?.code ?? []),
    diffList("related", a?.related ?? [], b?.related ?? []),
  ].filter((list) => list !== null);

  const [oldError, newError] = [old?.error ?? null, current?.error ?? null];
  const unreadable: ItemChange["unreadable"] =
    !both || (oldError === null) === (newError === null)
      ? null
      : newError !== null
        ? { side: "after", error: newError }
        : { side: "before", error: oldError ?? "" };

  const requirements = diffRequirements(a?.requirements ?? [], b?.requirements ?? [], a?.status, b?.status);
  const touched = new Set(requirements.map((r) => r.id));
  const live = (a?.requirements ?? []).filter((r) => (r.status ?? a?.status) !== "deprecated" && (r.level ?? "must") !== "may").length;
  const weakened =
    current === null
      ? live > 0
        ? `Removed, with ${live} requirement${live === 1 ? "" : "s"} that ${live === 1 ? "is" : "are"} no longer promised.`
        : null
      : both
        ? statusStepBack(a?.status, b?.status)
        : null;

  const change: ItemChange = {
    ...base,
    pending: false,
    weakened,
    unchanged: (b?.requirements ?? []).filter((r) => !touched.has(r.id)),
    fields,
    requirements,
    figures: diffFigures(a?.figures ?? [], b?.figures ?? [], oids),
    lists,
    unreadable,
  };
  const empty = fields.length === 0 && requirements.length === 0 && change.figures.length === 0 && lists.length === 0 && unreadable === null;
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

  const counts: SpecDiff["counts"] = {
    items: { added: 0, removed: 0, changed: 0, moved: 0 },
    requirements: { added: 0, removed: 0, changed: 0 },
    weakened: 0,
  };
  for (const item of items) {
    counts.items[item.kind]++;
    if (item.weakened !== null) counts.weakened++;
    for (const requirement of item.requirements) {
      counts.requirements[requirement.kind]++;
      if (requirement.weakened !== null) counts.weakened++;
    }
  }
  return { items, counts };
}
