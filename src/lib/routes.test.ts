import { describe, expect, it } from "vitest";
import { matchPath, paths } from "./routes";

describe("matchPath", () => {
  it("matches tab screens", () => {
    expect(matchPath("/").name).toBe("inbox");
    expect(matchPath("/?filter=created").query.get("filter")).toBe("created");
    expect(matchPath("/notifications").name).toBe("notifications");
    expect(matchPath("/repos").name).toBe("repos");
    expect(matchPath("/profile").name).toBe("profile");
  });

  it("matches GitHub-shaped paths", () => {
    expect(matchPath("/octo")).toMatchObject({ name: "user", params: { owner: "octo" } });
    expect(matchPath("/octo/repo")).toMatchObject({ name: "repo", params: { owner: "octo", repo: "repo" } });
    expect(matchPath("/octo/repo/pull/12?tab=files")).toMatchObject({ name: "pull", params: { number: "12" } });
    expect(matchPath("/octo/repo/issues/3")).toMatchObject({ name: "issue", params: { number: "3" } });
    expect(matchPath("/octo/repo/commit/abc1234")).toMatchObject({ name: "commit", params: { sha: "abc1234" } });
    expect(matchPath("/octo/repo/blob?ref=main&path=a%2Fb.ts").query.get("path")).toBe("a/b.ts");
  });

  it("rejects malformed paths", () => {
    expect(matchPath("/octo/repo/pull/abc").name).toBe("notFound");
    expect(matchPath("/a/b/c/d/e").name).toBe("notFound");
  });

  it("round-trips builders", () => {
    expect(matchPath(paths.pull("my-org", "my.repo", 5, "checks"))).toMatchObject({
      name: "pull",
      params: { owner: "my-org", repo: "my.repo", number: "5" },
    });
    expect(paths.tree("o", "r", "feature/x", "src/lib")).toBe("/o/r/tree?ref=feature%2Fx&path=src%2Flib");
    expect(matchPath(paths.tree("o", "r", "feature/x", "src/lib")).query.get("ref")).toBe("feature/x");
  });
});
