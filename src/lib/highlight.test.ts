import hljs from "highlight.js/lib/common";
import { describe, expect, it } from "vitest";
import { highlightLines, htmlToTokenLines, languageForPath, overlaySegments } from "./highlight";

describe("languageForPath", () => {
  it("detects common languages", () => {
    // Aliases are fine as long as highlight.js knows them.
    expect(hljs.getLanguage(languageForPath("src/main.rs")!)?.name).toBe("Rust");
    expect(hljs.getLanguage(languageForPath("lib/app.py")!)?.name).toBe("Python");
    expect(languageForPath("App.tsx")).toBe("typescript");
    expect(languageForPath("Dockerfile")).toBe("dockerfile");
    expect(languageForPath("build.gradle.kts")).toBe("kotlin");
    expect(languageForPath("README")).toBeUndefined();
  });
});

describe("htmlToTokenLines", () => {
  it("carries open spans across line breaks and decodes entities", () => {
    const lines = htmlToTokenLines('<span class="hljs-comment">/* a\nb */</span> x &lt; y');
    expect(lines).toEqual([
      [{ text: "/* a", cls: "hl-comment" }],
      [
        { text: "b */", cls: "hl-comment" },
        { text: " x < y", cls: undefined },
      ],
    ]);
  });
});

describe("highlightLines", () => {
  it("returns one entry per line and preserves text", () => {
    const code = "fn main() {\n    println!(\"<hi>\");\n}";
    const lines = highlightLines(code, "rust");
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.map((t) => t.text).join("")).join("\n")).toBe(code);
  });

  it("falls back to plain text without a language", () => {
    expect(highlightLines("a\n\nb")).toEqual([[{ text: "a" }], [], [{ text: "b" }]]);
  });
});

describe("overlaySegments", () => {
  it("splits syntax tokens at word-diff boundaries", () => {
    const out = overlaySegments(
      [
        { text: "let ", cls: "kw" },
        { text: "b = 3;" },
      ],
      [
        { text: "let b = ", changed: false },
        { text: "3", changed: true },
        { text: ";", changed: false },
      ],
    );
    expect(out.map((t) => t.text).join("")).toBe("let b = 3;");
    expect(out.filter((t) => t.changed).map((t) => t.text)).toEqual(["3"]);
    expect(out[0]).toMatchObject({ text: "let ", cls: "kw", changed: false });
  });
});
