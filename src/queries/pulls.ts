import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { encodePath, graphql, restAll, restSend } from "../lib/api";
import {
  ADD_COMMENT,
  CLOSE_PULL,
  CONVERT_TO_DRAFT,
  DISABLE_AUTO_MERGE,
  ENABLE_AUTO_MERGE,
  MARK_FILE_VIEWED,
  PULL,
  PULL_CHECKS,
  PULL_COMMITS,
  PULL_FILES,
  PULL_THREADS,
  PULL_TIMELINE,
  READY_FOR_REVIEW,
  REOPEN_PULL,
  REPLY_TO_THREAD,
  RESOLVE_THREAD,
  UNMARK_FILE_VIEWED,
  UNRESOLVE_THREAD,
  UPDATE_PULL_BRANCH,
} from "../lib/queries";
import type { GraphQLDocument } from "../lib/schema";
import type {
  FileViewedState,
  MergeMethod,
  PullCommitNode,
  PullCommitsResult,
  PullFilesResult,
  PullThreadsResult,
  ReviewThread,
  UpdateBranchMethod,
} from "../lib/types";
import type { ThreadActions } from "../components/Timeline";
import { affects, keys } from "./keys";
import { patchQueries, useAppMutation } from "./mutation";

/** A changed file of a pull request, with its patch (REST `diff-entry`). */
export const RestPullFile = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.enum(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
});
export type RestPullFile = z.infer<typeof RestPullFile>;

/** The first page of a GraphQL list: no cursor yet (typed so later pages can pass one). */
function noCursor(): string | null {
  return null;
}

export const pullQueries = {
  detail: (owner: string, repo: string, number: number) =>
    queryOptions({
      queryKey: keys.pull.detail(owner, repo, number),
      queryFn: () => graphql(PULL, { owner, name: repo, number }),
    }),
  timeline: (owner: string, repo: string, number: number) =>
    infiniteQueryOptions({
      queryKey: keys.pull.timeline(owner, repo, number),
      queryFn: ({ pageParam }) => graphql(PULL_TIMELINE, { owner, name: repo, number, after: pageParam }),
      initialPageParam: noCursor(),
      getNextPageParam: (last) => {
        const items = last.repository?.pullRequest?.timelineItems;
        return items?.pageInfo.hasNextPage === true ? items.pageInfo.endCursor : undefined;
      },
    }),
  threads: (owner: string, repo: string, number: number) =>
    queryOptions({
      queryKey: keys.pull.threads(owner, repo, number),
      queryFn: async () => {
        const threads: ReviewThread[] = [];
        let after: string | null = null;
        do {
          const data: PullThreadsResult = await graphql(PULL_THREADS, { owner, name: repo, number, after });
          const connection = data.repository?.pullRequest?.reviewThreads;
          if (!connection) break;
          threads.push(...connection.nodes);
          after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
        } while (after !== null && after !== "" && threads.length < 2000);
        return threads;
      },
    }),
  /** Changed files with their patches (REST). A new head commit means new patches. */
  patches: (owner: string, repo: string, number: number, headSha: string) =>
    queryOptions({
      queryKey: keys.pull.patches(owner, repo, number, headSha),
      queryFn: () => restAll(RestPullFile, `/repos/${owner}/${repo}/pulls/${number.toString()}/files`, { query: { per_page: 100 } }, 3000),
      staleTime: Infinity,
      gcTime: 15 * 60_000,
      meta: { persist: false },
    }),
  /** Per-file "viewed" state for the signed-in user (GraphQL only). */
  viewed: (owner: string, repo: string, number: number) =>
    queryOptions({
      queryKey: keys.pull.viewed(owner, repo, number),
      queryFn: async () => {
        const viewed: Record<string, FileViewedState> = {};
        let after: string | null = null;
        let pages = 0;
        do {
          const data: PullFilesResult = await graphql(PULL_FILES, { owner, name: repo, number, after });
          const files = data.repository?.pullRequest?.files;
          if (!files) break;
          for (const f of files.nodes) viewed[f.path] = f.viewerViewedState;
          after = files.pageInfo.hasNextPage ? files.pageInfo.endCursor : null;
        } while (after !== null && after !== "" && ++pages < 30);
        return viewed;
      },
    }),
  commits: (owner: string, repo: string, number: number) =>
    queryOptions({
      queryKey: keys.pull.commits(owner, repo, number),
      queryFn: async () => {
        const commits: PullCommitNode[] = [];
        let after: string | null = null;
        do {
          const data: PullCommitsResult = await graphql(PULL_COMMITS, { owner, name: repo, number, after });
          const connection = data.repository?.pullRequest?.commits;
          if (!connection) break;
          commits.push(...connection.nodes);
          after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
        } while (after !== null && after !== "" && commits.length < 1000);
        return commits;
      },
    }),
  checks: (owner: string, repo: string, number: number) =>
    queryOptions({
      queryKey: keys.pull.checks(owner, repo, number),
      queryFn: () => graphql(PULL_CHECKS, { owner, name: repo, number }),
      staleTime: 15_000,
      // Checks change while CI runs; poll only while something is still running.
      refetchInterval: (query) => {
        const contexts = query.state.data?.repository?.pullRequest?.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
        const running = contexts.some((c) => {
          if (c.__typename === "CheckRun" && "status" in c) return c.status !== "COMPLETED";
          if (c.__typename === "StatusContext" && "state" in c) return c.state === "PENDING" || c.state === "EXPECTED";
          return false;
        });
        return running ? 15_000 : false;
      },
    }),
};

/** An empty string as `undefined`, so GitHub uses its default. */
function orUndefined(text: string): string | undefined {
  return text === "" ? undefined : text;
}

/** Data every tab of a pull request shows; started as soon as the PR opens. */
/** Diffs up to this size load ahead of time, with the pull request; bigger ones once it's open. */
const PRELOAD_DIFF = { files: 100, lines: 2000 };

/**
 * Starts loading a pull request's diff as soon as its head commit is known,
 * so the Files tab is ready when it's opened. When only preloading (a row
 * scrolled into view), large diffs wait until the pull request is opened.
 */
export function warmPullDiff(queryClient: QueryClient, owner: string, repo: string, number: number, preload: boolean) {
  void queryClient
    .ensureQueryData(pullQueries.detail(owner, repo, number))
    .then((data) => {
      const pr = data.repository?.pullRequest;
      if (!pr) return;
      const small = pr.changedFiles <= PRELOAD_DIFF.files && pr.additions + pr.deletions <= PRELOAD_DIFF.lines;
      if (!preload || small) void queryClient.prefetchQuery(pullQueries.patches(owner, repo, number, pr.headRefOid));
    })
    .catch(() => undefined);
}

export function pullTabQueries(owner: string, repo: string, number: number) {
  return {
    timeline: pullQueries.timeline(owner, repo, number),
    threads: pullQueries.threads(owner, repo, number),
    viewed: pullQueries.viewed(owner, repo, number),
    commits: pullQueries.commits(owner, repo, number),
    checks: pullQueries.checks(owner, repo, number),
  };
}

// ---------------------------------------------------------------- mutations

/** Changes to the pull request itself: comments, state, branch, merging. */
export function usePullMutations(owner: string, repo: string, number: number) {
  const invalidates = affects.pull(owner, repo, number);

  const graphqlAction = useAppMutation({
    mutationFn: ({ document, variables }: { document: GraphQLDocument<z.ZodType>; variables: Record<string, unknown>; done: string }) =>
      graphql(document, variables),
    success: (vars) => vars.done,
    invalidates,
  });

  const comment = useAppMutation({
    mutationFn: ({ subjectId, body }: { subjectId: string; body: string }) => graphql(ADD_COMMENT, { subjectId, body }),
    success: "Comment added",
    invalidates,
  });

  const updateBranch = useAppMutation({
    mutationFn: ({ pullRequestId, headSha, method }: { pullRequestId: string; headSha: string; method: UpdateBranchMethod; base: string }) =>
      graphql(UPDATE_PULL_BRANCH, { pullRequestId, expectedHeadOid: headSha, updateMethod: method }),
    success: ({ method, base }) => (method === "REBASE" ? `Rebasing onto ${base}…` : `Merging ${base} into the branch…`),
    invalidates,
  });

  const deleteBranch = useAppMutation({
    mutationFn: (branch: string) => restSend(`/repos/${owner}/${repo}/git/refs/heads/${encodePath(branch)}`, { method: "DELETE" }),
    success: "Branch deleted",
    invalidates: [...invalidates, ...affects.branches(owner, repo)],
  });

  const submitReview = useAppMutation({
    mutationFn: (review: {
      commitId: string;
      event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
      body: string;
      comments: { path: string; line: number; side: "LEFT" | "RIGHT"; body: string }[];
    }) =>
      restSend(`/repos/${owner}/${repo}/pulls/${number.toString()}/reviews`, {
        method: "POST",
        body: { commit_id: review.commitId, body: orUndefined(review.body.trim()), event: review.event, comments: review.comments },
      }),
    success: (review) =>
      review.event === "APPROVE" ? "Approved" : review.event === "REQUEST_CHANGES" ? "Changes requested" : "Review submitted",
    invalidates,
  });

  const merge = useAppMutation({
    mutationFn: async (options: {
      method: MergeMethod;
      headSha: string;
      title: string;
      message: string;
      deleteBranch: string | null;
    }) => {
      await restSend(`/repos/${owner}/${repo}/pulls/${number.toString()}/merge`, {
        method: "PUT",
        body: {
          merge_method: options.method.toLowerCase(),
          sha: options.headSha,
          ...(options.method === "REBASE" ? {} : { commit_title: orUndefined(options.title.trim()), commit_message: options.message }),
        },
      });
      if (options.deleteBranch === null || options.deleteBranch === "") return null;
      try {
        await restSend(`/repos/${owner}/${repo}/git/refs/heads/${encodePath(options.deleteBranch)}`, { method: "DELETE" });
        return null;
      } catch (e) {
        return e;
      }
    },
    success: (_options, branchError) => (branchError === null ? "Pull request merged" : null),
    invalidates: [...invalidates, ...affects.branches(owner, repo)],
  });

  const enableAutoMerge = useAppMutation({
    mutationFn: ({ pullRequestId, method }: { pullRequestId: string; method: MergeMethod }) =>
      graphql(ENABLE_AUTO_MERGE, { pullRequestId, mergeMethod: method }),
    success: "Auto-merge enabled",
    invalidates,
  });

  return useMemo(() => {
    const act = (document: GraphQLDocument<z.ZodType>, done: string) => (pullRequestId: string) =>
      graphqlAction.mutateAsync({ document, variables: { pullRequestId }, done });
    return {
      comment,
      updateBranch,
      deleteBranch,
      submitReview,
      merge,
      enableAutoMerge,
      readyForReview: act(READY_FOR_REVIEW, "Marked ready for review"),
      convertToDraft: act(CONVERT_TO_DRAFT, "Converted to draft"),
      close: act(CLOSE_PULL, "Pull request closed"),
      reopen: act(REOPEN_PULL, "Pull request reopened"),
      disableAutoMerge: act(DISABLE_AUTO_MERGE, "Auto-merge disabled"),
    };
  }, [graphqlAction, comment, updateBranch, deleteBranch, submitReview, merge, enableAutoMerge]);
}

/** Replying to and resolving review threads, as the timeline components expect. */
export function useThreadActions(owner: string, repo: string, number: number): ThreadActions {
  const invalidates = affects.threads(owner, repo, number);
  const reply = useAppMutation({
    mutationFn: ({ threadId, body }: { threadId: string; body: string }) => graphql(REPLY_TO_THREAD, { threadId, body }),
    invalidates,
  });
  const resolve = useAppMutation({
    mutationFn: async ({ threadId, resolved }: { threadId: string; resolved: boolean }) => {
      if (resolved) await graphql(RESOLVE_THREAD, { threadId });
      else await graphql(UNRESOLVE_THREAD, { threadId });
    },
    optimistic: ({ threadId, resolved }, queryClient) =>
      patchQueries<ReviewThread[]>(queryClient, { queryKey: keys.pull.threads(owner, repo, number), exact: true }, (threads) =>
        threads.map((t) => (t.id === threadId ? { ...t, isResolved: resolved } : t)),
      ),
    invalidates,
  });
  const replyAsync = reply.mutateAsync;
  const resolveAsync = resolve.mutateAsync;
  return useMemo(
    () => ({
      reply: async (thread, body) => {
        await replyAsync({ threadId: thread.id, body });
      },
      setResolved: async (thread, resolved) => {
        await resolveAsync({ threadId: thread.id, resolved });
      },
    }),
    [replyAsync, resolveAsync],
  );
}

/** Inline comments posted right away (outside a pending review). */
export function useInlineComment(owner: string, repo: string, number: number) {
  return useAppMutation({
    mutationFn: (comment: { body: string; commitId: string; path: string; line: number; side: "LEFT" | "RIGHT" }) =>
      restSend(`/repos/${owner}/${repo}/pulls/${number.toString()}/comments`, {
        method: "POST",
        body: { body: comment.body, commit_id: comment.commitId, path: comment.path, line: comment.line, side: comment.side },
      }),
    success: "Comment added",
    invalidates: affects.threads(owner, repo, number),
  });
}

export function useToggleViewed(owner: string, repo: string, number: number) {
  return useAppMutation({
    mutationFn: async ({ pullRequestId, path, viewed }: { pullRequestId: string; path: string; viewed: boolean }) => {
      if (viewed) await graphql(MARK_FILE_VIEWED, { pullRequestId, path });
      else await graphql(UNMARK_FILE_VIEWED, { pullRequestId, path });
    },
    optimistic: ({ path, viewed }, queryClient) =>
      patchQueries<Record<string, FileViewedState>>(queryClient, { queryKey: keys.pull.viewed(owner, repo, number), exact: true }, (state) => ({
        ...state,
        [path]: viewed ? "VIEWED" : "UNVIEWED",
      })),
  });
}
