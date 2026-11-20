// A prompt to hand to a coding agent (Claude Code, say) so it writes a
// repository's spec, or improves the one it has. It has to stand on its own:
// the agent knows nothing about this app or the format, and may not be able
// to fetch the schema, so the schema is part of the prompt.

import { SPEC_DIR, SPEC_SCHEMA_URL, specCounts, specJsonSchema, type Spec, type SpecNode } from "./spec";

export interface SpecPromptInput {
  /** "owner/name". */
  repo: string;
  /** The branch the spec was looked for on. */
  branch: string;
  /** The spec that branch has, if any. */
  current: Spec | null;
}

const indent = (text: string) =>
  text
    .trimEnd()
    .split("\n")
    .map((line) => (line !== "" ? `    ${line}` : ""))
    .join("\n");

/** The item the prompt teaches the format with; a test reads it with the app's schema. */
export const SPEC_PROMPT_EXAMPLE = {
  $schema: SPEC_SCHEMA_URL,
  title: "Retries",
  summary: "A failed upload is tried again, with growing pauses.",
  status: "implemented",
  order: 1,
  description: "Networks drop. An upload that fails for a reason that may pass is tried again instead of failing the caller.\n\nRetrying is safe because:\n- uploads resume, they never start over\n- the server ignores bytes it already has",
  requirements: [
    { id: "R1", text: "An upload that fails with a network error or a 5xx response is retried, up to five times." },
    { id: "R2", text: "The pause before a retry doubles each time, starting at 250 ms.", level: "should" },
    { id: "R3", text: "The caller can cancel while a retry is waiting.", level: "may", status: "accepted" },
  ],
  figures: [{ src: "assets/backoff.png", alt: "Four pauses, each twice as long as the last", caption: "Pauses double between attempts." }],
  questions: ["Should a `429` count as retryable?"],
  code: ["src/client.rs", "src/retry/**"],
  related: ["uploads/errors#E1", "cli"],
};

/** The outline as indented lines: "- uploads/retries: Retries (4 requirements)". */
function outline(node: SpecNode, depth = 0): string[] {
  return node.children.flatMap((child) => {
    const count = child.item?.requirements?.length ?? 0;
    const note = !child.loaded ? "" : child.error !== null ? " (can't be read)" : child.file === null ? " (a folder without an index.json)" : count > 0 ? ` (${count} requirement${count === 1 ? "" : "s"})` : "";
    return [`${"  ".repeat(depth)}- ${child.id}: ${child.title}${note}`, ...outline(child, depth + 1)];
  });
}

/** A huge spec's outline would drown the prompt: its first lines, and how many more there are. */
const OUTLINE_MAX = 400;
function capped(lines: string[]): string[] {
  return lines.length <= OUTLINE_MAX ? lines : [...lines.slice(0, OUTLINE_MAX), `- ... and ${lines.length - OUTLINE_MAX} more`];
}

export function specPrompt({ repo, branch, current }: SpecPromptInput): string {
  const task = current
    ? `Improve the spec of ${repo}: the \`${SPEC_DIR}\` folder at its root.`
    : `Set up a spec for ${repo}: write a \`${SPEC_DIR}\` folder at its root.`;

  const sections = [
    `${task}

A spec says what the code is meant to do, in a form people and agents can read, review and compare: one JSON file per part of the product, each with requirements that can be checked against the code. The Better GitHub app shows it as an outline, and shows what a pull request changes in it, requirement by requirement.`,

    `## The format

${indent(`${SPEC_DIR}/
  index.json            the root: what the product is and who it is for
  uploads/
    index.json          "Uploads", with the items below as its children
    retries.json        "Retries"
    errors.json
  cli.json
  assets/
    backoff.png         a picture an item shows`)}

- Every \`.json\` file in \`${SPEC_DIR}\` is one item. Anything else in the folder is an asset, such as a picture.
- The folders are the outline. An item's id is its path without \`${SPEC_DIR}/\` and \`.json\`: \`uploads/retries\`. A folder's own item is its \`index.json\` (id \`uploads\`; the root's is the empty id). Folders nest as deep as the product needs.
- All items follow one schema. This is \`${SPEC_DIR}/uploads/retries.json\`:

${indent(JSON.stringify(SPEC_PROMPT_EXAMPLE, null, 2))}

- Only \`title\` is required. Unknown keys are errors: the app won't show an item that has one.
- \`status\` is \`draft\` (still being written), \`accepted\` (agreed on, not built yet), \`implemented\` (the code does this) or \`deprecated\` (no longer wanted). A requirement's \`status\` defaults to its item's.
- A requirement's \`level\` is \`must\` (the default), \`should\` or \`may\`. Its \`id\` is unique within the item and never changes or gets reused: other items, code and tests refer to it as \`uploads/retries#R1\`, and the app matches requirements by id when it compares two versions of the spec.
- Text (\`description\`, a requirement's \`text\`, \`questions\`) is plain, not Markdown: a blank line starts a paragraph, lines starting with \`- \` form a list, and \`backticks\` mark code. There are no headings, links or bold.
- \`order\` places an item among its siblings, lowest first; items without one follow, by title.
- \`figures\` name pictures by their path from \`${SPEC_DIR}\`; the file has to be there. \`code\` lists paths from the repository's root, or patterns with \`*\` and \`**\`. \`related\` lists ids of other items or of their requirements; each has to exist.
- \`$schema\` is optional and lets editors check the file.`,

    `## The schema

${indent(JSON.stringify(specJsonSchema(), null, 2))}`,

    `## A good spec

- It says what the software does and why, not how the code is written. Someone who has never seen the code can read an item and know what to expect from that part; someone changing the code can tell whether they broke a promise.
- The outline follows the product (its features, its surfaces, the rules that hold everywhere), not the source tree. \`code\` is what ties an item to files.
- A requirement is one statement that can be checked: by a test, or by reading the code. "A failed upload is retried up to five times", not "uploads are robust". If it needs an "and", it is two requirements.
- Requirements state behavior and limits a user or caller can observe: what happens, when, with which numbers, and what never happens. Leave out anything that is true of all software.
- \`summary\` is one line that makes sense in a list. \`description\` gives the reason the part exists and the context its requirements need.
- What isn't decided goes in \`questions\`, not into a vague requirement.
- A few items with sharp requirements beat many thin ones. Add a folder when an item has grown parts of its own.`,

    `## Steps

1. Get to know the repository: its README and docs, its layout, its tests (they say what is promised), its public interfaces, and recent pull requests and issues.
2. Decide which case this is:
   - The repository has code. Write down what it does today, from the code and its tests, with \`status: "implemented"\`. Where the code and the docs disagree, or the behavior looks unintended, don't pick one silently: write the requirement the way the code behaves and add a question.
   - The repository is new or nearly empty. Write what it is meant to do, from the README, the issues and whatever brief you were given, with \`status: "draft"\`. Ask the person you are working for about anything the spec depends on that you can't find; put what stays open in \`questions\`.
3. ${current ? `Edit \`${SPEC_DIR}\`. Keep what is right, fix what is wrong or out of date, and fill in what is missing. Keep the ids of existing items and requirements; give new requirements new ids.` : `Write \`${SPEC_DIR}/index.json\` first (what the product is, and for whom), then the items below it.`}
4. Check your work: every file is valid JSON and fits the schema above, every \`figures\` path exists in \`${SPEC_DIR}\`, every \`related\` id exists, every \`code\` path or pattern matches real files (for example with \`git ls-files\`), and no requirement id is used twice in an item.
5. Read each requirement against the code once more. One you can't point to in the code or its tests is either not implemented (say so in its \`status\`) or not checkable (rewrite it).
6. Open a pull request with the change. The app reads the spec from the branch being looked at, here ${branch}.`,
  ];

  if (current) {
    const counts = specCounts(current.root);
    sections.push(`## The current spec (on ${branch})

${counts.items} item${counts.items === 1 ? "" : "s"}${counts.unloaded === 0 ? ` and ${counts.requirements} requirement${counts.requirements === 1 ? "" : "s"}` : ""}, in \`${SPEC_DIR}\`. Read the files themselves; this is their outline:

${indent(capped([`- (root): ${current.root.title}${current.root.file === null ? " (no index.json)" : ""}`, ...outline(current.root, 1)]).join("\n"))}`);
    if (current.problems.length > 0) {
      sections.push(`The app found these problems. Fix them:

${current.problems.map((problem) => `- ${problem.file}: ${problem.message}`).join("\n")}`);
    }
  }

  return `${sections.join("\n\n")}\n`;
}
