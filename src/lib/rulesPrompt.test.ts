import { describe, expect, it } from "vitest";
import { parseReviewRules } from "./reviewRules";
import { rulesPrompt } from "./rulesPrompt";

const setup = rulesPrompt({ repo: "acme/rocket", branch: "main", current: null });

describe("rulesPrompt", () => {
  it("teaches the format with an example the app reads without warnings", () => {
    const example = (/## The format\n\n([\s\S]*?)\n\n- /.exec(setup)?.[1] ?? "").replace(/^ {4}/gm, "");
    const rules = parseReviewRules(example);
    expect(rules.warnings).toEqual([]);
    expect(rules.rules.map((r) => r.risk)).toEqual(["high", "medium", "low", "low"]);
    expect(rules.unmatched.risk).toBe("medium");
  });

  it("asks for a new file when there is none", () => {
    expect(setup).toMatch(/^Set up review rules for acme\/rocket: write a `\.review-rules` file at its root\./);
    expect(setup).toContain("The app reads the rules from main, the branch pull requests merge into");
    expect(setup).not.toContain("## The current rules");
  });

  it("hands over the current rules and what's wrong with them", () => {
    const text = "high src/**\n  - Check it.\nhihg docs/**\n";
    const prompt = rulesPrompt({ repo: "acme/rocket", branch: "develop", current: { text, warnings: parseReviewRules(text).warnings } });
    expect(prompt).toMatch(/^Improve the review rules of acme\/rocket/);
    expect(prompt).toContain("## The current rules (on develop)\n\n    high src/**\n      - Check it.\n    hihg docs/**\n");
    expect(prompt).toContain(`- Line 3: "hihg" isn't low, medium or high.`);
  });
});
