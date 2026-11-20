import { describe, expect, it } from "vitest";
import { parsePatch } from "./diff";
import { commentLine, jsonLines, requirementSpan } from "./specLines";

const TEXT = `{
  "title": "Retries",
  "description": "Line one.\\nStill the same line, with a \\"quote\\" and a brace }.",
  "requirements": [
    { "id": "R1", "text": "One line." },
    {
      "id": "R2",
      "text": "Several lines.",
      "level": "should"
    }
  ],
  "code": ["a", "b"]
}
`;

describe("jsonLines", () => {
  const spans = jsonLines(TEXT);

  it("finds the lines of every value, starting at its key", () => {
    expect(spans.get("title")).toEqual({ start: 2, end: 2 });
    expect(spans.get("description")).toEqual({ start: 3, end: 3 });
    expect(spans.get("requirements")).toEqual({ start: 4, end: 11 });
    expect(spans.get("requirements/0")).toEqual({ start: 5, end: 5 });
    expect(spans.get("requirements/1")).toEqual({ start: 6, end: 10 });
    expect(spans.get("requirements/1/level")).toEqual({ start: 9, end: 9 });
    expect(spans.get("code/1")).toEqual({ start: 12, end: 12 });
    expect(spans.get("")).toEqual({ start: 1, end: 13 });
  });

  it("finds a requirement by its id", () => {
    expect(requirementSpan(TEXT, spans, "R2")).toEqual({ start: 6, end: 10 });
    expect(requirementSpan(TEXT, spans, "R9")).toBeNull();
    expect(requirementSpan("{ nope", jsonLines("{ nope"), "R1")).toBeNull();
  });

  it("keeps what it read of text that isn't JSON", () => {
    const broken = jsonLines('{\n  "title": "A",\n  "summary": ]\n}');
    expect(broken.get("title")).toEqual({ start: 2, end: 2 });
    expect(broken.has("")).toBe(false);
  });
});

describe("commentLine", () => {
  // Lines 7 to 9 of the new file are in the diff; 8 was changed (old line 8 too).
  const hunks = parsePatch('@@ -7,3 +7,3 @@\n       "id": "R2",\n-      "text": "Some lines.",\n+      "text": "Several lines.",\n       "level": "should"');

  it("prefers a line the pull request changed, on the side asked for", () => {
    expect(commentLine(hunks, "RIGHT", { start: 6, end: 10 })).toMatchObject({ side: "RIGHT", number: 8, line: { kind: "add" } });
    expect(commentLine(hunks, "LEFT", { start: 6, end: 10 })).toMatchObject({ side: "LEFT", number: 8, line: { kind: "del" } });
  });

  it("falls back to an unchanged line of the diff, and gives up outside it", () => {
    expect(commentLine(hunks, "RIGHT", { start: 9, end: 9 })).toMatchObject({ number: 9, line: { kind: "ctx" } });
    expect(commentLine(hunks, "RIGHT", { start: 2, end: 2 })).toBeNull();
    expect(commentLine(hunks, "LEFT", { start: 9, end: 9 })).toBeNull();
    expect(commentLine(hunks, "RIGHT", null)).toBeNull();
  });
});
