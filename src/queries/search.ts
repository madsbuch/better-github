import { infiniteQueryOptions, queryOptions, useInfiniteQuery } from "@tanstack/react-query";
import { graphql } from "../lib/api";
import { SEARCH_COUNTS, SEARCH_ISSUES, SEARCH_REPOS, SEARCH_USERS } from "../lib/queries";
import type { SearchIssueNode } from "../lib/types";
import { keys, type InboxFilter } from "./keys";

interface InboxFilterDef {
  id: InboxFilter;
  label: string;
  query: string;
}

/** The first filter, and the fallback. */
const REVIEW_FILTER: InboxFilterDef = { id: "review", label: "Review requests", query: "is:open is:pr review-requested:@me archived:false" };

export const INBOX_FILTERS: InboxFilterDef[] = [
  REVIEW_FILTER,
  { id: "created", label: "Created", query: "is:open is:pr author:@me archived:false" },
  { id: "assigned", label: "Assigned", query: "is:open assignee:@me archived:false" },
  { id: "mentioned", label: "Mentioned", query: "is:open mentions:@me archived:false" },
  { id: "reviewed", label: "Reviewed", query: "is:open is:pr reviewed-by:@me -author:@me archived:false" },
];

export function inboxQuery(filter: InboxFilter): string {
  const found = INBOX_FILTERS.find((f) => f.id === filter) ?? REVIEW_FILTER;
  return `${found.query} sort:updated-desc`;
}

export const searchQueries = {
  /** Issues and pull requests, 25 per page. Also backs the PR inbox and repository lists. */
  issues: (query: string) =>
    infiniteQueryOptions({
      queryKey: keys.search.issues(query),
      queryFn: ({ pageParam }: { pageParam: string | null }) => graphql(SEARCH_ISSUES, { query, first: 25, after: pageParam }),
      initialPageParam: null,
      getNextPageParam: (last) => (last.search.pageInfo.hasNextPage === true ? last.search.pageInfo.endCursor : undefined),
    }),
  inbox: (filter: InboxFilter) => searchQueries.issues(inboxQuery(filter)),
  /** Badge counts for every inbox filter, in one request. */
  inboxCounts: () =>
    queryOptions({
      queryKey: keys.search.inboxCounts(),
      queryFn: async () => {
        const vars = Object.fromEntries(INBOX_FILTERS.map((f, i) => [`q${i}`, f.query]));
        const data = await graphql(SEARCH_COUNTS, vars);
        // Aliases c0…c4 answer q0…q4, in INBOX_FILTERS order.
        const answers = [data.c0, data.c1, data.c2, data.c3, data.c4];
        const counts: Record<InboxFilter, number> = { review: 0, created: 0, assigned: 0, mentioned: 0, reviewed: 0 };
        INBOX_FILTERS.forEach((f, i) => {
          counts[f.id] = answers[i]?.issueCount ?? 0;
        });
        return counts;
      },
    }),
  repos: (query: string) =>
    infiniteQueryOptions({
      queryKey: keys.search.repos(query),
      queryFn: ({ pageParam }: { pageParam: string | null }) => graphql(SEARCH_REPOS, { query, after: pageParam }),
      initialPageParam: null,
      getNextPageParam: (last) => (last.search.pageInfo.hasNextPage === true ? last.search.pageInfo.endCursor : undefined),
    }),
  users: (query: string) =>
    infiniteQueryOptions({
      queryKey: keys.search.users(query),
      queryFn: ({ pageParam }: { pageParam: string | null }) => graphql(SEARCH_USERS, { query, after: pageParam }),
      initialPageParam: null,
      getNextPageParam: (last) => (last.search.pageInfo.hasNextPage === true ? last.search.pageInfo.endCursor : undefined),
    }),
};

/** Paginated issue/PR search, flattened. */
export function useIssueSearch(query: string, enabled = true) {
  const result = useInfiniteQuery({ ...searchQueries.issues(query), enabled });
  const nodes: SearchIssueNode[] = result.data?.pages.flatMap((p) => p.search.nodes) ?? [];
  const total = result.data?.pages[0]?.search.issueCount;
  return { ...result, nodes, total };
}

/** A repository's pull request or issue list, as a search (so it shares the inbox's cache shape). */
export function repoListQuery(owner: string, repo: string, kind: "pulls" | "issues", state: "open" | "closed"): string {
  return `repo:${owner}/${repo} ${kind === "pulls" ? "is:pr" : "is:issue"} is:${state} sort:updated-desc`;
}
