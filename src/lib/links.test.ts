import { describe, expect, it } from "vitest";
import { appLinkForUrl, htmlUrlForApiUrl } from "./links";
import { to } from "./nav";

describe("appLinkForUrl", () => {
  it.each([
    ["https://github.com/octo/repo/pull/12", to.pull("octo", "repo", 12)],
    ["https://github.com/octo/repo/pull/12/files", to.pull("octo", "repo", 12, "files")],
    ["https://github.com/octo/repo/pull/12#discussion_r1", to.pull("octo", "repo", 12)],
    ["https://github.com/octo/repo/issues/7", to.issue("octo", "repo", 7)],
    ["https://github.com/octo/repo/issues", to.repo("octo", "repo", { tab: "issues" })],
    ["https://github.com/octo/repo/pulls", to.repo("octo", "repo", { tab: "pulls" })],
    ["https://github.com/octo/repo", to.repo("octo", "repo")],
    ["https://github.com/octo/repo.git", to.repo("octo", "repo")],
    ["https://github.com/octo", to.user("octo")],
    ["https://github.com/octo/repo/commit/abcdef1234", to.commit("octo", "repo", "abcdef1234")],
    ["https://github.com/octo/repo/blob/main/src/a.ts", to.blob("octo", "repo", "main", "src/a.ts")],
    ["https://github.com/octo/repo/tree/main/src", to.tree("octo", "repo", "main", "src")],
    ["https://github.com/octo/repo/actions", to.repo("octo", "repo", { tab: "actions" })],
    ["https://github.com/octo/repo/actions/workflows/ci.yml", to.repo("octo", "repo", { tab: "actions" })],
    ["https://github.com/octo/repo/actions/runs/123", to.run("octo", "repo", 123)],
    ["https://github.com/octo/repo/actions/runs/123/attempts/2", to.run("octo", "repo", 123)],
    ["https://github.com/octo/repo/actions/runs/123/job/456", to.job("octo", "repo", 123, 456)],
    ["https://github.com/octo/repo/actions/runs/123/attempts/2/job/456", to.job("octo", "repo", 123, 456)],
    ["https://github.com/octo/repo/compare", to.compare("octo", "repo")],
    ["https://github.com/octo/repo/compare/feature/x", to.compare("octo", "repo", { head: "feature/x" })],
    ["https://github.com/octo/repo/compare/main...feature/x", to.compare("octo", "repo", { base: "main", head: "feature/x" })],
    ["https://github.com/octo/repo/compare/main...alice:fix", to.compare("octo", "repo", { base: "main", head: "fix", from: "alice/repo" })],
    ["https://github.com/octo/repo/pull/new/feature/x", to.compare("octo", "repo", { head: "feature/x" })],
    ["https://github.com/notifications", to.notifications()],
    ["https://api.github.com/repos/octo/repo/pulls/3", to.pull("octo", "repo", 3)],
    ["https://api.github.com/repos/octo/repo/issues/4", to.issue("octo", "repo", 4)],
    ["https://api.github.com/repos/octo/repo/actions/runs/9", to.run("octo", "repo", 9)],
    ["/octo/repo/pull/5", to.pull("octo", "repo", 5)],
  ])("%s", (url, target) => {
    expect(appLinkForUrl(url)).toEqual(target);
  });

  it.each([
    "https://example.com/octo/repo",
    "https://github.com/settings/tokens",
    "https://github.com/octo/repo/releases",
    "https://github.com/octo/repo/actions/runs/abc",
    "https://github.com/octo/repo/pull/12abc",
    "mailto:someone@example.com",
    "http://github.com/octo/repo",
  ])("%s opens externally", (url) => {
    expect(appLinkForUrl(url)).toBeNull();
  });
});

describe("htmlUrlForApiUrl", () => {
  it("maps API resources to their web pages", () => {
    expect(htmlUrlForApiUrl("https://api.github.com/repos/o/r/pulls/1")).toBe("https://github.com/o/r/pull/1");
    expect(htmlUrlForApiUrl("https://api.github.com/repos/o/r/issues/2")).toBe("https://github.com/o/r/issues/2");
    expect(htmlUrlForApiUrl("https://api.github.com/repos/o/r/commits/abc123")).toBe("https://github.com/o/r/commit/abc123");
    expect(htmlUrlForApiUrl("https://api.github.com/repos/o/r/releases/99")).toBe("https://github.com/o/r/releases");
  });
});
