import { describe, expect, it } from "vitest";
import { searchBranches, type Branch } from "./branchSearch";

const day = (n: number) => new Date(Date.UTC(2026, 9, 9 - n)).toISOString();
const b = (name: string, daysAgo: number | null = 1): Branch => ({ name, committedDate: daysAgo === null ? null : day(daysAgo) });

const BRANCHES: Branch[] = [
  b("dave/authenticom-staging-follow-up", 1),
  b("dave/bump-staging-version", 2),
  b("dave/eng-629-vehicle-inventory-staging", 3),
  b("dave/fix-staging-deployment", 4),
  b("dave/fix-staging-form-fields", 5),
  b("prestaging-checks", 6),
  b("staging-hotfix", 30),
  b("release/staging", 60),
  b("staging", 90),
  b("main", 7),
  b("team/staging-lint", 8),
];

const names = (query: string, pinned?: string[]) => searchBranches(BRANCHES, query, pinned).map((m) => m.branch.name);

describe("searchBranches", () => {
  it("puts the branch you named first, however old it is", () => {
    expect(names("staging")).toEqual([
      "staging",
      "release/staging",
      "staging-hotfix",
      "team/staging-lint",
      // Then where a word starts, newest first.
      "dave/authenticom-staging-follow-up",
      "dave/bump-staging-version",
      "dave/eng-629-vehicle-inventory-staging",
      "dave/fix-staging-deployment",
      "dave/fix-staging-form-fields",
      "prestaging-checks",
    ]);
  });

  it("ignores case and needs every word, in any order", () => {
    expect(names("Deploy STAGING")).toEqual(["dave/fix-staging-deployment"]);
    expect(names("fix dave form")).toEqual(["dave/fix-staging-form-fields"]);
  });

  it("finds names typed without their separators", () => {
    expect(names("eng629")[0]).toBe("dave/eng-629-vehicle-inventory-staging");
    expect(names("stghot")).toEqual(["staging-hotfix"]);
  });

  it("leaves out letters scattered across a long name", () => {
    expect(names("dvy")).toEqual([]);
    expect(names("zzz")).toEqual([]);
  });

  it("marks what matched", () => {
    const [top] = searchBranches(BRANCHES, "fix deploy");
    expect(top.branch.name).toBe("dave/fix-staging-deployment");
    expect(top.ranges).toEqual([
      [5, 8],
      [17, 23],
    ]);
    const [fuzzy] = searchBranches([b("dave/eng-629-x")], "eng629");
    expect(fuzzy.ranges).toEqual([
      [5, 8],
      [9, 12],
    ]);
  });

  it("without a search, lists pinned branches first, then newest first", () => {
    expect(names("", ["main"]).slice(0, 4)).toEqual(["main", "dave/authenticom-staging-follow-up", "dave/bump-staging-version", "dave/eng-629-vehicle-inventory-staging"]);
  });

  it("prefers pinned branches between equally good matches", () => {
    const branches = [b("mainline", 1), b("main-old", 2), b("maintenance", 3)];
    expect(searchBranches(branches, "main", ["maintenance"]).map((m) => m.branch.name)).toEqual(["maintenance", "mainline", "main-old"]);
  });

  it("keeps one of each branch, preferring the one with a date", () => {
    const matches = searchBranches([b("main", null), b("main", 3), b("dev", null)], "");
    expect(matches.map((m) => [m.branch.name, m.branch.committedDate])).toEqual([
      ["main", day(3)],
      ["dev", null],
    ]);
  });
});
