// The difference between two versions of a repository's spec (say, a branch
// and the branch it merges into), by meaning rather than by line: which items
// were added, removed or changed, and within a changed item which fields and
// which requirements. Items are matched by id, requirements by their id within
// the item, so rewording a requirement is a change and renumbering it is a
// removal and an addition.

import type { Spec, SpecFigure, SpecItem, SpecNode, SpecRequirement } from "./spec";

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

export interface ItemChange {
  id: string;
  kind: ChangeKind;
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
  counts: { items: Record<ChangeKind, number>; requirements: Record<ChangeKind, number> };
}

const FIELDS = ["title", "summary", "status", "description", "order"] as const;

function fieldText(item: SpecItem | null, field: (typeof FIELDS)[number]): string | undefined {
  const value = item?.[field];
  return typeof value === "number" ? value.toString() : value;
}

function sameRequirement(a: SpecRequirement, b: SpecRequirement): boolean {
  return a.text === b.text && (a.level ?? "must") === (b.level ?? "must") && a.status === b.status;
}

function diffRequirements(before: SpecRequirement[], after: SpecRequirement[]): RequirementChange[] {
  const changes: RequirementChange[] = [];
  const old = new Map(before.map((r) => [r.id, r]));
  const current = new Set(after.map((r) => r.id));
  // The newer order, with each removed requirement after the one it used to follow.
  const removedAfter = new Map<string | null, SpecRequirement[]>();
  let anchor: string | null = null;
  for (const requirement of before) {
    if (current.has(requirement.id)) anchor = requirement.id;
    else removedAfter.set(anchor, [...(removedAfter.get(anchor) ?? []), requirement]);
  }
  const removed = (after: string | null) =>
    (removedAfter.get(after) ?? []).forEach((r) => changes.push({ id: r.id, kind: "removed", before: r, after: null }));
  removed(null);
  for (const requirement of after) {
    const was = old.get(requirement.id);
    if (was === undefined) changes.push({ id: requirement.id, kind: "added", before: null, after: requirement });
    else if (!sameRequirement(was, requirement)) changes.push({ id: requirement.id, kind: "changed", before: was, after: requirement });
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

function diffItem(id: string, before: SpecNode | null, after: SpecNode | null, oids: { before: Spec["assets"]; after: Spec["assets"] }): ItemChange | null {
  // A folder without a file of its own isn't an item.
  const [old, current] = [before?.file === null ? null : before, after?.file === null ? null : after];
  if (old === null && current === null) return null;
  const [a, b] = [old?.item ?? null, current?.item ?? null];
  const kind: ChangeKind = old === null ? "added" : current === null ? "removed" : "changed";

  const fields: FieldChange[] = [];
  for (const field of FIELDS) {
    const [was, is] = [fieldText(a, field), fieldText(b, field)];
    // The position among siblings only matters when it moves.
    if (was !== is && (field !== "order" || kind === "changed")) fields.push({ field, before: was, after: is });
  }
  const lists = [
    diffList("questions", a?.questions ?? [], b?.questions ?? []),
    diffList("code", a?.code ?? [], b?.code ?? []),
    diffList("related", a?.related ?? [], b?.related ?? []),
  ].filter((list) => list !== null);

  const [oldError, newError] = [old?.error ?? null, current?.error ?? null];
  const unreadable: ItemChange["unreadable"] =
    kind !== "changed" || (oldError === null) === (newError === null)
      ? null
      : newError !== null
        ? { side: "after", error: newError }
        : { side: "before", error: oldError ?? "" };

  const change: ItemChange = {
    id,
    kind,
    before: old,
    after: current,
    fields,
    requirements: diffRequirements(a?.requirements ?? [], b?.requirements ?? []),
    figures: diffFigures(a?.figures ?? [], b?.figures ?? [], oids),
    lists,
    unreadable,
  };
  const empty = fields.length === 0 && change.requirements.length === 0 && change.figures.length === 0 && lists.length === 0 && unreadable === null;
  return kind === "changed" && empty ? null : change;
}

/** What changed from `before` to `after`. A missing spec (null) counts as an empty one. */
export function diffSpecs(before: Spec | null, after: Spec | null): SpecDiff {
  const none: Spec["assets"] = new Map();
  const oids = { before: before?.assets ?? none, after: after?.assets ?? none };
  const items: ItemChange[] = [];
  const seen = new Set<string>();

  // Walks both outlines together: the newer one's children in their order,
  // then the ones only the older has.
  const visit = (old: SpecNode | null, current: SpecNode | null) => {
    const id = current?.id ?? old?.id ?? "";
    if (seen.has(id)) return;
    seen.add(id);
    const change = diffItem(id, old, current, oids);
    if (change !== null) items.push(change);
    const oldChildren = new Map((old?.children ?? []).map((child) => [child.id, child]));
    for (const child of current?.children ?? []) {
      visit(oldChildren.get(child.id) ?? null, child);
      oldChildren.delete(child.id);
    }
    for (const child of oldChildren.values()) visit(child, null);
  };
  visit(before?.root ?? null, after?.root ?? null);

  const counts: SpecDiff["counts"] = { items: { added: 0, removed: 0, changed: 0 }, requirements: { added: 0, removed: 0, changed: 0 } };
  for (const item of items) {
    counts.items[item.kind]++;
    for (const requirement of item.requirements) counts.requirements[requirement.kind]++;
  }
  return { items, counts };
}
