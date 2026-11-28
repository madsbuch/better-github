// After a change to a spec, what else has to be looked at: everything related
// to something that changed and wasn't changed itself. A spec is edited one
// context at a time; whether the rest still holds is settled afterwards, in a
// pass of its own. This is the list that pass works through.
// Spec: SR18, RW16

import { relatedTo, specStatus, storySentence, valueText, type Spec, type SpecNode } from "./spec.ts";
import type { SpecDiff } from "./specDiff";

export interface ToReconcile {
  /** The entry ("#ACQ-4") or the part ("drives/accomplishment") to look at. */
  key: string;
  kind: "part" | "requirement" | "story" | "value";
  /** Its id, or a part's title. */
  label: string;
  /** The part it is, or is in. */
  node: SpecNode;
  /** What it says now. */
  text: string;
  /** What changed that it is related to, as entry ids and part titles. */
  because: string[];
}

/** Everything a diff changed: entries by "#id", parts by path, each with how to name it. */
function changed(diff: SpecDiff): Map<string, string> {
  const keys = new Map<string, string>();
  for (const item of diff.items) {
    // A part changed when something of its own did: its text, its pictures, its groundwork, or that it is there at all.
    if (item.kind !== "changed" || item.fields.length > 0 || item.figures.length > 0 || item.groundwork.length > 0) keys.set(item.id, (item.after ?? item.before)?.title ?? item.id);
    for (const entry of [...item.stories, ...item.requirements, ...item.values]) keys.set(`#${entry.id}`, entry.id);
  }
  return keys;
}

/**
 * What is related to a change and wasn't changed with it, in the newer spec.
 * Relations are taken from both versions, so what a deleted or unlinked entry
 * used to touch is still listed. What was dropped needs no reconciling.
 */
export function toReconcile(diff: SpecDiff, before: Spec | null, after: Spec | null): ToReconcile[] {
  if (after === null) return [];
  const touched = changed(diff);
  const found = new Map<string, ToReconcile>();
  for (const [key, name] of touched) {
    const neighbours = new Set([...(after.relations.get(key) ?? []), ...(before?.relations.get(key) ?? [])]);
    for (const other of neighbours) {
      if (touched.has(other)) continue;
      const known = found.get(other);
      if (known !== undefined) {
        known.because.push(name);
        continue;
      }
      // As it is now; one that is gone from the newer spec without being in the diff can't be.
      const target = relatedTo(after, key).find((candidate) => candidate.key === other) ?? relatedOnly(after, other);
      if (target === null || specStatus(target.node.item) !== undefined) continue;
      const entry = target.requirement ?? target.story ?? target.value;
      if (entry !== null && specStatus(entry) !== undefined) continue;
      found.set(other, {
        key: other,
        kind: target.requirement !== null ? "requirement" : target.story !== null ? "story" : target.value !== null ? "value" : "part",
        label: entry?.id ?? target.node.title,
        node: target.node,
        text:
          target.requirement !== null
            ? target.requirement.text
            : target.story !== null
              ? storySentence(target.story)
              : target.value !== null
                ? valueText(target.value)
                : (target.node.item?.summary ?? target.node.title),
        because: [name],
      });
    }
  }
  const order = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  return [...found.values()].map((entry) => ({ ...entry, because: entry.because.sort(order.compare) })).sort((a, b) => order.compare(a.key, b.key));
}

/** A key of the relations as what it names, when the spec has it. */
function relatedOnly(spec: Spec, key: string) {
  if (key.startsWith("#")) {
    const id = key.slice(1);
    const [requirement, story, value] = [spec.requirements.get(id), spec.stories.get(id), spec.values.get(id)];
    const node = requirement?.node ?? story?.node ?? value?.node;
    return node === undefined ? null : { key, node, requirement: requirement?.requirement ?? null, story: story?.story ?? null, value: value?.value ?? null };
  }
  const node = spec.nodes.get(key);
  return node === undefined ? null : { key, node, requirement: null, story: null, value: null };
}

/** The list as lines for a coding agent: what to look at, what it says, and what changed next to it. */
export function reconcileLines(entries: ToReconcile[]): string[] {
  return entries.map((entry) => `- ${entry.kind === "part" ? `the part ${entry.label} (\`${entry.key === "" ? "index" : entry.key}\`)` : entry.label}: "${entry.text}" Related to ${entry.because.join(", ")}.`);
}
