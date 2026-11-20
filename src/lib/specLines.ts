// Where things are in a spec item's file, so that a comment on a requirement
// can be put on a line of the JSON: review comments on GitHub belong to lines.

import { anchorOf, type DiffLine, type Hunk, type Side } from "./diff";

/** First and last line (from 1) of a value in a JSON text. */
export interface LineSpan {
  start: number;
  end: number;
}

/**
 * The lines of every value in a JSON text, by its path: "title",
 * "requirements/2", "requirements/2/text". An object member's span starts at
 * its key. Text that isn't JSON gives what was read before it went wrong.
 */
export function jsonLines(text: string): Map<string, LineSpan> {
  const spans = new Map<string, LineSpan>();
  let at = 0;
  let line = 1;

  const fail = (): never => {
    throw new SyntaxError("not JSON");
  };
  const space = () => {
    for (; at < text.length; at++) {
      const char = text[at];
      if (char === "\n") line++;
      else if (char !== " " && char !== "\t" && char !== "\r") break;
    }
  };
  const string = (): string => {
    if (text[at] !== '"') fail();
    const start = ++at;
    for (; at < text.length && text[at] !== '"'; at++) {
      if (text[at] === "\\") at++;
      // Not valid inside a JSON string, but count it so later lines stay right.
      else if (text[at] === "\n") line++;
    }
    if (at >= text.length) fail();
    return text.slice(start, at++);
  };
  const value = (path: string, from: number) => {
    space();
    const char = text[at];
    if (char === "{" || char === "[") {
      const close = char === "{" ? "}" : "]";
      at++;
      space();
      for (let index = 0; text[at] !== close; index++) {
        if (index > 0) {
          if (text[at] !== ",") fail();
          at++;
          space();
        }
        const memberLine = line;
        let key = index.toString();
        if (char === "{") {
          key = string();
          space();
          if (text[at] !== ":") fail();
          at++;
        }
        value(path === "" ? key : `${path}/${key}`, memberLine);
        space();
        if (at >= text.length) fail();
      }
      at++;
    } else if (char === '"') {
      string();
    } else {
      const start = at;
      while (at < text.length && /[-+.\w]/.test(text[at] ?? "")) at++;
      if (at === start) fail();
    }
    spans.set(path, { start: from, end: line });
  };

  try {
    space();
    value("", line);
  } catch {
    // Keep what was found.
  }
  return spans;
}

/** The lines of the requirement with this id, in an item's file. */
export function requirementSpan(text: string, spans: Map<string, LineSpan>, id: string): LineSpan | null {
  let index = -1;
  try {
    const parsed: unknown = JSON.parse(text);
    const requirements: unknown = typeof parsed === "object" && parsed !== null && "requirements" in parsed ? parsed.requirements : null;
    if (Array.isArray(requirements)) {
      index = requirements.findIndex((r: unknown) => typeof r === "object" && r !== null && "id" in r && r.id === id);
    }
  } catch {
    return null;
  }
  return index === -1 ? null : (spans.get(`requirements/${index}`) ?? null);
}

/** A line of a pull request's diff that a comment can be put on. */
export interface CommentLine {
  side: Side;
  number: number;
  line: DiffLine;
}

/**
 * The line to comment on for something that spans `span` on one side of a
 * file's diff: a line the pull request changed there if there is one, else
 * any line of the diff within the span. Null when the diff doesn't reach it;
 * GitHub only takes comments on lines a diff shows.
 */
export function commentLine(hunks: Hunk[], side: Side, span: LineSpan | null): CommentLine | null {
  if (span === null) return null;
  let fallback: CommentLine | null = null;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const anchor = anchorOf(line);
      if (anchor === null || anchor.side !== side || anchor.line < span.start || anchor.line > span.end) continue;
      const found = { side, number: anchor.line, line };
      if (line.kind !== "ctx") return found;
      fallback ??= found;
    }
  }
  return fallback;
}
