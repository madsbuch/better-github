// A prompt to hand to a coding agent (Claude Code, say) so it writes a
// repository's spec, or improves the one it has. It has to stand on its own:
// the agent knows nothing about this app or the format, and may not be able
// to fetch the schema, so the schema is part of the prompt.

// With its extension, so that plain Node can run this file too (npm run spec:schema).
import { SPEC_DIR, SPEC_SCHEMA_URL, specCounts, specJsonSchema, type Spec, type SpecNode } from "./spec.ts";

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
  status: "accepted",
  order: 1,
  description: "Networks drop. An upload that fails for a reason that may pass is tried again instead of failing the caller.\n\nRetrying is safe because:\n- uploads resume, they never start over\n- the server ignores bytes it already has",
  stories: [
    {
      id: "US-1",
      as: "a commuter sending a file from a train",
      want: "the upload to survive the tunnel",
      soThat: "I don't have to start it again",
      requirements: ["#RET-1", "#RET-2"],
    },
  ],
  requirements: [
    {
      id: "RET-1",
      text: "An upload that fails with a network error or a 5xx response is retried, up to five times.",
      version: 2,
      history: [
        {
          version: 1,
          text: "An upload that fails with a network error is retried, up to three times.",
          reason: "Three tries weren't enough on trains, and servers that answer 503 while restarting recover within seconds.",
          date: "2026-01-20",
        },
      ],
    },
    { id: "RET-2", text: "The pause before a retry doubles each time, starting at 250 ms.", level: "should" },
    { id: "RET-3", text: "The caller can cancel while a retry is waiting.", level: "may", status: "draft" },
    {
      id: "RET-4",
      text: "A retry starts the upload over from the first byte.",
      status: "deprecated",
      deprecation: { reason: "Large uploads never finished on bad networks. Uploads resume instead.", replacedBy: ["#RES-1"], date: "2026-03-02" },
    },
  ],
  figures: [{ src: "assets/backoff.png", alt: "Four pauses, each twice as long as the last", caption: "Pauses double between attempts." }],
  related: ["#ERR-1", "cli"],
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

/**
 * The format, in full: what an agent needs to read or write a spec. Shared by
 * the prompt below and by spec-llms.txt at the root of this repository.
 */
function formatSections(): string[] {
  return [
    `## Write little

The user stories and the requirements are the spec. Everything else in a part is there to help a reader find and understand them, and should be as short as that takes.

- Say each thing once, in the one place it belongs. Don't restate a requirement in the description, or the description in the summary.
- \`summary\`: one line.
- \`description\`: a few sentences on what the part is and why it exists. Not a history of how it came to be, not a walk through its requirements. If it is longer than its requirements, it is too long.
- A user story: one sentence in three short pieces (\`as\`, \`want\`, \`soThat\`). It says who wants what and why, never how.
- A requirement's \`text\`: one sentence, two at most. State what must hold. No "because", no background, no example unless the statement can't be understood without one.
- Why something changed belongs in that requirement's \`history\` (\`reason\`); why something was dropped belongs in its \`deprecation\` (\`reason\`). Each is a sentence or two. Neither belongs in a description.
- Don't explain the format, narrate what you did, hedge, or address the reader. Don't write a sentence to introduce the next one.
- Before keeping a sentence, ask what a reader could no longer check or decide without it. If nothing, cut it.`,

    `## What a spec is made of

- **Part** (an item): one \`.json\` file, one part of the product. It holds the stories and requirements of that part, and a title, a one-line summary and a short description to introduce them. Parts nest: folders are the outline.
- **User story**: who wants what, and why. "As a commuter sending a file from a train, I want the upload to survive the tunnel, so that I don't have to start it again." It says what the part is for, and can name the requirements that together make it true.
- **Requirement**: one statement about what the product does, or how it is built, that can be checked against the product. "An upload that fails with a network error is retried, up to five times." It has a level: \`must\`, \`should\` or \`may\`.
- **Earlier version**: what a requirement said before its meaning changed, kept with the reason it changed.
- **Deprecation**: the record on a story, requirement or part that is no longer wanted, kept with the reason. Nothing is deleted.
- **Figure**: a picture a part shows, such as a screenshot, a mockup or a diagram. It is an image file (PNG, JPEG, GIF, WebP or AVIF) stored inside \`${SPEC_DIR}\`; the part names it by path and can give it alt text and a caption.
- **Related**: a pointer from a part to another part, story or requirement.

Stories and requirements are what matters; the rest serves them. A spec has no open questions, tasks or notes: what isn't decided is settled wherever the product is planned, and enters the spec once it is.`,

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
- \`status\` says where something stands as part of the spec: \`draft\` (still being worked out), \`accepted\` (agreed on: this is what the product is to do) or \`deprecated\` (no longer wanted, see below). A requirement's \`status\` defaults to its item's. There is no status for "built": whether the product meets a requirement is found out by comparing the product with the spec, and is not recorded in it.
- A requirement's \`level\` is \`must\` (the default), \`should\` or \`may\`. Its \`id\` is unique in the whole spec, not just in its item, and never changes or gets reused: everything that refers to a requirement does so by this id alone, and the app follows a requirement by its id when it compares two versions of the spec, also when it moves to another item. Give each item a short prefix for its requirements (\`RET-1\`, \`RET-2\` in Retries; \`ERR-1\` in Errors) so ids don't collide.
- A user story has an \`id\` (\`US-1\`), \`as\` (who), \`want\` (what) and optionally \`soThat\` (why); the app reads them as "As ..., I want ..., so that ...". Its \`requirements\` name the requirements that make it true (\`#RET-1\`), in any item; each has to exist. Stories and requirements share one set of ids: no id is used twice, whichever of the two has it. A story has no level and no versions: reword it freely, and deprecate it when nobody wants it any more.
- Text (\`description\`, a requirement's \`text\`) is plain, not Markdown: a blank line starts a paragraph, lines starting with \`- \` form a list, and \`backticks\` mark code. There are no headings, links or bold.
- \`order\` places an item among its siblings, lowest first; items without one follow, by title.
- \`figures\` name pictures by their path from \`${SPEC_DIR}\`; the file has to be there. \`related\` lists ids of other items (\`cli\`), requirements or stories (\`#ERR-1\`, or with its item: \`uploads/errors#ERR-1\`); each has to exist.
- \`$schema\` is optional and lets editors check the file.`,

    `## The schema

${indent(JSON.stringify(specJsonSchema(), null, 2))}`,

    `## Changing a requirement: versions

A requirement has a version, 1 unless it says otherwise. When what it means changes (a number, a condition, how binding it is), its \`id\` stays and its \`version\` goes up by one. What it said before goes into \`history\`, with why it changed:

${indent(JSON.stringify(SPEC_PROMPT_EXAMPLE.requirements[0], null, 2))}

- \`history\` has every earlier version, oldest first: its \`version\`, its \`text\` exactly as it was, its \`level\` if that wasn't \`must\`, the \`reason\` it was replaced, and optionally the \`date\` (\`YYYY-MM-DD\`). \`reason\` is required: what was learned or decided, in a sentence or two someone reading it in a year will understand.
- The numbers have to agree: a requirement at version 3 has a history of versions 1 and 2. Version 1 has no history and needs no \`version\`.
- A wording fix that changes nothing about what is promised (a typo, a clearer phrase) is just an edit to \`text\`: no new version. When in doubt whether the meaning changed, it did.
- History is never edited or shortened. A mistake in the current version is fixed with the next version.
- A reference can name a version: \`#RET-1@2\` in \`related\`, \`RET-1@2\` anywhere else. A bare \`RET-1\` means the current one.
- The app shows a requirement's earlier versions with their reasons, and when a pull request is reviewed it shows each new version with its why, and marks a requirement whose text changed without one.`,

    `## Nothing is deleted: deprecation

A requirement that is no longer wanted is not deleted. It stays in its item with \`"status": "deprecated"\` and a \`deprecation\` that says why, so the spec keeps the record that it existed, that it was dropped, and for what reason:

${indent(JSON.stringify(SPEC_PROMPT_EXAMPLE.requirements[3], null, 2))}

- \`deprecation.reason\` is required with the status: what changed, in a sentence or two someone reading it in a year will understand. \`replacedBy\` names what takes its place, if anything: requirements (\`#RES-1\`) or items. \`date\` is the day it was deprecated, as \`YYYY-MM-DD\`.
- The status and the record go together: \`"status": "deprecated"\` without a \`deprecation\`, or a \`deprecation\` without the status, is an error.
- Leave a deprecated requirement's \`text\` and \`level\` as they were: they are the record of what was promised.
- A user story is deprecated the same way: \`status\` and \`deprecation\` on the story.
- A whole item is deprecated the same way, with \`status\` and \`deprecation\` on the item. Its requirements are then all deprecated and need no record of their own. Its file stays where it is.
- A deprecated requirement's id is never given to another requirement.
- To change what a requirement means, give it a new version (above). To replace it with a different promise altogether, deprecate it and add a new requirement with a new id.
- The app flags every deleted requirement and item when a pull request is reviewed.`,

    `## A good spec

- It says what the product does and why. It can also say how the product is built, where that is decided and has to hold: an architecture, a data model, a protocol, a limit on what a component may do. Someone who has never seen the code can read an item and know what to expect from that part.
- The outline follows the product (its features, its surfaces, its internals where they are specified, the rules that hold everywhere), not the source tree.
- Internals are specified like anything else: as requirements, in words. The format has no field that points at code, and a requirement doesn't lean on a file path or a line number to be understood. Name a component, an interface or a table when the requirement is about it.
- A requirement is one statement that can be checked against the product. "A failed upload is retried up to five times", not "uploads are robust". If it needs an "and", it is two requirements.
- Requirements state behavior and limits that can be checked: what happens, when, with which numbers, and what never happens, whether seen by a user or held inside the system. Leave out anything that is true of all software.
- \`summary\` is one line that makes sense in a list. \`description\` gives the reason the part exists, briefly (see "Write little").
- A user story names a real kind of person and something they want from the product, not a feature ("As a user, I want a retry button" is a requirement in disguise). A part usually has one to three.
- What isn't decided stays out. A spec holds what was decided; don't write a requirement that guesses.
- A few items with sharp requirements beat many thin ones. Add a folder when an item has grown parts of its own.`,
  ];
}

const CHECKS = `every file is valid JSON and fits the schema above, every \`figures\` path exists in \`${SPEC_DIR}\`, every \`related\` and \`replacedBy\` id exists, every id in a story's \`requirements\` is a requirement, every requirement above version 1 has the \`history\` of all its earlier versions with their reasons, every deprecated story, requirement or item has a \`deprecation\` with its reason, and no story or requirement id is used twice anywhere in the spec (list them all, for example with \`grep -rhoE '"id": *"[^"]+"' ${SPEC_DIR} | sort | uniq -d\`, which must print nothing)`;

/**
 * spec-llms.txt: the spec format for coding agents, to point one at when it
 * works in a repository that has, or should get, a spec. Written to the root
 * of this repository by \`npm run spec:schema\`; a test fails when it is stale.
 */
export function specLlmsText(): string {
  const sections = [
    `# The spec format

> A spec says what a product is meant to do. It is a \`${SPEC_DIR}\` folder at the root of a repository: one JSON file per part of the product, all following one schema, each with requirements that can be checked against the product. This file is everything an agent needs to read, write and maintain one.

The Better GitHub app shows a spec as an outline, compares two versions of it requirement by requirement, and reviews the spec changes of a pull request. The schema is also at ${SPEC_SCHEMA_URL}.`,

    ...formatSections(),

    `## Keeping a spec

- The spec comes first. A change to what the product does starts as a change to the spec: a new requirement, a new version of one with the reason, or a deprecation with the reason.
- The spec says what the product does and, where it matters, how it is built. It never says whether that is done. To learn whether a requirement is met, compare the product with it; don't record the answer in the spec.
- Never delete a requirement, a user story or an item, never renumber one, never reuse an id, never edit a requirement's history. Moving a requirement to another item keeps its id.
- When something isn't decided, ask. Don't write a requirement that guesses, and don't park the question in the spec.
- A requirement's id (\`RET-1\`) is the way to refer to it from anywhere else. Ids don't change, so the references stay good.

## Checking a spec

Before committing: ${CHECKS}.`,
  ];
  return `${sections.join("\n\n")}\n`;
}

export function specPrompt({ repo, branch, current }: SpecPromptInput): string {
  const task = current
    ? `Improve the spec of ${repo}: the \`${SPEC_DIR}\` folder at its root.`
    : `Set up a spec for ${repo}: write a \`${SPEC_DIR}\` folder at its root.`;

  const sections = [
    `${task}

A spec says what the code is meant to do, in a form people and agents can read, review and compare: one JSON file per part of the product, each with requirements that can be checked against the code. The Better GitHub app shows it as an outline, and shows what a pull request changes in it, requirement by requirement.`,

    ...formatSections(),

    `## Steps

1. Get to know the repository: its README and docs, its layout, its tests (they say what is promised), its public interfaces, and recent pull requests and issues.
2. Decide which case this is:
   - The repository has code. Write down what the product does today, as you find it from the code and its tests, with \`status: "accepted"\`. Where the code and the docs disagree, or the behavior looks unintended, don't pick one silently: write the requirement the way the product behaves and tell the person you are working for.
   - The repository is new or nearly empty. Write what it is meant to do, from the README, the issues and whatever brief you were given, with \`status: "draft"\`. Ask the person you are working for about anything the spec depends on that you can't find; leave out what stays open.
3. ${current ? `Edit \`${SPEC_DIR}\`. Keep what is right, fix what is wrong or out of date, and fill in what is missing. Keep the ids of existing items and requirements; give new requirements ids no other requirement in the spec has or had. Don't delete what is no longer wanted: deprecate it, with the reason.` : `Write \`${SPEC_DIR}/index.json\` first (what the product is, and for whom), then the items below it.`}
4. Check your work: ${CHECKS}.
5. Read each requirement against the product once more. One you can't see it doing is either not something it does (take it out, or keep it as a \`draft\`) or not checkable (rewrite it).
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
