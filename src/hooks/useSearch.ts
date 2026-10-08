import { useInfiniteQuery } from "@tanstack/react-query";
import { graphql } from "../lib/api";
import { SEARCH_ISSUES } from "../lib/queries";
import type { SearchIssueNode, SearchIssuesResult } from "../lib/types";

/** Paginated GitHub issue/PR search. */
export function useIssueSearch(query: string, enabled = true) {
  const result = useInfiniteQuery({
    queryKey: ["search-issues", query],
    queryFn: ({ pageParam }) =>
      graphql<SearchIssuesResult>(SEARCH_ISSUES, { query, first: 25, after: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.search.pageInfo.hasNextPage ? last.search.pageInfo.endCursor : undefined),
    enabled,
  });
  const nodes: SearchIssueNode[] = result.data?.pages.flatMap((p) => p.search.nodes) ?? [];
  const total = result.data?.pages[0]?.search.issueCount;
  return { ...result, nodes, total };
}
