import { queryOptions } from "@tanstack/react-query";
import { encodePath, graphql, rest } from "../lib/api";
import { headSpec, sameRepo, type HeadRef } from "../lib/newPull";
import { ASSIGNABLE_USERS, NEW_PULL, RECENT_BRANCHES, REPO_RECENT_BRANCHES } from "../lib/queries";
import type {
  AssignableUsersResult,
  NewPullResult,
  RecentBranchesResult,
  RepoRecentBranchesResult,
  RestComparison,
  RestPullSimple,
} from "../lib/types";
import { affects, keys } from "./keys";
import { useAppMutation } from "./mutation";

export interface Comparison {
  comparison: RestComparison;
  /** An open pull request for the same branches, which GitHub won't duplicate. */
  existing: RestPullSimple | null;
}

export const newPullQueries = {
  /** For the inbox's "Compare & pull request" prompts. */
  recentBranches: () =>
    queryOptions({
      queryKey: keys.viewer.recentBranches(),
      queryFn: async () => (await graphql<RecentBranchesResult>(RECENT_BRANCHES)).viewer.repositories.nodes,
      staleTime: 30_000,
    }),
  repoBranches: (owner: string, repo: string) =>
    queryOptions({
      queryKey: keys.repo.recentBranches(owner, repo),
      queryFn: async () => (await graphql<RepoRecentBranchesResult>(REPO_RECENT_BRANCHES, { owner, name: repo })).repository,
      staleTime: 30_000,
    }),
  context: (owner: string, repo: string) =>
    queryOptions({
      queryKey: keys.repo.newPull(owner, repo),
      queryFn: async () => (await graphql<NewPullResult>(NEW_PULL, { owner, name: repo })).repository,
      staleTime: 10 * 60_000,
    }),
  compare: (owner: string, repo: string, base: string, head: HeadRef) => {
    const spec = headSpec(`${owner}/${repo}`, head);
    const [headOwner] = head.repo.split("/");
    return queryOptions({
      queryKey: keys.repo.compare(owner, repo, base, spec),
      queryFn: async (): Promise<Comparison> => {
        // Branch names may contain "/", which the compare path keeps as is.
        const fork = sameRepo(`${owner}/${repo}`, head.repo) ? "" : `${headOwner}:`;
        const [comparison, open] = await Promise.all([
          rest<RestComparison>(`/repos/${owner}/${repo}/compare/${encodePath(base)}...${fork}${encodePath(head.branch)}`),
          rest<RestPullSimple[]>(`/repos/${owner}/${repo}/pulls`, {
            query: { state: "open", base, head: `${headOwner}:${head.branch}`, per_page: 1 },
          }),
        ]);
        return { comparison, existing: Array.isArray(open) ? (open[0] ?? null) : null };
      },
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      meta: { persist: false },
    });
  },
  assignableUsers: (owner: string, repo: string, query: string) =>
    queryOptions({
      queryKey: keys.repo.assignableUsers(owner, repo, query),
      queryFn: async () =>
        (await graphql<AssignableUsersResult>(ASSIGNABLE_USERS, { owner, name: repo, query: query || null })).repository?.assignableUsers.nodes ?? [],
      staleTime: 10 * 60_000,
    }),
  /** Markdown rendered by GitHub, for previewing a description. */
  markdown: (owner: string, repo: string, text: string) =>
    queryOptions({
      queryKey: keys.repo.markdown(owner, repo, text),
      queryFn: () => rest<string>("/markdown", { method: "POST", body: { text, mode: "gfm", context: `${owner}/${repo}` } }),
      staleTime: Infinity,
      gcTime: 5 * 60_000,
      meta: { persist: false },
    }),
};

export interface NewPullInput {
  base: string;
  head: HeadRef;
  title: string;
  body: string;
  draft: boolean;
  reviewers: string[];
}

/** Opens a pull request into owner/repo, then requests the reviewers. */
export function useCreatePull(owner: string, repo: string) {
  return useAppMutation({
    mutationFn: async (input: NewPullInput) => {
      const baseRepo = `${owner}/${repo}`;
      const fromFork = !sameRepo(baseRepo, input.head.repo);
      const pull = await rest<{ number: number }>(`/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        body: {
          title: input.title.trim(),
          body: input.body,
          base: input.base,
          head: headSpec(baseRepo, input.head),
          // Needed when the fork belongs to the same organization.
          head_repo: fromFork ? input.head.repo.split("/")[1] : undefined,
          draft: input.draft,
        },
      });
      // Requesting reviewers is a separate call; the pull request exists either way.
      let reviewersError: unknown = null;
      if (input.reviewers.length > 0) {
        try {
          await rest(`/repos/${owner}/${repo}/pulls/${pull.number}/requested_reviewers`, {
            method: "POST",
            body: { reviewers: input.reviewers },
          });
        } catch (e) {
          reviewersError = e;
        }
      }
      return { number: pull.number, reviewersError };
    },
    success: (input) => (input.draft ? "Draft pull request opened" : "Pull request opened"),
    invalidates: (input) => affects.newPull(owner, repo, input.head.repo),
  });
}
