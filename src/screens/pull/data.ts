import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { errorMessage, graphql, restAll } from "../../lib/api";
import {
  MARK_FILE_VIEWED,
  PULL,
  PULL_CHECKS,
  PULL_COMMITS,
  PULL_FILES,
  PULL_THREADS,
  REPLY_TO_THREAD,
  RESOLVE_THREAD,
  UNMARK_FILE_VIEWED,
  UNRESOLVE_THREAD,
} from "../../lib/queries";
import { useToast } from "../../lib/toast";
import type {
  FileViewedState,
  PullChecksResult,
  PullCommitNode,
  PullCommitsResult,
  PullFilesResult,
  PullResult,
  PullThreadsResult,
  RestPullFile,
  ReviewThread,
} from "../../lib/types";
import { repoKey } from "../../components/RepoParts";
import type { ThreadActions } from "../../components/Timeline";

export function pullKey(owner: string, repo: string, number: number) {
  return [...repoKey(owner, repo), "pull", number];
}

export function usePullDetail(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: [...pullKey(owner, repo, number), "detail"],
    queryFn: () => graphql<PullResult>(PULL, { owner, name: repo, number }),
  });
}

export function useThreads(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: [...pullKey(owner, repo, number), "threads"],
    queryFn: async () => {
      const threads: ReviewThread[] = [];
      let after: string | null = null;
      do {
        const data: PullThreadsResult = await graphql<PullThreadsResult>(PULL_THREADS, { owner, name: repo, number, after });
        const connection = data.repository?.pullRequest?.reviewThreads;
        if (!connection) break;
        threads.push(...connection.nodes);
        after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      } while (after && threads.length < 2000);
      return threads;
    },
  });
}

/** Changed files with their patches (REST), keyed by head commit. */
export function usePatches(owner: string, repo: string, number: number, headSha: string | undefined) {
  return useQuery({
    queryKey: [...pullKey(owner, repo, number), "patches", headSha],
    queryFn: () => restAll<RestPullFile>(`/repos/${owner}/${repo}/pulls/${number}/files`, { query: { per_page: 100 } }, 3000),
    enabled: !!headSha,
    staleTime: 10 * 60_000,
  });
}

/** Per-file "viewed" state for the signed-in user (GraphQL only). */
export function useViewedState(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: [...pullKey(owner, repo, number), "viewed"],
    queryFn: async () => {
      const viewed: Record<string, FileViewedState> = {};
      let after: string | null = null;
      let pages = 0;
      do {
        const data: PullFilesResult = await graphql<PullFilesResult>(PULL_FILES, { owner, name: repo, number, after });
        const files = data.repository?.pullRequest?.files;
        if (!files) break;
        for (const f of files.nodes) viewed[f.path] = f.viewerViewedState;
        after = files.pageInfo.hasNextPage ? files.pageInfo.endCursor : null;
      } while (after && ++pages < 30);
      return viewed;
    },
  });
}

export function useCommits(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: [...pullKey(owner, repo, number), "commits"],
    queryFn: async () => {
      const commits: PullCommitNode[] = [];
      let after: string | null = null;
      do {
        const data: PullCommitsResult = await graphql<PullCommitsResult>(PULL_COMMITS, { owner, name: repo, number, after });
        const connection = data.repository?.pullRequest?.commits;
        if (!connection) break;
        commits.push(...connection.nodes);
        after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      } while (after && commits.length < 1000);
      return commits;
    },
  });
}

export function useChecks(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: [...pullKey(owner, repo, number), "checks"],
    queryFn: () => graphql<PullChecksResult>(PULL_CHECKS, { owner, name: repo, number }),
    // Checks change while CI runs; keep this view fresh.
    refetchInterval: 30_000,
  });
}

export function useThreadActions(owner: string, repo: string, number: number): ThreadActions {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMemo(() => {
    const key = [...pullKey(owner, repo, number), "threads"];
    return {
      async reply(thread, body) {
        try {
          await graphql(REPLY_TO_THREAD, { threadId: thread.id, body });
          await queryClient.invalidateQueries({ queryKey: key });
        } catch (e) {
          toast.show(errorMessage(e), "error");
          throw e;
        }
      },
      async setResolved(thread, resolved) {
        const previous = queryClient.getQueryData<ReviewThread[]>(key);
        queryClient.setQueryData<ReviewThread[]>(key, (threads) =>
          threads?.map((t) => (t.id === thread.id ? { ...t, isResolved: resolved } : t)),
        );
        try {
          await graphql(resolved ? RESOLVE_THREAD : UNRESOLVE_THREAD, { threadId: thread.id });
          void queryClient.invalidateQueries({ queryKey: key });
        } catch (e) {
          queryClient.setQueryData(key, previous);
          toast.show(errorMessage(e), "error");
          throw e;
        }
      },
    } satisfies ThreadActions;
  }, [owner, repo, number, queryClient, toast]);
}

export function useToggleViewed(owner: string, repo: string, number: number, pullRequestId: string | undefined) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = [...pullKey(owner, repo, number), "viewed"];
  return async (path: string, viewed: boolean) => {
    if (!pullRequestId) return;
    queryClient.setQueryData<Record<string, FileViewedState>>(key, (state) => ({ ...state, [path]: viewed ? "VIEWED" : "UNVIEWED" }));
    try {
      await graphql(viewed ? MARK_FILE_VIEWED : UNMARK_FILE_VIEWED, { pullRequestId, path });
    } catch (e) {
      queryClient.setQueryData<Record<string, FileViewedState>>(key, (state) => ({ ...state, [path]: viewed ? "UNVIEWED" : "VIEWED" }));
      toast.show(errorMessage(e), "error");
    }
  };
}
