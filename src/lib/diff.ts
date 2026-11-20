// Unified diff parsing for the `patch` field GitHub returns per file, plus
// word-level highlighting of changed line pairs.

export type LineKind = "add" | "del" | "ctx" | "meta";

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** The function/section name GitHub prints after the `@@` marker. */
  section: string;
  lines: DiffLine[];
}

export type Side = "LEFT" | "RIGHT";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** A captured run of digits; `fallback` when the group didn't match. */
function count(digits: string | undefined, fallback: number): number {
  return digits === undefined ? fallback : Number.parseInt(digits, 10);
}

export function parsePatch(patch: string | null | undefined): Hunk[] {
  if (patch === null || patch === undefined || patch === "") return [];
  const hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      hunk = {
        header: raw,
        oldStart: count(header[1], 0),
        oldCount: count(header[2], 1),
        newStart: count(header[3], 0),
        newCount: count(header[4], 1),
        section: header[5]?.trim() ?? "",
        lines: [],
      };
      hunks.push(hunk);
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      oldLeft = hunk.oldCount;
      newLeft = hunk.newCount;
      continue;
    }
    if (!hunk) continue;
    const marker = raw[0];
    if (marker === "+") {
      hunk.lines.push({ kind: "add", text: raw.slice(1), oldNo: null, newNo: newNo++ });
      newLeft--;
    } else if (marker === "-") {
      hunk.lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++, newNo: null });
      oldLeft--;
    } else if (marker === "\\") {
      hunk.lines.push({ kind: "meta", text: raw.slice(1).trim(), oldNo: null, newNo: null });
    } else if (marker === " " || (raw === "" && (oldLeft > 0 || newLeft > 0))) {
      hunk.lines.push({ kind: "ctx", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
      oldLeft--;
      newLeft--;
    }
  }
  return hunks;
}

/** Where a review comment on this line anchors (GitHub's line/side API). */
export function anchorOf(line: DiffLine): { side: Side; line: number } | null {
  if (line.kind === "del" && line.oldNo !== null) return { side: "LEFT", line: line.oldNo };
  if ((line.kind === "add" || line.kind === "ctx") && line.newNo !== null) return { side: "RIGHT", line: line.newNo };
  return null;
}

export function anchorKey(side: Side, line: number): string {
  return `${side}:${line}`;
}

// ---------------------------------------------------------------------------
// Side by side

/** A row of a side-by-side diff: indexes into the hunk's lines, null where that side is empty. */
export interface SplitRow {
  left: number | null;
  right: number | null;
}

/**
 * Lays a hunk out in two columns. Unchanged lines are on both sides; in a run
 * of removed lines followed by added ones, the first removed line is next to
 * the first added one, and so on, with what's left over on its own side.
 */
export function splitRows(hunk: Hunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    const kind = lines[i]?.kind;
    if (kind !== "del" && kind !== "add") {
      // "\ No newline at end of file" belongs to the line above it, on that line's side.
      const above = kind === "meta" ? lines[i - 1]?.kind : undefined;
      rows.push({ left: above === "add" ? null : i, right: above === "del" ? null : i });
      i++;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    while (lines[i]?.kind === "del") removed.push(i++);
    while (lines[i]?.kind === "add") added.push(i++);
    for (let k = 0; k < Math.max(removed.length, added.length); k++) rows.push({ left: removed[k] ?? null, right: added[k] ?? null });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Word diff

export interface Segment {
  text: string;
  changed: boolean;
}

const TOKEN = /\w+|\s+|[^\w\s]/g;
const MAX_TOKENS = 400;

function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

function merge(tokens: string[], changed: boolean[]): Segment[] {
  const segments: Segment[] = [];
  tokens.forEach((text, i) => {
    const last = segments[segments.length - 1];
    const isChanged = changed[i] ?? false;
    if (last && last.changed === isChanged) last.text += text;
    else segments.push({ text, changed: isChanged });
  });
  return segments;
}

/**
 * Token-level LCS diff of two lines. Returns segments for the old and new
 * line, or null when the lines are too different for emphasis to help.
 */
export function wordDiff(oldText: string, newText: string): [Segment[], Segment[]] | null {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length === 0 || b.length === 0 || a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;

  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  const lcs = (i: number, j: number): number => dp[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const row = dp[i];
    if (row === undefined) continue;
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }
  const aChanged = Array.from({ length: a.length }, () => true);
  const bChanged = Array.from({ length: b.length }, () => true);
  let i = 0;
  let j = 0;
  let common = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      aChanged[i++] = false;
      bChanged[j++] = false;
      common++;
    } else if (lcs(i + 1, j) >= lcs(i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }

  // Only emphasise when a meaningful part of the line survived; otherwise the
  // whole line changed and highlighting fragments is just noise.
  const unchangedChars = a.reduce((sum, t, k) => sum + (aChanged[k] === true ? 0 : t.trim().length), 0);
  const totalChars = Math.max(oldText.trim().length, newText.trim().length, 1);
  if (common === 0 || unchangedChars / totalChars < 0.35) return null;

  return [merge(a, aChanged), merge(b, bChanged)];
}

/** Word diffs for paired deletion/addition runs, keyed by line index in the hunk. */
export function intralineDiffs(hunk: Hunk): Map<number, Segment[]> {
  const result = new Map<number, Segment[]>();
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.kind !== "del") {
      i++;
      continue;
    }
    const delStart = i;
    while (i < lines.length && lines[i]?.kind === "del") i++;
    const addStart = i;
    while (i < lines.length && lines[i]?.kind === "add") i++;
    const dels = addStart - delStart;
    const adds = i - addStart;
    for (let k = 0; k < Math.min(dels, adds); k++) {
      const del = lines[delStart + k];
      const add = lines[addStart + k];
      if (del === undefined || add === undefined) continue;
      const diff = wordDiff(del.text, add.text);
      if (diff) {
        result.set(delStart + k, diff[0]);
        result.set(addStart + k, diff[1]);
      }
    }
  }
  return result;
}

/** A stretch of a text that is in both versions, only in the old one, or only in the new one. */
export interface InlinePart {
  text: string;
  kind: "same" | "del" | "ins";
}

/**
 * Two versions of a piece of prose as one text, with what was taken out and
 * what was put in marked where it happened: how an edit to a sentence reads
 * best. Null when they have too little in common for that to help.
 */
export function inlineDiff(oldText: string, newText: string): InlinePart[] | null {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length === 0 || b.length === 0 || a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;
  const dp: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  const lcs = (i: number, j: number): number => dp[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const row = dp[i];
    if (row === undefined) continue;
    for (let j = b.length - 1; j >= 0; j--) row[j] = a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
  }
  // Mostly different words: two separate texts read better than a patchwork.
  const words = (tokens: string[]) => tokens.filter((token) => /\w/.test(token)).length;
  let commonWords = 0;
  const parts: InlinePart[] = [];
  const push = (text: string, kind: InlinePart["kind"]) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ text, kind });
  };
  let [i, j] = [0, 0];
  while (i < a.length || j < b.length) {
    const [old, current] = [a[i], b[j]];
    if (old !== undefined && current !== undefined && old === current) {
      if (/\w/.test(old)) commonWords++;
      push(old, "same");
      i++;
      j++;
    } else if (old !== undefined && (current === undefined || lcs(i + 1, j) >= lcs(i, j + 1))) {
      push(old, "del");
      i++;
    } else if (current !== undefined) {
      push(current, "ins");
      j++;
    }
  }
  if (commonWords * 2 < Math.max(words(a), words(b))) return null;
  return parts;
}

/** Returns the hunk's lines as the old and new side texts for highlighting. */
export function hunkSides(hunk: Hunk): { oldText: string; newText: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of hunk.lines) {
    if (line.kind === "ctx") {
      oldLines.push(line.text);
      newLines.push(line.text);
    } else if (line.kind === "del") {
      oldLines.push(line.text);
    } else if (line.kind === "add") {
      newLines.push(line.text);
    }
  }
  return { oldText: oldLines.join("\n"), newText: newLines.join("\n") };
}

export function suggestionBody(lines: string[]): string {
  return "```suggestion\n" + lines.join("\n") + "\n```\n";
}
