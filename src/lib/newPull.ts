// Helpers for opening pull requests: what to suggest, and what to prefill.

import type { BranchesRepo } from "./types";

/** A pull request's source: a branch, in this repository or in a fork of it. */
export interface HeadRef {
  /** "owner/name" of the repository the branch is in. */
  repo: string;
  branch: string;
}

/** The `head` GitHub's APIs expect: "branch", or "owner:branch" for a fork. */
export function headSpec(baseRepo: string, head: HeadRef): string {
  const headOwner = head.repo.split("/")[0] ?? "";
  return sameRepo(baseRepo, head.repo) ? head.branch : `${headOwner}:${head.branch}`;
}

/** What suggestions read of a commit: its message. */
export interface CommitMessage {
  commit: { message: string };
}

export function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** What GitHub prefills as a title: the commit's subject for one commit, otherwise the branch name. */
export function suggestedTitle(branch: string, commits: readonly CommitMessage[]): string {
  const [only] = commits;
  if (commits.length === 1 && only !== undefined) return (only.commit.message.split("\n")[0] ?? "").trim();
  const words = branch.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The repository's pull request template, else a single commit's message body. */
export function suggestedBody(template: string | null | undefined, commits: readonly CommitMessage[]): string {
  if (template !== null && template !== undefined && template.trim() !== "") return template;
  const [only] = commits;
  if (commits.length === 1 && only !== undefined) return only.commit.message.split("\n").slice(1).join("\n").trim();
  return "";
}

export interface RecentBranch {
  /** Where the pull request would go: the repository, or the parent of a fork. */
  baseRepo: string;
  /** That repository's default branch. */
  base: string | null;
  head: HeadRef;
  oid: string;
  committedDate: string;
  headline: string;
}

/**
 * Branches worth a "Compare & pull request" prompt: pushed lately by the
 * viewer, not a default branch, and without an open pull request.
 */
export function recentBranches(repos: BranchesRepo[], viewer: string, now = Date.now(), maxAgeMs = 2 * 24 * 3600_000): RecentBranch[] {
  const found: RecentBranch[] = [];
  for (const repo of repos) {
    for (const ref of repo.refs?.nodes ?? []) {
      const tip = ref.target;
      if (tip === null || tip.oid === undefined || tip.oid === "" || tip.committedDate === undefined || tip.committedDate === "") continue;
      if (ref.name === repo.defaultBranchRef?.name) continue;
      if (ref.associatedPullRequests.totalCount > 0) continue;
      if (tip.author?.user?.login.toLowerCase() !== viewer.toLowerCase()) continue;
      if (now - Date.parse(tip.committedDate) > maxAgeMs) continue;
      found.push({
        baseRepo: repo.parent?.nameWithOwner ?? repo.nameWithOwner,
        base: repo.parent !== null ? (repo.parent.defaultBranchRef?.name ?? null) : (repo.defaultBranchRef?.name ?? null),
        head: { repo: repo.nameWithOwner, branch: ref.name },
        oid: tip.oid,
        committedDate: tip.committedDate,
        headline: tip.messageHeadline ?? "",
      });
    }
  }
  return found.sort((a, b) => Date.parse(b.committedDate) - Date.parse(a.committedDate));
}
