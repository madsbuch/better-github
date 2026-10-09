import { describe, expect, it } from "vitest";
import { ansiSpans, groupLines, parseLog, splitBySteps } from "./logs";
import type { WorkflowStep } from "./types";

const LOG = [
  "﻿2026-10-09T10:35:43.1000000Z Current runner version: '2.330.0'",
  "2026-10-09T10:35:43.2000000Z ##[group]Operating System",
  "2026-10-09T10:35:43.2100000Z Ubuntu",
  "2026-10-09T10:35:43.2200000Z ##[endgroup]",
  "2026-10-09T10:35:44.0500000Z Complete job name: Build APK",
  "2026-10-09T10:35:44.5000000Z ##[group]Run actions/checkout@v5",
  "2026-10-09T10:35:44.5100000Z with:",
  "2026-10-09T10:35:44.5200000Z ##[endgroup]",
  "2026-10-09T10:35:45.0000000Z [command]/usr/bin/git version",
  "2026-10-09T10:35:46.0000000Z ##[group]Run npm test",
  "2026-10-09T10:35:46.1000000Z \u001b[36;1mnpm test\u001b[0m",
  "2026-10-09T10:35:47.0000000Z ##[error]Process completed with exit code 1.",
  "2026-10-09T10:35:47.5000000Z Post job cleanup.",
  "2026-10-09T10:35:47.6000000Z ##[warning]Node.js 20 is deprecated.",
  "",
].join("\n");

const step = (number: number, name: string, started: string | null, completed: string | null): WorkflowStep => ({
  number,
  name,
  status: started ? "completed" : "pending",
  conclusion: started ? "success" : null,
  started_at: started,
  completed_at: completed,
});

const STEPS = [
  step(1, "Set up job", "2026-10-09T10:35:43Z", "2026-10-09T10:35:44Z"),
  // Starts in the same second "Set up job" printed its last line.
  step(2, "Run actions/checkout@v5", "2026-10-09T10:35:44Z", "2026-10-09T10:35:45Z"),
  step(3, "Run npm test", "2026-10-09T10:35:46Z", "2026-10-09T10:35:47Z"),
  step(4, "Post Run actions/checkout@v5", "2026-10-09T10:35:47Z", "2026-10-09T10:35:47Z"),
  step(5, "Skipped step", null, null),
];

describe("parseLog", () => {
  it("strips timestamps and recognizes workflow commands", () => {
    const lines = parseLog(LOG);
    expect(lines).toHaveLength(14);
    expect(lines[0]).toEqual({ time: Date.parse("2026-10-09T10:35:43.100Z"), text: "Current runner version: '2.330.0'", kind: "plain" });
    expect(lines[1]).toMatchObject({ kind: "group", text: "Operating System" });
    expect(lines[3]).toMatchObject({ kind: "endgroup", text: "" });
    expect(lines[8]).toMatchObject({ kind: "command", text: "/usr/bin/git version" });
    expect(lines[11]).toMatchObject({ kind: "error", text: "Process completed with exit code 1." });
    expect(lines[13]).toMatchObject({ kind: "warning" });
  });

  it("keeps lines without a timestamp", () => {
    expect(parseLog("no stamp here")).toEqual([{ time: null, text: "no stamp here", kind: "plain" }]);
  });
});

describe("splitBySteps", () => {
  const byStep = splitBySteps(parseLog(LOG), STEPS);
  const texts = (n: number) => byStep.get(n)?.map((l) => l.text);

  it("splits at each step's header within the second it starts", () => {
    expect(texts(1)).toEqual(["Current runner version: '2.330.0'", "Operating System", "Ubuntu", "", "Complete job name: Build APK"]);
    expect(texts(2)).toEqual(["Run actions/checkout@v5", "with:", "", "/usr/bin/git version"]);
    expect(texts(3)).toEqual(["Run npm test", "\u001b[36;1mnpm test\u001b[0m", "Process completed with exit code 1."]);
    expect(texts(4)).toEqual(["Post job cleanup.", "Node.js 20 is deprecated."]);
  });

  it("gives steps that never started no lines", () => {
    expect(byStep.has(5)).toBe(false);
  });
});

describe("groupLines", () => {
  it("nests ##[group] sections", () => {
    const nodes = groupLines(parseLog(LOG).slice(0, 5));
    expect(nodes.map((n) => n.type)).toEqual(["line", "group", "line"]);
    const group = nodes[1];
    expect(group.type === "group" && group.children.map((c) => c.type === "line" && c.line.text)).toEqual(["Ubuntu"]);
  });
});

describe("ansiSpans", () => {
  it("maps SGR codes to classes and drops other escapes", () => {
    expect(ansiSpans("\u001b[1m\u001b[32m   Compiling\u001b[0m foo v1\u001b[K")).toEqual([
      { text: "   Compiling", className: "ansi-bold ansi-fg-2" },
      { text: " foo v1", className: "" },
    ]);
    expect(ansiSpans("plain")).toEqual([{ text: "plain", className: "" }]);
    expect(ansiSpans("\u001b[38;5;9mred\u001b[39m")).toEqual([{ text: "red", className: "ansi-fg-9" }]);
  });
});
