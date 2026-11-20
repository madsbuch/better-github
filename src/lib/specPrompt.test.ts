import { describe, expect, it } from "vitest";
import { buildSpec, SpecItem, type SpecFile } from "./spec";
import { SPEC_PROMPT_EXAMPLE, specPrompt } from "./specPrompt";

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
      file("cli.json", { title: "Command line" }),
      { path: "assets/backoff.png", text: null, truncated: false },
    ]);
    expect(spec.problems).toEqual([]);
  });

  it("includes the schema itself, since the agent may not be able to fetch it", () => {
    expect(setup).toContain('"additionalProperties": false');
    expect(setup).toContain('"deprecated"');
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
});
