import { infiniteQueryOptions, keepPreviousData, queryOptions, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { graphql } from "../lib/api";
import type { Branch } from "../lib/branchSearch";
import { REPO_BRANCHES, SEARCH_BRANCHES } from "../lib/queries";
import type { BranchNameNode } from "../lib/types";
import { isGuest } from "../lib/guest";
import { guestBranchPage } from "./guest";
import { keys } from "./keys";

/** Pages of 100, so up to 3,000 branches. Past that, typing also searches GitHub. */
const MAX_PAGES = 30;

export interface BranchPage {
  defaultBranch: string | null;
  /** How many branches the repository has, loaded or not. */
  total: number;
  branches: Branch[];
  next: string | null;
}

const toBranch = (node: BranchNameNode): Branch => ({ name: node.name, committedDate: node.target?.committedDate ?? null });

export const branchQueries = {
  /** Every branch, most recently committed first. */
  list: (owner: string, repo: string) =>
    infiniteQueryOptions({
      queryKey: keys.repo.branchList(owner, repo),
      queryFn: async ({ pageParam }: { pageParam: string | null }): Promise<BranchPage> => {
        if (isGuest()) {
          // REST lists branches by name, without a total or commit dates.
          const page = await guestBranchPage(owner, repo, pageParam);
          return { defaultBranch: null, total: page.branches.length, ...page };
        }
        const { repository } = await graphql(REPO_BRANCHES, { owner, name: repo, after: pageParam });
        const refs = repository?.refs;
        return {
          defaultBranch: repository?.defaultBranchRef?.name ?? null,
          total: refs?.totalCount ?? 0,
          branches: (refs?.nodes ?? []).map(toBranch),
          next: refs?.pageInfo.hasNextPage === true ? refs.pageInfo.endCursor : null,
        };
      },
      initialPageParam: null,
      getNextPageParam: (last, pages) => (pages.length < MAX_PAGES ? (last.next ?? undefined) : undefined),
      staleTime: 2 * 60_000,
      // A reload fetches every page again; opening a screen with a branch picker is soon enough.
      refetchOnWindowFocus: false,
    }),
  /** GitHub's branch search, for branches the list hasn't loaded. */
  search: (owner: string, repo: string, query: string) =>
    queryOptions({
      queryKey: keys.repo.branchSearch(owner, repo, query),
      queryFn: async () =>
        isGuest()
          ? [] // No branch search without a token; the loaded list is filtered instead.
          : ((await graphql(SEARCH_BRANCHES, { owner, name: repo, query })).repository?.refs?.nodes ?? []).map(toBranch),
      staleTime: 2 * 60_000,
      meta: { persist: false },
    }),
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * A repository's branches, for picking one. With `loadAll`, the rest of the
 * list loads in the background, a page at a time. Until the list is
 * complete, `query` is also sent to GitHub's search, so any branch can be
 * found right away.
 */
export function useBranches(owner: string, repo: string, { loadAll = false, query = "" }: { loadAll?: boolean; query?: string } = {}) {
  const list = useInfiniteQuery(branchQueries.list(owner, repo));
  const pages = list.data?.pages ?? [];
  const complete = pages.length > 0 && pages[pages.length - 1]?.next === null;

  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = list;
  useEffect(() => {
    // Without cancelRefetch, two screens loading the same list don't restart each other's requests.
    if (loadAll && hasNextPage && !isFetching && !isFetchNextPageError) void fetchNextPage({ cancelRefetch: false });
  }, [loadAll, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);

  const typed = query.trim();
  const needle = useDebounced(typed, 300);
  const search = useQuery({
    ...branchQueries.search(owner, repo, needle),
    enabled: !complete && needle !== "",
    placeholderData: keepPreviousData,
  });

  const loaded = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.branches), [list.data]);
  const found = !complete && typed !== "" ? search.data : undefined;
  const branches = useMemo(() => (found ? loaded.concat(found) : loaded), [loaded, found]);
  return {
    branches,
    defaultBranch: pages[0]?.defaultBranch ?? null,
    total: pages[0]?.total ?? 0,
    loaded: loaded.length,
    /** Nothing to show yet. */
    pending: list.isPending,
    error: list.error,
    retry: () => void list.refetch(),
    /** More of the list is on its way. */
    loadingMore: loadAll && hasNextPage && !isFetchNextPageError,
    /** GitHub is still being searched for what was typed. */
    searching: !complete && typed !== "" && (typed !== needle || search.isFetching),
  };
}
