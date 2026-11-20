// Comparing two versions of a piece of a spec's prose (a description, say) the
// way a reader needs it: paragraph by paragraph and list item by list item.
// What didn't change stays as it is, what was reworded shows the words that
// changed, and what was added or taken out is whole. Comparing the two texts as
// one string would show a page of red above a page of green for one edited
// sentence.
// Spec: SR11, SR14

import { inlineDiff, type InlinePart } from "./diff";
import { specTextBlocks } from "./spec.ts";

/** A paragraph or one list item, and what happened to it. */
export type ProseBlock =
  | { kind: "same" | "added" | "removed"; list: boolean; text: string }
  /** Reworded: the old and the new as one text. */
  | { kind: "changed"; list: boolean; text: string; parts: InlinePart[] };

interface Unit {
  list: boolean;
  text: string;
}

/** A text as its paragraphs and list items, in order. */
export function proseUnits(text: string | undefined): Unit[] {
  return specTextBlocks(text ?? "").flatMap((block): Unit[] =>
    block.kind === "list" ? block.items.map((item) => ({ list: true, text: item })) : [{ list: false, text: block.text }],
  );
}

/** Long enough for any paragraph; beyond it, a paragraph is shown as replaced. */
const PARAGRAPH_TOKENS = 1500;

/**
 * What changed from one version of a text to the next, block by block. A block
 * that was taken out next to one that was put in is a rewording when the two
 * have enough in common; otherwise they are a removal and an addition.
 */
export function proseDiff(before: string | undefined, after: string | undefined): ProseBlock[] {
  const [a, b] = [proseUnits(before), proseUnits(after)];
  // The longest run of blocks both have, in order.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  const at = (i: number, j: number) => lcs[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const row = lcs[i];
    if (row === undefined) continue;
    for (let j = b.length - 1; j >= 0; j--) row[j] = a[i]?.text === b[j]?.text ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  }

  const blocks: ProseBlock[] = [];
  let [removed, added]: [Unit[], Unit[]] = [[], []];
  // What piled up between two unchanged blocks: reworded where an old block and a new one pair up.
  const settle = () => {
    const used = new Set<number>();
    for (const old of removed) {
      let match: { index: number; parts: InlinePart[] } | null = null;
      for (let index = 0; index < added.length && match === null; index++) {
        const candidate = added[index];
        if (used.has(index) || candidate === undefined) continue;
        const parts = inlineDiff(old.text, candidate.text, PARAGRAPH_TOKENS);
        if (parts !== null) match = { index, parts };
      }
      if (match === null) blocks.push({ kind: "removed", ...old });
      else {
        // New blocks before the one it turned into come first, as they do in the text.
        for (let index = 0; index < match.index; index++) {
          const earlier = added[index];
          if (!used.has(index) && earlier !== undefined) {
            blocks.push({ kind: "added", ...earlier });
            used.add(index);
          }
        }
        used.add(match.index);
        const now = added[match.index];
        if (now !== undefined) blocks.push({ kind: "changed", list: now.list, text: now.text, parts: match.parts });
      }
    }
    added.forEach((unit, index) => {
      if (!used.has(index)) blocks.push({ kind: "added", ...unit });
    });
    [removed, added] = [[], []];
  };

  let [i, j] = [0, 0];
  while (i < a.length || j < b.length) {
    const [old, current] = [a[i], b[j]];
    if (old !== undefined && current !== undefined && old.text === current.text) {
      settle();
      blocks.push({ kind: "same", ...current });
      i++;
      j++;
    } else if (old !== undefined && (current === undefined || at(i + 1, j) >= at(i, j + 1))) {
      removed.push(old);
      i++;
    } else if (current !== undefined) {
      added.push(current);
      j++;
    }
  }
  settle();
  return blocks;
}

/** A stretch of blocks to show, or a run of unchanged ones folded away. */
export type ProseStretch = { fold: false; blocks: ProseBlock[] } | { fold: true; blocks: ProseBlock[] };

/**
 * Folds the unchanged blocks that aren't next to a change: a reader of a
 * change needs the sentence before and after it, not the whole page again.
 */
export function foldUnchanged(blocks: ProseBlock[], context = 1): ProseStretch[] {
  const keep = blocks.map((block) => block.kind !== "same");
  blocks.forEach((block, index) => {
    if (block.kind === "same") return;
    for (let near = index - context; near <= index + context; near++) if (near >= 0 && near < blocks.length) keep[near] = true;
  });
  const stretches: ProseStretch[] = [];
  blocks.forEach((block, index) => {
    const fold = keep[index] !== true;
    const last = stretches.at(-1);
    if (last !== undefined && last.fold === fold) last.blocks.push(block);
    else stretches.push({ fold, blocks: [block] });
  });
  // One block isn't worth a fold: showing it takes no more room than saying it's there.
  const merged: ProseStretch[] = [];
  for (const stretch of stretches) {
    const fold = stretch.fold && stretch.blocks.length > 1;
    const last = merged.at(-1);
    if (last !== undefined && !last.fold && !fold) last.blocks.push(...stretch.blocks);
    else merged.push({ fold, blocks: [...stretch.blocks] });
  }
  return merged;
}

/**
 * One side of a reworded text: the old (what went out marked) or the new
 * (what came in marked). Spaces between two marked words are marked with
 * them, so a rewritten phrase is one stretch and not a row of single words.
 */
export function sideParts(parts: InlinePart[], side: "before" | "after"): { text: string; marked: boolean }[] {
  const [drop, mark] = side === "before" ? (["ins", "del"] as const) : (["del", "ins"] as const);
  const own = parts.filter((part) => part.kind !== drop);
  const out: { text: string; marked: boolean }[] = [];
  own.forEach((part, index) => {
    const between = part.kind === "same" && part.text.trim() === "" && own[index - 1]?.kind === mark && own[index + 1]?.kind === mark;
    const marked = part.kind === mark || between;
    const last = out.at(-1);
    if (last !== undefined && last.marked === marked) last.text += part.text;
    else out.push({ text: part.text, marked });
  });
  return out;
}
