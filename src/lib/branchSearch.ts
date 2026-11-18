// Finding a branch by typing part of its name, in repositories with
// hundreds of branches: the best matches first, with what matched marked.

export interface Branch {
  name: string;
  /** When the branch's tip was committed (ISO), to put recent branches first. */
  committedDate: string | null;
}

/** [start, end) of a run of characters in a name. */
export type Range = [number, number];

export interface BranchMatch {
  branch: Branch;
  /** What matched the search, for highlighting. Empty without a search. */
  ranges: Range[];
}

// How a search word matches a name, best first. A branch's score is the
// sum over the words typed.
const EXACT = 0; // staging
const LAST_SEGMENT = 1; // release/staging
const PREFIX = 2; // staging-2
const SEGMENT_PREFIX = 3; // team/staging-fix
const WORD_PREFIX = 4; // fix-staging-deploy
const SUBSTRING = 5; // prestaging
const FUZZY = 6; // "eng629" in eng-629-vehicles

const WORD_BREAKS = "-_.";

function matchWord(name: string, word: string): { tier: number; ranges: Range[] } | null {
  if (name === word) return { tier: EXACT, ranges: [[0, name.length]] };
  if (name.endsWith(`/${word}`)) return { tier: LAST_SEGMENT, ranges: [[name.length - word.length, name.length]] };
  if (name.startsWith(word)) return { tier: PREFIX, ranges: [[0, word.length]] };
  // The occurrence that starts a segment beats one that starts a word, which beats any other.
  let best: { tier: number; at: number } | null = null;
  for (let at = name.indexOf(word, 1); at !== -1; at = name.indexOf(word, at + 1)) {
    const before = name[at - 1];
    const tier = before === "/" ? SEGMENT_PREFIX : before !== undefined && WORD_BREAKS.includes(before) ? WORD_PREFIX : SUBSTRING;
    if (!best || tier < best.tier) best = { tier, at };
    if (tier === SEGMENT_PREFIX) break;
  }
  if (best) return { tier: best.tier, ranges: [[best.at, best.at + word.length]] };
  const fuzzy = subsequence(name, word);
  return fuzzy && { tier: FUZZY, ranges: fuzzy };
}

/**
 * The characters of `word` in order within `name`, as close together as
 * possible, so separators can be skipped ("eng629" finds "eng-629"). Spread
 * out matches are noise and don't count.
 */
function subsequence(name: string, word: string): Range[] | null {
  if (word.length < 2) return null;
  const first = word.charAt(0);
  /** Positions of the word's characters, and how far apart the first and last are. */
  let best: { at: number[]; span: number } | null = null;
  for (let start = name.indexOf(first); start !== -1; start = name.indexOf(first, start + 1)) {
    const at = [start];
    let last = start;
    for (let i = 1, from = start + 1; i < word.length; i++) {
      const next = name.indexOf(word.charAt(i), from);
      if (next === -1) break;
      at.push(next);
      last = next;
      from = next + 1;
    }
    if (at.length < word.length) break; // Later starts can't do better.
    const span = last - start;
    if (!best || span < best.span) best = { at, span };
  }
  if (!best || best.span + 1 > word.length * 2 + 2) return null;
  return mergeRanges(best.at.map((i): Range => [i, i + 1]));
}

/** The first comparison that tells two items apart (non-zero), for sorting by several keys. */
function firstDifference(...comparisons: number[]): number {
  return comparisons.find((c) => c !== 0) ?? 0;
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

const newestFirst = (a: Branch, b: Branch) => (b.committedDate ?? "").localeCompare(a.committedDate ?? "");

/**
 * Ranks `branches` for what was typed: every word must match, closer
 * matches first, then the pinned branches (like the default), then the most
 * recently committed. Without a search, the pinned branches come first and
 * the rest newest first.
 */
export function searchBranches(branches: Branch[], query: string, pinned: string[] = []): BranchMatch[] {
  // The same branch may arrive from more than one source; keep the one that knows its date.
  const byName = new Map<string, Branch>();
  for (const branch of branches) {
    const seen = byName.get(branch.name);
    if (!seen || ((seen.committedDate ?? "") === "" && (branch.committedDate ?? "") !== "")) byName.set(branch.name, branch);
  }
  const pinRank = (name: string) => {
    const i = pinned.indexOf(name);
    return i === -1 ? pinned.length : i;
  };
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [...byName.values()]
      .sort((a, b) => firstDifference(pinRank(a.name) - pinRank(b.name), newestFirst(a, b), a.name.localeCompare(b.name)))
      .map((branch) => ({ branch, ranges: [] }));
  }

  const matches: (BranchMatch & { score: number })[] = [];
  for (const branch of byName.values()) {
    const name = branch.name.toLowerCase();
    let score = 0;
    let ranges: Range[] = [];
    for (const word of words) {
      const match = matchWord(name, word);
      if (!match) {
        score = -1;
        break;
      }
      score += match.tier;
      ranges = ranges.concat(match.ranges);
    }
    if (score >= 0) matches.push({ branch, ranges: mergeRanges(ranges), score });
  }
  return matches
    .sort(
      (a, b) =>
        firstDifference(
          a.score - b.score,
          pinRank(a.branch.name) - pinRank(b.branch.name),
          newestFirst(a.branch, b.branch),
          a.branch.name.length - b.branch.name.length,
          a.branch.name.localeCompare(b.branch.name),
        ),
    )
    .map(({ branch, ranges }) => ({ branch, ranges }));
}
