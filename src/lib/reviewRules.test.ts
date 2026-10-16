import { describe, expect, it } from "vitest";
import { compilePattern, NO_RULES, parseReviewRules, reviewFile, RULES_FILE } from "./reviewRules";

const matches = (pattern: string, path: string) => compilePattern(pattern)!.test(path);

describe("patterns", () => {
  it.each([
    // Without a "/", at any depth.
    ["*.md", "README.md", true],
    ["*.md", "docs/adr/0001-record.md", true],
    ["*", "apps/backend/src/main.ts", true],
    ["prisma/", "apps/backend/prisma/migrations/1/migration.sql", true],
    ["prisma/", "prisma", false],
    // With a "/", from the root.
    ["/README.md", "README.md", true],
    ["/README.md", "docs/README.md", false],
    ["docs/*.md", "docs/index.md", true],
    ["docs/*.md", "docs/adr/0001.md", false],
    ["apps/backend/prisma", "apps/backend/prisma/schema.prisma", true],
    ["apps/backend/prisma", "apps/backend/prismatic.ts", false],
    // "*" stays in a folder, "**" crosses them.
    ["apps/*/src/**", "apps/backoffice/src/pages/Deals.tsx", true],
    ["apps/*/src/**", "apps/backoffice/public/logo.svg", false],
    ["docs/**/*.md", "docs/articles/security/tokens.md", true],
    ["docs/**/*.md", "docs/index.md", true],
    ["**/*.test.ts", "packages/lib/auth/session.test.ts", true],
    ["**/*.test.ts", "session.test.ts", true],
    ["**/test/**", "apps/backend/test/deals.spec.ts", true],
    [".github/workflows/**", ".github/workflows/deploy.yml", true],
    ["src/?.ts", "src/a.ts", true],
    ["src/?.ts", "src/ab.ts", false],
    // Dots and other regex characters are plain characters.
    ["*.md", "READMEXmd", false],
    ["package-lock.json", "apps/consumer/package-lock.json", true],
  ])("%s on %s: %s", (pattern, path, expected) => {
    expect(matches(pattern, path)).toBe(expected);
  });

  it("rejects empty patterns", () => {
    expect(compilePattern("/")).toBeNull();
    expect(compilePattern("a//b")).toBeNull();
  });
});

const RULES = `
# What to check, and how carefully.

high apps/backend/prisma/**
  - Migrations run on production data: safe while the previous release
    still runs, and reversible.

high packages/lib/auth/**   # who can do what
  - Check every role.
  - One dealership never sees another's data.

medium apps/*/src/** !apps/*/src/**/*.test.ts
  - Errors reach the user with something they can act on.

medium packages/lib/auth/**
  - One dealership never sees another's data.

low **/*.test.ts docs/**
  - The test fails if the change it covers is reverted.

low *.lock

unmatched low
  - Nothing covers this yet.
`;

const rules = parseReviewRules(RULES);
const review = (path: string, previous?: string) => reviewFile(rules, path, previous);

describe("parseReviewRules", () => {
  it("reads rules, their instructions and the default for unmatched files", () => {
    expect(rules.warnings).toEqual([]);
    expect(rules.rules.map((r) => [r.risk, r.include.map((i) => i.pattern), r.instructions.length])).toEqual([
      ["high", ["apps/backend/prisma/**"], 1],
      ["high", ["packages/lib/auth/**"], 2],
      ["medium", ["apps/*/src/**"], 1],
      ["medium", ["packages/lib/auth/**"], 1],
      ["low", ["**/*.test.ts", "docs/**"], 1],
      ["low", ["*.lock"], 0],
    ]);
    // Indented lines without a dash continue the item above.
    expect(rules.rules[0].instructions).toEqual(["Migrations run on production data: safe while the previous release still runs, and reversible."]);
    expect(rules.unmatched).toEqual({ risk: "low", instructions: ["Nothing covers this yet."] });
  });

  it("reports lines it can't read and leaves them out", () => {
    const parsed = parseReviewRules(
      ["  - No rule above me", "hihg src/**", "  - Belongs to the broken rule", "medium !src/**", "unmatched", "low src/** a//b", "unmatched low", "unmatched high"].join("\n"),
    );
    expect(parsed.warnings).toEqual([
      { line: 1, message: "Instructions need a rule line above them." },
      { line: 2, message: `"hihg" isn't low, medium or high.` },
      { line: 4, message: "The medium rule needs at least one path." },
      { line: 5, message: 'Write "unmatched low", "unmatched medium" or "unmatched high".' },
      { line: 6, message: `"a//b" isn't a path pattern.` },
      { line: 8, message: 'Only the first "unmatched" line counts.' },
    ]);
    expect(parsed.rules.map((r) => r.include.map((i) => i.pattern))).toEqual([["src/**"]]);
    expect(parsed.unmatched.risk).toBe("low");
  });

  it("without an unmatched line, files no rule covers are medium", () => {
    expect(reviewFile(parseReviewRules("low docs/**"), "src/main.ts")).toEqual({
      risk: "medium",
      instructions: [{ risk: "medium", text: "No rule covers this file." }],
      matched: [],
      unmatched: true,
    });
  });
});

describe("reviewFile", () => {
  it("gives the highest risk and every instruction of every matching rule", () => {
    const auth = review("packages/lib/auth/session.ts");
    expect(auth.risk).toBe("high");
    expect(auth.instructions).toEqual([
      { risk: "high", text: "Check every role." },
      { risk: "high", text: "One dealership never sees another's data." },
      { risk: "medium", text: "One dealership never sees another's data." },
    ]);
    expect(auth.matched).toEqual(["packages/lib/auth/** (high)", "packages/lib/auth/** (medium)"]);
  });

  it("lists an instruction once when several patterns of a rule match", () => {
    expect(review("docs/how-to/x.test.ts").instructions).toEqual([{ risk: "low", text: "The test fails if the change it covers is reverted." }]);
  });

  it("leaves files out of a rule with !, without lowering other rules", () => {
    expect(review("apps/consumer/src/Cart.tsx").risk).toBe("medium");
    expect(review("apps/consumer/src/Cart.test.ts")).toMatchObject({ risk: "low", matched: ["**/*.test.ts (low)"] });
  });

  it("can't make a file lower than its highest rule", () => {
    expect(review("apps/backend/prisma/seed.test.ts").risk).toBe("high");
  });

  it("uses a rule's risk even without instructions", () => {
    expect(review("Cargo.lock")).toEqual({ risk: "low", instructions: [], matched: ["*.lock (low)"], unmatched: false });
  });

  it("judges a renamed file by both its paths", () => {
    expect(review("apps/backend/src/schema.prisma", "apps/backend/prisma/schema.prisma").risk).toBe("high");
  });

  it("falls back to the unmatched rule", () => {
    expect(review("emails/html/welcome.html")).toEqual({
      risk: "low",
      instructions: [{ risk: "low", text: "Nothing covers this yet." }],
      matched: [],
      unmatched: true,
    });
  });

  it("always rates changes to the rules file high", () => {
    const own = reviewFile(parseReviewRules(`low ${RULES_FILE}\n  - Typos only.`), RULES_FILE);
    expect(own.risk).toBe("high");
    expect(own.instructions.map((i) => i.text)).toEqual([
      "This file decides how every change is reviewed. Check that no rule was weakened or removed.",
      "Typos only.",
    ]);
    expect(reviewFile(NO_RULES, RULES_FILE).risk).toBe("high");
    expect(reviewFile(rules, "docs/rules.md", RULES_FILE).risk).toBe("high");
  });
});
