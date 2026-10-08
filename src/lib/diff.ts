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

export function parsePatch(patch: string | null | undefined): Hunk[] {
  if (!patch) return [];
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
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
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
    if (last && last.changed === changed[i]) last.text += text;
    else segments.push({ text, changed: changed[i] });
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
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aChanged = new Array<boolean>(a.length).fill(true);
  const bChanged = new Array<boolean>(b.length).fill(true);
  let i = 0;
  let j = 0;
  let common = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      aChanged[i++] = false;
      bChanged[j++] = false;
      common++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  // Only emphasise when a meaningful part of the line survived; otherwise the
  // whole line changed and highlighting fragments is just noise.
  const unchangedChars = a.reduce((sum, t, k) => sum + (aChanged[k] ? 0 : t.trim().length), 0);
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
    if (lines[i].kind !== "del") {
      i++;
      continue;
    }
    const delStart = i;
    while (i < lines.length && lines[i].kind === "del") i++;
    const addStart = i;
    while (i < lines.length && lines[i].kind === "add") i++;
    const dels = addStart - delStart;
    const adds = i - addStart;
    for (let k = 0; k < Math.min(dels, adds); k++) {
      const diff = wordDiff(lines[delStart + k].text, lines[addStart + k].text);
      if (diff) {
        result.set(delStart + k, diff[0]);
        result.set(addStart + k, diff[1]);
      }
    }
  }
  return result;
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
