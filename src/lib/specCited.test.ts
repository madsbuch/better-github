// Spec: S32
import { describe, expect, it } from "vitest";
import { citedPaths, citedQuery, citesRequirement } from "./specCited";

describe("where the code cites a requirement", () => {
  it("asks for files that say Spec: and the id, in the repository", () => {
    expect(citedQuery("acme", "rocket", "RET-1")).toBe('"Spec:" "RET-1" repo:acme/rocket');
  });

  it("takes the id only as an id of its own, on a Spec: line", () => {
    expect(citesRequirement("// Spec: RET-1", "RET-1")).toBe(true);
    expect(citesRequirement("  /* Spec: K3, RET-1, RET-2 */", "RET-1")).toBe(true);
    expect(citesRequirement("# Spec: RET-1.", "RET-1")).toBe(true);
    // Another requirement whose id starts the same.
    expect(citesRequirement("// Spec: RET-10, RET-12", "RET-1")).toBe(false);
    expect(citesRequirement("// Spec: S15", "S1")).toBe(false);
    expect(citesRequirement("// Spec: XRET-1", "RET-1")).toBe(false);
    expect(citesRequirement("// Spec: retry.max.limit", "retry.max")).toBe(false);
    // The id on a line without Spec:, or on the line after it.
    expect(citesRequirement("const RET-1 = 2;", "RET-1")).toBe(false);
    expect(citesRequirement("// Spec: K3\n// see RET-1", "RET-1")).toBe(false);
  });

  it("lists each file once, by path, and keeps a result GitHub gave no text for", () => {
    expect(
      citedPaths(
        [
          { path: "src/retry.ts", fragments: ["// Spec: RET-1, RET-2"] },
          { path: "e2e/retry.spec.ts", fragments: ["  // Spec: RET-1", "// Spec: RET-1"] },
          { path: "src/other.ts", fragments: ["// Spec: RET-10"] },
          { path: "docs/notes.md", fragments: [] },
          { path: "src/retry.ts", fragments: ["// Spec: RET-1"] },
        ],
        "RET-1",
      ),
    ).toEqual(["docs/notes.md", "e2e/retry.spec.ts", "src/retry.ts"]);
  });
});
