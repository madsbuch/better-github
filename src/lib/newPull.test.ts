import { describe, expect, it } from "vitest";
import { headSpec, recentBranches, suggestedBody, suggestedTitle } from "./newPull";
import type { BranchTip, BranchesRepo, RestComparison } from "./types";

const commit = (message: string) => ({ commit: { message } }) as RestComparison["commits"][number];

describe("headSpec", () => {
  it("names fork branches with their owner", () => {
    expect(headSpec("acme/rocket", { repo: "acme/rocket", branch: "fix" })).toBe("fix");
    expect(headSpec("acme/rocket", { repo: "ACME/Rocket", branch: "fix" })).toBe("fix");
    expect(headSpec("acme/rocket", { repo: "alice/rocket", branch: "fix" })).toBe("alice:fix");
  });
});

describe("suggestions", () => {
  it("titles one commit by its subject, several by the branch", () => {
    expect(suggestedTitle("fix/upload-retries", [commit("Retry uploads\n\nWith backoff.")])).toBe("Retry uploads");
    expect(suggestedTitle("fix/upload-retries", [commit("a"), commit("b")])).toBe("Fix/upload retries");
    expect(suggestedTitle("dark_mode", [commit("a"), commit("b")])).toBe("Dark mode");
  });

  it("describes with the template, else a single commit's body", () => {
    expect(suggestedBody("## What\n", [commit("Subject\n\nBody")])).toBe("## What\n");
    expect(suggestedBody(null, [commit("Subject\n\nBody text")])).toBe("Body text");
    expect(suggestedBody(null, [commit("a"), commit("b")])).toBe("");
  });
});

describe("recentBranches", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const tip = (name: string, login: string, hoursAgo: number, open = 0): BranchTip => ({
    name,
    associatedPullRequests: { totalCount: open },
    target: {
      oid: `${name}-sha`,
      committedDate: new Date(now - hoursAgo * 3600_000).toISOString(),
      messageHeadline: `Work on ${name}`,
      author: { user: { login } },
    },
  });
  const repo = (nameWithOwner: string, refs: BranchTip[], parent?: string): BranchesRepo => ({
    nameWithOwner,
    defaultBranchRef: { name: "main" },
    parent: parent ? { nameWithOwner: parent, defaultBranchRef: { name: "trunk" } } : null,
    refs: { nodes: refs },
  });

  it("keeps the viewer's fresh branches without a pull request, newest first", () => {
    const found = recentBranches(
      [
        repo("acme/rocket", [
          tip("main", "octocat", 1),
          tip("older", "octocat", 30),
          tip("has-pr", "octocat", 1, 1),
          tip("someone-elses", "alice", 1),
          tip("stale", "octocat", 72),
          tip("newer", "OctoCat", 2),
        ]),
        repo("octocat/rocket", [tip("fork-fix", "octocat", 5)], "acme/rocket"),
      ],
      "octocat",
      now,
    );
    expect(found.map((b) => b.head.branch)).toEqual(["newer", "fork-fix", "older"]);
    expect(found[0]).toMatchObject({ baseRepo: "acme/rocket", base: "main", head: { repo: "acme/rocket" } });
    // A fork's branch goes to the fork's parent, into the parent's default branch.
    expect(found[1]).toMatchObject({ baseRepo: "acme/rocket", base: "trunk", head: { repo: "octocat/rocket" } });
  });
});
