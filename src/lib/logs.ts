// GitHub Actions job logs: one line per output line, prefixed with a
// timestamp, with workflow commands (`##[group]`, `##[error]`, ...) and ANSI
// colors inline. The log isn't split by step; `splitBySteps` uses the steps'
// start times from the jobs API to do that.

import type { WorkflowStep } from "./types";

export type LineKind = "plain" | "group" | "endgroup" | "error" | "warning" | "notice" | "debug" | "command";

export interface LogLine {
  /** Milliseconds since the epoch, or null for lines without a timestamp. */
  time: number | null;
  text: string;
  kind: LineKind;
}

const TIMESTAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?/;
const COMMANDS: [string, LineKind][] = [
  ["##[group]", "group"],
  ["##[endgroup]", "endgroup"],
  ["##[error]", "error"],
  ["##[warning]", "warning"],
  ["##[notice]", "notice"],
  ["##[debug]", "debug"],
  ["##[command]", "command"],
  ["[command]", "command"],
];

export function parseLog(text: string): LogLine[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((raw) => {
    const stamp = TIMESTAMP.exec(raw);
    const iso = stamp?.[1];
    const time = iso !== undefined ? Date.parse(iso) : null;
    let rest = stamp ? raw.slice(stamp[0].length) : raw;
    let kind: LineKind = "plain";
    for (const [prefix, k] of COMMANDS) {
      if (rest.startsWith(prefix)) {
        kind = k;
        rest = rest.slice(prefix.length);
        break;
      }
    }
    return { time: time !== null && Number.isNaN(time) ? null : time, text: rest, kind };
  });
}

/** Lines that open a step's output: run/uses steps, post steps, and "Complete job". */
const STEP_HEADER = /^(Post job cleanup\.|Cleaning up orphan processes)/;
const isHeader = (line: LogLine) => line.kind === "group" || STEP_HEADER.test(line.text);
const second = (ms: number) => Math.floor(ms / 1000);

/**
 * Assigns each line to the step that printed it, keyed by step number.
 * Steps report start times to the second, so within the second a step
 * starts in, its lines begin at its header line (e.g. `##[group]Run ...`);
 * without one, that second's lines stay with the previous step.
 */
export function splitBySteps(lines: LogLine[], steps: WorkflowStep[]): Map<number, LogLine[]> {
  const started = steps
    .flatMap((s) => (s.started_at !== null && s.started_at !== undefined && s.started_at !== "" ? [{ number: s.number, start: second(Date.parse(s.started_at)) }] : []))
    .filter((s) => !Number.isNaN(s.start))
    .sort((a, b) => (a.start !== b.start ? a.start - b.start : a.number - b.number));
  // Each step's lines, in the order of `started`; the map holds the same arrays.
  const buckets = started.map((): LogLine[] => []);
  const result = new Map<number, LogLine[]>(started.map((s, i) => [s.number, buckets[i] ?? []]));

  let current = 0;
  for (const line of lines) {
    if (line.time !== null) {
      const t = second(line.time);
      let next = started[current + 1];
      while (next !== undefined && (t > next.start || (t === next.start && isHeader(line)))) {
        current++;
        next = started[current + 1];
      }
    }
    buckets[current]?.push(line);
  }
  return result;
}

/** A line's content with nested `##[group]` sections, for collapsible rendering. */
export type LogNode = { type: "line"; line: LogLine } | { type: "group"; title: LogLine; children: LogNode[] };

export function groupLines(lines: LogLine[]): LogNode[] {
  const root: LogNode[] = [];
  const stack: LogNode[][] = [root];
  for (const line of lines) {
    const top = stack[stack.length - 1] ?? root;
    if (line.kind === "group") {
      const group: LogNode = { type: "group", title: line, children: [] };
      top.push(group);
      stack.push(group.children);
    } else if (line.kind === "endgroup") {
      if (stack.length > 1) stack.pop();
    } else {
      top.push({ type: "line", line });
    }
  }
  return root;
}

// ------------------------------------------------------------------- ANSI

export interface AnsiSpan {
  text: string;
  /** CSS classes, e.g. "ansi-bold ansi-fg-1". */
  className: string;
}

/** The escape character that starts ANSI sequences. */
const ESC = "\u001b";
// Built from a string: a control character in a regex literal reads like a mistake.
const ESCAPE = new RegExp(`${ESC}\\[([\\d;]*)([A-Za-z])`, "g");

/** Splits text into styled spans by its ANSI SGR codes; other escape codes are dropped. */
export function ansiSpans(text: string): AnsiSpan[] {
  if (!text.includes(`${ESC}[`)) return [{ text, className: "" }];
  const spans: AnsiSpan[] = [];
  let bold = false;
  let fg: number | null = null;
  let last = 0;
  const push = (chunk: string) => {
    if (chunk === "") return;
    const classes = [bold ? "ansi-bold" : "", fg !== null ? `ansi-fg-${fg.toString()}` : ""].filter((c) => c !== "").join(" ");
    spans.push({ text: chunk, className: classes });
  };
  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[2] !== "m") continue;
    const params = match[1] ?? "";
    // Only digits and ";" match, so each part is a number; an empty one means 0.
    const codes = params === "" ? [0] : params.split(";").map((part) => (part === "" ? 0 : Number.parseInt(part, 10)));
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === undefined) break;
      if (code === 0) {
        bold = false;
        fg = null;
      } else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code >= 30 && code <= 37) fg = code - 30;
      else if (code >= 90 && code <= 97) fg = code - 90 + 8;
      else if (code === 39) fg = null;
      else if (code === 38 && codes[i + 1] === 5) {
        // 256 colors: keep the 16 basic ones, drop the rest.
        const n = codes[i + 2];
        fg = n !== undefined && n < 16 ? n : null;
        i += 2;
      } else if (code === 38 && codes[i + 1] === 2) {
        fg = null;
        i += 4;
      } else if (code === 48) {
        i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
      }
    }
  }
  push(text.slice(last));
  return spans;
}
