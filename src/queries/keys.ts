// Every query key in the app, in one hierarchy:
//
//   ["viewer", ...]                       the signed-in user
//   ["owner", login]                      a user or organization page
//   ["search", kind, query]               search results (the PR inbox is a search too)
//   ["notifications", ...]
//   ["repo", owner, repo, ...]            everything about one repository:
//     ..., "pull", number, ...            one pull request and its tabs
//     ..., "issue", number, ...
//     ..., "actions", ...                 workflow runs, jobs and logs
//
// Invalidating a prefix (e.g. a pull request's) refetches every active query
// below it, so mutations name what they change with the `affects` helpers at
// the bottom rather than listing individual queries. Owner and repository
// names are lowercased: GitHub treats them case-insensitively.

import type { QueryKey } from "@tanstack/react-query";

export type InboxFilter = "review" | "created" | "assigned" | "mentioned" | "reviewed";
export type NotificationFilter = "unread" | "participating" | "all";
export type ViewerRepoTab = "yours" | "starred";

export interface RunFilter {
  workflow?: number;
  /** "in_progress" or "failure"; anything GitHub's `status` parameter takes. */
  status?: string;
  branch?: string;
}

const repoBase = (owner: string, repo: string) => ["repo", owner.toLowerCase(), repo.toLowerCase()] as const;
const pullBase = (owner: string, repo: string, number: number) => [...repoBase(owner, repo), "pull", number] as const;
const issueBase = (owner: string, repo: string, number: number) => [...repoBase(owner, repo), "issue", number] as const;
const actionsBase = (owner: string, repo: string) => [...repoBase(owner, repo), "actions"] as const;
const runBase = (owner: string, repo: string, runId: number) => [...actionsBase(owner, repo), "run", runId] as const;
const jobBase = (owner: string, repo: string, jobId: number) => [...actionsBase(owner, repo), "job", jobId] as const;
const releasesBase = (owner: string, repo: string) => [...repoBase(owner, repo), "releases"] as const;

export const keys = {
  viewer: {
    all: () => ["viewer"] as const,
    profile: () => ["viewer", "profile"] as const,
    repos: (tab: ViewerRepoTab) => ["viewer", "repos", tab] as const,
    rateLimit: () => ["viewer", "rate-limit"] as const,
    /** Branches the viewer pushed lately, across their most recently pushed repositories. */
    recentBranches: () => ["viewer", "recent-branches"] as const,
  },
  owner: (login: string) => ["owner", login.toLowerCase()] as const,
  search: {
    all: () => ["search"] as const,
    issues: (query: string) => ["search", "issues", query] as const,
    repos: (query: string) => ["search", "repos", query] as const,
    users: (query: string) => ["search", "users", query] as const,
    inboxCounts: () => ["search", "inbox-counts"] as const,
  },
  notifications: {
    all: () => ["notifications"] as const,
    list: (filter: NotificationFilter) => ["notifications", "list", filter] as const,
    unread: () => ["notifications", "unread"] as const,
  },
  repo: {
    all: repoBase,
    detail: (owner: string, repo: string) => [...repoBase(owner, repo), "detail"] as const,
    readme: (owner: string, repo: string) => [...repoBase(owner, repo), "readme"] as const,
    branches: (owner: string, repo: string) => [...repoBase(owner, repo), "branches"] as const,
    contents: (owner: string, repo: string, ref: string, path: string) => [...repoBase(owner, repo), "contents", ref, path] as const,
    blob: (owner: string, repo: string, ref: string, path: string) => [...repoBase(owner, repo), "blob", ref, path] as const,
    blobHtml: (owner: string, repo: string, ref: string, path: string) => [...repoBase(owner, repo), "blob-html", ref, path] as const,
    commits: (owner: string, repo: string, ref: string) => [...repoBase(owner, repo), "commits", ref] as const,
    commit: (owner: string, repo: string, sha: string) => [...repoBase(owner, repo), "commit", sha] as const,
    recentBranches: (owner: string, repo: string) => [...repoBase(owner, repo), "recent-branches"] as const,
    /** What opening a pull request needs: default branch, templates, the viewer's forks. */
    newPull: (owner: string, repo: string) => [...repoBase(owner, repo), "new-pull"] as const,
    compareAll: (owner: string, repo: string) => [...repoBase(owner, repo), "compare"] as const,
    /** `head` as GitHub's APIs take it: "branch" or "owner:branch". */
    compare: (owner: string, repo: string, base: string, head: string) => [...repoBase(owner, repo), "compare", base, head] as const,
    assignableUsers: (owner: string, repo: string, query: string) => [...repoBase(owner, repo), "assignable-users", query] as const,
    markdown: (owner: string, repo: string, text: string) => [...repoBase(owner, repo), "markdown", text] as const,
  },
  pull: {
    all: pullBase,
    detail: (owner: string, repo: string, number: number) => [...pullBase(owner, repo, number), "detail"] as const,
    timeline: (owner: string, repo: string, number: number) => [...pullBase(owner, repo, number), "timeline"] as const,
    threads: (owner: string, repo: string, number: number) => [...pullBase(owner, repo, number), "threads"] as const,
    patches: (owner: string, repo: string, number: number, headSha: string) =>
      [...pullBase(owner, repo, number), "patches", headSha] as const,
    viewed: (owner: string, repo: string, number: number) => [...pullBase(owner, repo, number), "viewed"] as const,
    commits: (owner: string, repo: string, number: number) => [...pullBase(owner, repo, number), "commits"] as const,
    checks: (owner: string, repo: string, number: number) => [...pullBase(owner, repo, number), "checks"] as const,
  },
  issue: {
    all: issueBase,
    /** The issue with its timeline, paginated. */
    detail: (owner: string, repo: string, number: number) => [...issueBase(owner, repo, number), "detail"] as const,
  },
  releases: {
    all: releasesBase,
    list: (owner: string, repo: string) => [...releasesBase(owner, repo), "list"] as const,
    /** `lookup`: "tag:<tag>", "id:<id>" or "latest". */
    one: (owner: string, repo: string, lookup: string) => [...releasesBase(owner, repo), "one", lookup] as const,
  },
  actions: {
    all: actionsBase,
    workflows: (owner: string, repo: string) => [...actionsBase(owner, repo), "workflows"] as const,
    runs: (owner: string, repo: string, filter: RunFilter) =>
      [...actionsBase(owner, repo), "runs", { workflow: filter.workflow ?? null, status: filter.status ?? null, branch: filter.branch ?? null }] as const,
    run: runBase,
    runJobs: (owner: string, repo: string, runId: number) => [...runBase(owner, repo, runId), "jobs"] as const,
    job: jobBase,
    jobLog: (owner: string, repo: string, jobId: number) => [...jobBase(owner, repo, jobId), "log"] as const,
    annotations: (owner: string, repo: string, jobId: number) => [...jobBase(owner, repo, jobId), "annotations"] as const,
  },
};

/**
 * What each kind of change makes stale. Mutations pass these to
 * `useAppMutation({ invalidates })`; only queries currently on screen refetch,
 * the rest refetch when next shown.
 */
export const affects = {
  /** Anything about a pull request: comments, reviews, state, merging. */
  pull: (owner: string, repo: string, number: number): QueryKey[] => [
    keys.pull.all(owner, repo, number),
    keys.search.all(),
    keys.repo.detail(owner, repo),
  ],
  /** Review threads (replies, resolving) show in the conversation and the files tab. */
  threads: (owner: string, repo: string, number: number): QueryKey[] => [
    keys.pull.threads(owner, repo, number),
    keys.pull.timeline(owner, repo, number),
  ],
  issue: (owner: string, repo: string, number: number): QueryKey[] => [
    keys.issue.all(owner, repo, number),
    keys.search.all(),
    keys.repo.detail(owner, repo),
  ],
  /** A new pull request from `headRepo` ("owner/name") into owner/repo. */
  newPull: (owner: string, repo: string, headRepo: string): QueryKey[] => {
    const [headOwner, headName] = headRepo.split("/");
    return [
      keys.search.all(),
      keys.repo.detail(owner, repo),
      keys.repo.compareAll(owner, repo),
      keys.repo.recentBranches(owner, repo),
      keys.repo.recentBranches(headOwner, headName),
      keys.viewer.recentBranches(),
    ];
  },
  star: (owner: string, repo: string): QueryKey[] => [keys.repo.detail(owner, repo), keys.viewer.repos("starred"), keys.viewer.profile()],
  branches: (owner: string, repo: string): QueryKey[] => [keys.repo.branches(owner, repo)],
  notifications: (): QueryKey[] => [keys.notifications.all()],
  /** Re-running or cancelling changes the runs and every check that shows them. */
  actions: (owner: string, repo: string): QueryKey[] => [keys.repo.all(owner, repo)],
};
