// Review rules: a `.review-rules` file at the root of a repository says how
// risky a change to each file is and what to check when reviewing it.
//
//   high src-tauri/src/** !src-tauri/src/ipc_tests.rs
//     - The token never reaches the web view: no command returns it,
//       and no log line contains it.
//
//   low **/*.test.ts
//     - The test fails if the change it covers is reverted.
//
//   unmatched medium
//     - No rule covers this file. Consider adding one.
//
// A rule is a risk (low, medium or high) and path patterns, followed by its
// instructions as indented "- " items. A file gets the instructions of every
// rule that matches it, and its verdict is the highest risk among them.
// "!pattern" leaves files out of that one rule. Order doesn't matter.

export type Risk = "low" | "medium" | "high";

const RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2 };
export const riskRank = (risk: Risk) => RANK[risk];

/** At the root of the repository. Changes to it are always high risk. */
export const RULES_FILE = ".review-rules";
const RULES_FILE_INSTRUCTION = "This file decides how every change is reviewed. Check that no rule was weakened or removed.";
const NO_RULE_INSTRUCTION = "No rule covers this file.";

interface Rule {
  risk: Risk;
  include: { pattern: string; regex: RegExp }[];
  exclude: RegExp[];
  instructions: string[];
  /** Where the rule starts in the file. */
  line: number;
}

export interface ReviewRules {
  rules: Rule[];
  /** For files no rule matches. */
  unmatched: { risk: Risk; instructions: string[] };
  /** Lines that couldn't be read. They're left out. */
  warnings: { line: number; message: string }[];
}

export interface Instruction {
  risk: Risk;
  text: string;
}

/** A rule as it applies to a file: what to check, and why it applies. */
export interface RuleMatch {
  /** The same for every file the rule matches: its line, or "unmatched" or the built-in rule. */
  id: string;
  risk: Risk;
  /** The pattern that matched, or what stands in for one. */
  label: string;
  instructions: string[];
}

export interface FileReview {
  /** The verdict: the highest risk among the rules matching the file. */
  risk: Risk;
  /** What to check, from every matching rule, highest risk first. */
  instructions: Instruction[];
  /** The rules behind it, highest risk first. */
  rules: RuleMatch[];
  /** The patterns that matched, e.g. "src/** (medium)", for when a verdict looks wrong. */
  matched: string[];
  /** No rule matched; the verdict comes from the "unmatched" line. */
  unmatched: boolean;
}

const isRisk = (word: string | undefined): word is Risk => word === "low" || word === "medium" || word === "high";

/**
 * A path pattern as CODEOWNERS and .gitignore read them: `*` and `?` stay
 * within a folder, `**` spans folders, a pattern without a "/" (other than
 * a trailing one) matches at any depth, a leading "/" anchors it to the
 * root, and a pattern naming a folder matches everything inside it.
 */
export function compilePattern(pattern: string): RegExp | null {
  let p = pattern;
  const folderOnly = p.endsWith("/");
  if (folderOnly) p = p.slice(0, -1);
  const rooted = p.startsWith("/");
  if (rooted) p = p.slice(1);
  if (p === "" || p.includes("//")) return null;
  const anchored = rooted || p.includes("/");

  let source = "";
  for (let i = 0; i < p.length; i++) {
    const c = p.charAt(i);
    if (c === "*" && p[i + 1] === "*" && (i === 0 || p[i - 1] === "/") && (i + 2 === p.length || p[i + 2] === "/")) {
      if (p[i + 2] === "/") {
        source += "(?:.*/)?"; // "**/": any number of folders, including none
        i += 2;
      } else {
        source += ".*"; // a trailing "**": everything inside
        i += 1;
      }
    } else if (c === "*") {
      source += "[^/]*";
      while (p[i + 1] === "*") i++;
    } else if (c === "?") {
      source += "[^/]";
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}${folderOnly ? "/.*" : "(?:/.*)?"}$`);
}

export function parseReviewRules(text: string): ReviewRules {
  const rules: Rule[] = [];
  let unmatched: ReviewRules["unmatched"] | null = null;
  const warnings: ReviewRules["warnings"] = [];
  // Where indented instructions go. "skip" swallows those of a line that couldn't be read.
  let current: { instructions: string[] } | "skip" | null = null;

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    const warn = (message: string) => warnings.push({ line, message });
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    if (/^\s/.test(raw)) {
      if (current === "skip") continue;
      if (current === null) {
        warn("Instructions need a rule line above them.");
        current = "skip";
        continue;
      }
      const item = /^[-*](?:\s+|$)(.*)$/.exec(trimmed);
      const items = current.instructions;
      if (item) {
        const text = (item[1] ?? "").trim();
        if (text !== "") items.push(text);
      } else if (items.length > 0) {
        const last = items.length - 1;
        items[last] = `${items[last] ?? ""} ${trimmed}`;
      } else {
        items.push(trimmed);
      }
      continue;
    }

    const words = trimmed.split(/\s+/);
    const comment = words.findIndex((w) => w.startsWith("#"));
    if (comment !== -1) words.length = comment;
    const [head = "", ...rest] = words;
    const keyword = head.toLowerCase();
    current = "skip";

    if (keyword === "unmatched") {
      const risk = rest[0]?.toLowerCase();
      if (!isRisk(risk) || rest.length > 1) warn('Write "unmatched low", "unmatched medium" or "unmatched high".');
      else if (unmatched) warn('Only the first "unmatched" line counts.');
      else {
        unmatched = { risk, instructions: [] };
        current = unmatched;
      }
      continue;
    }
    if (!isRisk(keyword)) {
      warn(`"${head}" isn't low, medium or high.`);
      continue;
    }
    const rule: Rule = { risk: keyword, include: [], exclude: [], instructions: [], line };
    for (const word of rest) {
      const negated = word.startsWith("!");
      const pattern = negated ? word.slice(1) : word;
      const regex = compilePattern(pattern);
      if (!regex) warn(`"${word}" isn't a path pattern.`);
      else if (negated) rule.exclude.push(regex);
      else rule.include.push({ pattern, regex });
    }
    if (rule.include.length === 0) {
      warn(`The ${keyword} rule needs at least one path.`);
      continue;
    }
    rules.push(rule);
    current = rule;
  }

  return { rules, unmatched: unmatched ?? { risk: "medium", instructions: [] }, warnings };
}

/** For a repository without rules, where only a change to the rules file itself gets a verdict. */
export const NO_RULES: ReviewRules = { rules: [], unmatched: { risk: "medium", instructions: [] }, warnings: [] };

/**
 * The verdict and instructions for one changed file. A renamed file is
 * judged by its old and its new path, so moving it can't lower its risk.
 */
export function reviewFile(rules: ReviewRules, path: string, previousPath?: string | null): FileReview {
  const paths =
    previousPath !== undefined && previousPath !== null && previousPath !== "" && previousPath !== path ? [path, previousPath] : [path];
  const hits: RuleMatch[] = [];

  for (const rule of rules.rules) {
    const hit = rule.include.find(({ regex }) => paths.some((p) => regex.test(p) && !rule.exclude.some((x) => x.test(p))));
    if (hit) hits.push({ id: `line:${rule.line}`, risk: rule.risk, label: hit.pattern, instructions: rule.instructions });
  }
  if (paths.includes(RULES_FILE)) {
    hits.push({ id: "rules-file", risk: "high", label: RULES_FILE, instructions: [RULES_FILE_INSTRUCTION] });
  }
  const unmatched = hits.length === 0;
  if (unmatched) {
    const { risk, instructions } = rules.unmatched;
    hits.push({ id: "unmatched", risk, label: "no rule", instructions: instructions.length > 0 ? instructions : [NO_RULE_INSTRUCTION] });
  }

  // A set: the same instruction from two rules is listed once.
  const instructions = new Map<string, Instruction>();
  for (const hit of hits) {
    for (const text of hit.instructions) instructions.set(`${hit.risk}\n${text}`, { risk: hit.risk, text });
  }
  return {
    risk: hits.reduce<Risk>((highest, hit) => (RANK[hit.risk] > RANK[highest] ? hit.risk : highest), "low"),
    instructions: [...instructions.values()].sort((a, b) => RANK[b.risk] - RANK[a.risk]),
    rules: [...hits].sort((a, b) => RANK[b.risk] - RANK[a.risk]),
    matched: unmatched ? [] : hits.map((hit) => (hit.id === "rules-file" ? `${RULES_FILE} (always high)` : `${hit.label} (${hit.risk})`)),
    unmatched,
  };
}

/**
 * A file's rules for reading: riskiest first, each instruction once, under
 * the riskiest rule that gives it.
 */
export function checksByRule(review: FileReview): RuleMatch[] {
  const seen = new Set<string>();
  return review.rules.map((rule) => ({ ...rule, instructions: rule.instructions.filter((text) => {
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    }),
  }));
}

/**
 * The review of a whole pull request: every rule that matches one of its
 * files, once, riskiest first, with the files it covers (in `order`).
 */
export function reviewGuide(files: Map<string, FileReview>, order: string[]): { rule: RuleMatch; labels: string[]; files: string[] }[] {
  const guide = new Map<string, { rule: RuleMatch; labels: string[]; files: string[] }>();
  for (const path of order) {
    for (const rule of files.get(path)?.rules ?? []) {
      const entry = guide.get(rule.id) ?? { rule, labels: [], files: [] };
      // The patterns it matched by, across the files.
      if (!entry.labels.includes(rule.label)) entry.labels.push(rule.label);
      entry.files.push(path);
      guide.set(rule.id, entry);
    }
  }
  const position = (id: string) => (id.startsWith("line:") ? Number.parseInt(id.slice(5), 10) : id === "rules-file" ? -1 : Infinity);
  return [...guide.values()].sort((a, b) => {
    const byRisk = RANK[b.rule.risk] - RANK[a.rule.risk];
    return byRisk !== 0 ? byRisk : position(a.rule.id) - position(b.rule.id);
  });
}
