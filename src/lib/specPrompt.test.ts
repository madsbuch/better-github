import { describe, expect, it } from "vitest";
import { buildSpec, SpecItem, type SpecFile } from "./spec";
import llmsFile from "../../spec-llms.txt?raw";
import { SPEC_PROMPT_EXAMPLE, specConsistencyPrompt, specLlmsText, specPrompt } from "./specPrompt";

const file = (path: string, value: unknown): SpecFile => ({ path, text: JSON.stringify(value), truncated: false });
const setup = specPrompt({ repo: "acme/rocket", branch: "main", current: null });

describe("specPrompt", () => {
  it("teaches the format with an item the app reads, in a layout without problems", () => {
    expect(SpecItem.safeParse(SPEC_PROMPT_EXAMPLE).success).toBe(true);
    expect(setup).toContain(`    ${JSON.stringify(SPEC_PROMPT_EXAMPLE, null, 2).split("\n").join("\n    ")}`);
    // The folder the prompt draws, with the example where it says it is.
    const spec = buildSpec([
      file("index.json", { title: "Rocket" }),
      file("uploads/index.json", { title: "Uploads" }),
      file("uploads/retries.json", SPEC_PROMPT_EXAMPLE),
      file("uploads/errors.json", { title: "Errors", requirements: [{ id: "ERR-1", text: "The caller gets the server's message." }] }),
      file("uploads/resume.json", { title: "Resuming", requirements: [{ id: "RES-1", text: "A retry resumes where the upload stopped." }] }),
      file("cli.json", { title: "Command line" }),
      { path: "assets/backoff.png", text: null, truncated: false },
    ]);
    expect(spec.problems).toEqual([]);
  });

  it("includes the schema itself, since the agent may not be able to fetch it", () => {
    expect(setup).toContain('"additionalProperties": false');
    expect(setup).toContain('"deprecation"');
    expect(setup).toContain("There is no status.");
  });

  it("asks for a new folder when there is none, for a project with or without code", () => {
    expect(setup).toMatch(/^Set up a spec for acme\/rocket: write a `\.spec` folder at its root\./);
    expect(setup).toContain("The repository has code.");
    expect(setup).toContain("The repository is new or nearly empty.");
    expect(setup).toContain("Write `.spec/index.json` first");
    expect(setup).not.toContain("## The current spec");
  });

  it("hands over the current outline and what's wrong with it", () => {
    const current = buildSpec([
      file("index.json", { title: "Rocket" }),
      file("uploads/retries.json", { title: "Retries", requirements: [{ id: "R1", text: "Retried." }], related: ["nowhere"] }),
      file("cli.json", { titel: "Command line" }),
    ]);
    const prompt = specPrompt({ repo: "acme/rocket", branch: "develop", current });
    expect(prompt).toMatch(/^Improve the spec of acme\/rocket/);
    expect(prompt).toContain("Keep the ids of existing items and requirements");
    expect(prompt).toContain(
      [
        "## The current spec (on develop)",
        "",
        "2 items and 1 requirement, in `.spec`. Read the files themselves; this is their outline:",
        "",
        "    - (root): Rocket",
        "      - cli: cli (can't be read)",
        "      - uploads: uploads (a folder without an index.json)",
        "        - uploads/retries: Retries (1 requirement)",
      ].join("\n"),
    );
    expect(prompt).toContain('- .spec/uploads/retries.json: Nothing in the spec is called "nowhere".');
    expect(prompt).toContain("- .spec/cli.json: ");
  });

  it("says that nothing is deleted, and how to deprecate", () => {
    expect(setup).toContain("## Nothing is deleted: deprecation");
    expect(setup).toContain('"reason": "Large uploads never finished on bad networks. Uploads resume instead."');
    expect(specPrompt({ repo: "acme/rocket", branch: "main", current: buildSpec([file("index.json", { title: "Rocket" })]) })).toContain(
      "Don't delete what is no longer wanted: deprecate it, with the reason.",
    );
  });
});

describe("spec-llms.txt", () => {
  it("is the format as the app knows it (npm run spec:schema writes it)", () => {
    expect(llmsFile).toBe(specLlmsText());
  });

  it("stands on its own: the layout, an example, the schema, deprecation and how to work with a spec", () => {
    const text = specLlmsText();
    for (const heading of ["# The spec format", "## Write little", "## The format", "## The schema", "## Changing a requirement: versions", "## Nothing is deleted: deprecation", "## A good spec", "## Keeping a spec", "## Checking a spec"]) {
      expect(text).toContain(`${heading}\n`);
    }
    expect(text).toContain('"additionalProperties": false');
    // Nothing in it is about one repository.
    expect(text).not.toContain("acme/rocket");
  });

  it("tells the agent to be brief, before anything else about the format", () => {
    const text = specLlmsText();
    expect(text.indexOf("## Write little")).toBeGreaterThan(0);
    expect(text.indexOf("## Write little")).toBeLessThan(text.indexOf("## The format"));
    expect(text).toContain("The user stories and the requirements are the spec.");
    expect(text).toContain("## What a spec is made of");
    expect(text).not.toContain("`questions`");
    expect(text).toContain("If it is longer than its requirements, it is too long.");
  });

  // Spec: S46, SC8
  it("makes a shared part's groundwork the first work in adopting it, and the one thing to ask about", () => {
    const text = specLlmsText();
    // The example of groundwork is one the app reads.
    const example = /\n {6}"groundwork": (\[[\s\S]*?\n {6}\])\n/.exec(text)?.[1];
    expect(example).toBeDefined();
    const groundwork: unknown = JSON.parse(example ?? "null");
    expect(SpecItem.safeParse({ title: "Chat", shared: { id: "chat" }, groundwork }).success).toBe(true);
    const adopting = text.slice(text.indexOf("## Adopting a shared part"));
    expect(adopting).toContain("Groundwork is the one place where asking is expected");
    expect(adopting.indexOf("1. **Groundwork first.**")).toBeLessThan(adopting.indexOf("2. **Cite.**"));
    expect(adopting).toContain("never a reason to decline the part or to stop");
    expect(adopting).toContain("9. **Report** the groundwork you found");
  });
});

// Spec: S37
describe("the prompt to check that a spec agrees with itself", () => {
  const spec = buildSpec([
    { path: "index.json", text: JSON.stringify({ title: "Rocket" }), truncated: false },
    { path: "retries.json", text: JSON.stringify({ title: "Retries", stories: [{ id: "US-1", as: "a caller", want: "retries", requirements: ["#R1"] }], requirements: [{ id: "R1", text: "Retried.", deprecation: { reason: "No." } }] }), truncated: false },
  ]);
  const prompt = specConsistencyPrompt({ repo: "acme/rocket", branch: "main", current: spec });

  it("stands on its own: the task, the format, the spec's outline and what to hand back", () => {
    expect(prompt).toMatch(/^Check that the spec of acme\/rocket agrees with itself/);
    expect(prompt).toContain("## Checking that a spec agrees with itself");
    expect(prompt).toContain("## The schema");
    expect(prompt).toContain("- retries: Retries (1 requirement)");
    expect(prompt).toContain("Change only `.spec`: no code.");
  });

  it("makes the pointers the agent's to keep, leaves contradictions to a person, and asks for a best-effort statement", () => {
    expect(prompt).toContain("The pointers are yours to keep.");
    expect(prompt).toContain("Don't settle a contradiction.");
    expect(prompt).toContain("Say that this is a careful reading and not a proof.");
    expect(prompt).toContain("nothing in the format records that it was checked");
  });

  it("hands over what the app can tell by itself", () => {
    // Spec: S38
    expect(spec.problems.map((problem) => problem.message)).toEqual(["User story US-1 is made true by R1, which is deprecated."]);
    expect(prompt).toContain("- .spec/retries.json: User story US-1 is made true by R1, which is deprecated.");
  });
});

