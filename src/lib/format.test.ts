import { describe, expect, it } from "vitest";
import { compactNumber, formatDuration, labelTextColor, timeAgo } from "./format";
import { parseLink } from "./api";

describe("timeAgo", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  it.each([
    ["2026-06-15T11:59:50Z", "now"],
    ["2026-06-15T11:55:00Z", "5m"],
    ["2026-06-15T09:00:00Z", "3h"],
    ["2026-06-13T12:00:00Z", "2d"],
  ])("%s -> %s", (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });

  it("shows dates for older items", () => {
    expect(timeAgo("2026-03-04T12:00:00Z", now)).toBe("Mar 4");
    expect(timeAgo("2023-03-04T12:00:00Z", now)).toBe("Mar 4, 2023");
  });
});

describe("compactNumber", () => {
  it("abbreviates", () => {
    expect(compactNumber(999)).toBe("999");
    expect(compactNumber(1234)).toBe("1.2k");
    expect(compactNumber(12000)).toBe("12k");
    expect(compactNumber(250_000)).toBe("250k");
    expect(compactNumber(1_500_000)).toBe("1.5m");
  });
});

describe("formatDuration", () => {
  it("formats spans", () => {
    expect(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:42Z")).toBe("42s");
    expect(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:03:05Z")).toBe("3m 5s");
    expect(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T01:10:00Z")).toBe("1h 10m");
    expect(formatDuration(null, "2026-01-01T00:00:00Z")).toBe("");
  });
});

describe("labelTextColor", () => {
  it("picks readable text", () => {
    expect(labelTextColor("ffffff")).toBe("#1f2328");
    expect(labelTextColor("000000")).toBe("#ffffff");
    expect(labelTextColor("d73a4a")).toBe("#ffffff");
  });
});

describe("parseLink", () => {
  it("parses pagination links", () => {
    const header =
      '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"';
    expect(parseLink(header)).toEqual({
      next: "https://api.github.com/user/repos?page=2",
      last: "https://api.github.com/user/repos?page=5",
    });
    expect(parseLink(null)).toEqual({});
  });
});
