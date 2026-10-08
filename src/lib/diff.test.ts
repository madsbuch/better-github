import { describe, expect, it } from "vitest";
import { anchorOf, hunkSides, intralineDiffs, parsePatch, suggestionBody, wordDiff } from "./diff";

const PATCH = [
  "@@ -1,4 +1,5 @@ fn main() {",
  " let a = 1;",
  "-let b = 2;",
  "+let b = 3;",
  "+let c = 4;",
  " let d = 5;",
  " let e = 6;",
  "@@ -10 +11 @@",
  "-old",
  "+new",
  "\\ No newline at end of file",
].join("\n");

describe("parsePatch", () => {
  const hunks = parsePatch(PATCH);

  it("splits hunks and reads headers", () => {
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldCount: 4, newStart: 1, newCount: 5, section: "fn main() {" });
    // Counts default to 1 when omitted.
    expect(hunks[1]).toMatchObject({ oldStart: 10, oldCount: 1, newStart: 11, newCount: 1 });
  });

  it("numbers old and new lines", () => {
    const lines = hunks[0].lines;
    expect(lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ["ctx", 1, 1],
      ["del", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["ctx", 3, 4],
      ["ctx", 4, 5],
    ]);
  });

  it("keeps the no-newline marker as meta", () => {
    expect(hunks[1].lines.at(-1)).toMatchObject({ kind: "meta", text: "No newline at end of file" });
  });

  it("treats empty lines inside a hunk as blank context but ignores a trailing newline", () => {
    const parsed = parsePatch("@@ -1,3 +1,3 @@\n a\n\n b\n");
    expect(parsed[0].lines.map((l) => l.kind)).toEqual(["ctx", "ctx", "ctx"]);
    expect(parsed[0].lines[1]).toMatchObject({ text: "", oldNo: 2, newNo: 2 });
  });

  it("handles empty input", () => {
    expect(parsePatch(undefined)).toEqual([]);
    expect(parsePatch("")).toEqual([]);
  });
});

describe("anchorOf", () => {
  const [hunk] = parsePatch(PATCH);
  it("anchors deletions on the left and everything else on the right", () => {
    expect(anchorOf(hunk.lines[1])).toEqual({ side: "LEFT", line: 2 });
    expect(anchorOf(hunk.lines[2])).toEqual({ side: "RIGHT", line: 2 });
    expect(anchorOf(hunk.lines[0])).toEqual({ side: "RIGHT", line: 1 });
  });
});

describe("hunkSides", () => {
  it("rebuilds the old and new text of a hunk", () => {
    const [hunk] = parsePatch(PATCH);
    const { oldText, newText } = hunkSides(hunk);
    expect(oldText).toBe("let a = 1;\nlet b = 2;\nlet d = 5;\nlet e = 6;");
    expect(newText).toBe("let a = 1;\nlet b = 3;\nlet c = 4;\nlet d = 5;\nlet e = 6;");
  });
});

describe("wordDiff", () => {
  it("marks only the changed tokens", () => {
    const result = wordDiff("let b = 2;", "let b = 3;");
    expect(result).not.toBeNull();
    const [oldSegs, newSegs] = result!;
    expect(oldSegs.filter((s) => s.changed).map((s) => s.text)).toEqual(["2"]);
    expect(newSegs.filter((s) => s.changed).map((s) => s.text)).toEqual(["3"]);
    expect(newSegs.map((s) => s.text).join("")).toBe("let b = 3;");
  });

  it("gives up when lines are unrelated", () => {
    expect(wordDiff("completely different", "nothing alike here")).toBeNull();
  });

  it("pairs deletion and addition runs inside a hunk", () => {
    const [hunk] = parsePatch(PATCH);
    const map = intralineDiffs(hunk);
    expect([...map.keys()].sort()).toEqual([1, 2]);
  });
});

describe("suggestionBody", () => {
  it("wraps lines in a suggestion block", () => {
    expect(suggestionBody(["const x = 1;"])).toBe("```suggestion\nconst x = 1;\n```\n");
  });
});
