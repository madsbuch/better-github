// A prompt to hand to a coding agent (Claude Code, say) so it writes or
// improves a repository's .review-rules. It has to stand on its own: the
// agent knows nothing about this app or the format.

import { RULES_FILE, type ReviewRules } from "./reviewRules";

export interface RulesPromptInput {
  /** "owner/name". */
  repo: string;
  /** Where the app reads the rules from: the branch pull requests merge into. */
  branch: string;
  /** The current file, if there is one. */
  current: { text: string; warnings: ReviewRules["warnings"] } | null;
}

const indent = (text: string) =>
  text
    .trimEnd()
    .split("\n")
    .map((line) => (line !== "" ? `    ${line}` : ""))
    .join("\n");

export function rulesPrompt({ repo, branch, current }: RulesPromptInput): string {
  const task = current
    ? `Improve the review rules of ${repo}: the \`${RULES_FILE}\` file at its root.`
    : `Set up review rules for ${repo}: write a \`${RULES_FILE}\` file at its root.`;

  const sections = [
    `${task}

The Better GitHub app reads this file. For every file a pull request changes, it shows reviewers a risk verdict (high, medium or low) and instructions on what to check, right above the file's diff. High-risk files come first, and approving warns when one hasn't been marked viewed.`,

    `## The format

${indent(`# Comments start with "#".

high apps/backend/prisma/** packages/auth/**
  - Migrations run on production data: safe while the previous release
    is still running, and reversible.
  - Every role keeps exactly the access it had.

medium src/** !src/**/*.test.ts
  - Errors tell the user what happened and what to do next.

low **/*.test.ts docs/**
  - The test fails if the change it covers is reverted.

low *.lock

unmatched medium
  - No rule covers this file. Consider adding one.`)}

- A rule starts with a line that isn't indented: \`low\`, \`medium\` or \`high\`, then one or more path patterns separated by spaces. All of a rule's patterns go on that one line.
- Its instructions follow as indented \`- \` items. An indented line without a dash continues the item above it. A rule without instructions only sets the risk.
- Patterns work like CODEOWNERS: \`*\` and \`?\` match within one folder, \`**\` spans folders, a pattern without a \`/\` (other than a trailing one) matches at any depth, a leading \`/\` anchors it to the root, and a pattern naming a folder matches everything inside it. There are no character classes or braces, and patterns can't contain spaces.
- \`!pattern\` on a rule's line leaves files out of that rule only.
- A file gets the instructions of every rule that matches it, and its verdict is the highest risk among them. Rule order doesn't matter, and no rule can lower another's verdict. So give broad areas the lowest risk they deserve, give dangerous paths their own higher rules, and use \`!\` to keep things like tests out of a broad rule.
- \`unmatched <risk>\` and its instructions apply to files no rule matches. Without it, those files are medium.
- A renamed file is judged by its old and its new path.
- Changes to \`${RULES_FILE}\` itself are always high risk, whatever the file says.`,

    `## Good rules

- High: a mistake would hurt users, data, security or money, or is hard to undo. For example: database migrations, authentication and permissions, payments, infrastructure and deployment, CI that ships, secrets, and code that decides who sees whose data.
- Medium: ordinary product code. Low: tests, docs, generated files and lockfiles.
- Each instruction is something specific a reviewer can check in the diff, in a sentence or two, about this repository: its frameworks, its invariants, what has broken before. Not "be careful" or "look for bugs".
- A handful of rules that cover the whole repository beats many narrow ones.`,

    `## Steps

1. Get to know the repository: its layout, README and docs, CODEOWNERS, CI workflows, migrations, auth, infrastructure, and where tests live. Recent pull requests and commits show what tends to break.
2. ${current ? `Edit \`${RULES_FILE}\`. Keep what's right and fix what's wrong.` : `Write \`${RULES_FILE}\` at the root of the repository.`}
3. Check that every pattern matches real files (for example with \`git ls-files\`), and work out the verdict for a few important files of each kind to confirm it's the one you intend.
4. Open a pull request with the change. The app reads the rules from ${branch}, the branch pull requests merge into, so they apply once it's merged.`,
  ];

  if (current) {
    sections.push(`## The current rules (on ${branch})

${indent(current.text)}`);
    if (current.warnings.length > 0) {
      sections.push(`The app can't read these lines, so it leaves them out. Fix them:

${current.warnings.map((w) => `- Line ${w.line}: ${w.message}`).join("\n")}`);
    }
  }

  return `${sections.join("\n\n")}\n`;
}
