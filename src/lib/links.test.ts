import { describe, expect, it } from "vitest";
import { appPathForUrl, htmlUrlForApiUrl } from "./links";

describe("appPathForUrl", () => {
  it.each([
    ["https://github.com/octo/repo/pull/12", "/octo/repo/pull/12"],
    ["https://github.com/octo/repo/pull/12/files", "/octo/repo/pull/12?tab=files"],
    ["https://github.com/octo/repo/pull/12#discussion_r1", "/octo/repo/pull/12"],
    ["https://github.com/octo/repo/issues/7", "/octo/repo/issues/7"],
    ["https://github.com/octo/repo/issues", "/octo/repo?tab=issues"],
    ["https://github.com/octo/repo/pulls", "/octo/repo?tab=pulls"],
    ["https://github.com/octo/repo", "/octo/repo"],
    ["https://github.com/octo/repo.git", "/octo/repo"],
    ["https://github.com/octo", "/octo"],
    ["https://github.com/octo/repo/commit/abcdef1234", "/octo/repo/commit/abcdef1234"],
    ["https://github.com/octo/repo/blob/main/src/a.ts", "/octo/repo/blob?ref=main&path=src%2Fa.ts"],
    ["https://github.com/octo/repo/tree/main/src", "/octo/repo/tree?ref=main&path=src"],
    ["https://github.com/notifications", "/notifications"],
    ["https://api.github.com/repos/octo/repo/pulls/3", "/octo/repo/pull/3"],
    ["https://api.github.com/repos/octo/repo/issues/4", "/octo/repo/issues/4"],
    ["/octo/repo/pull/5", "/octo/repo/pull/5"],
  ])("%s -> %s", (url, path) => {
    expect(appPathForUrl(url)).toBe(path);
  });

  it.each([
    "https://example.com/octo/repo",
    "https://github.com/settings/tokens",
    "https://github.com/octo/repo/actions/runs/1",
    "https://github.com/octo/repo/releases",
    "mailto:someone@example.com",
    "http://github.com/octo/repo",
  ])("%s opens externally", (url) => {
    expect(appPathForUrl(url)).toBeNull();
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
