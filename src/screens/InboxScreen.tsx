import { CheckCircleIcon, SearchIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { graphql } from "../lib/api";
import { SEARCH_COUNTS } from "../lib/queries";
import { nav, useScreen } from "../lib/router";
import { paths } from "../lib/routes";
import { useIssueSearch } from "../hooks/useSearch";
import { Screen } from "../components/Screen";
import { SearchIssueRow } from "../components/rows";
import { EmptyState, ErrorView, LoadMore, Segmented, SkeletonList } from "../components/ui";

const FILTERS = [
  { id: "review", label: "Review requests", query: "is:open is:pr review-requested:@me archived:false" },
  { id: "created", label: "Created", query: "is:open is:pr author:@me archived:false" },
  { id: "assigned", label: "Assigned", query: "is:open assignee:@me archived:false" },
  { id: "mentioned", label: "Mentioned", query: "is:open mentions:@me archived:false" },
  { id: "reviewed", label: "Reviewed", query: "is:open is:pr reviewed-by:@me -author:@me archived:false" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const EMPTY: Record<FilterId, string> = {
  review: "Nobody is waiting on your review. Nice.",
  created: "You have no open pull requests.",
  assigned: "Nothing is assigned to you.",
  mentioned: "No open threads mention you.",
  reviewed: "No open pull requests you've reviewed.",
};

export function InboxScreen() {
  const { route } = useScreen();
  const filterId = (FILTERS.find((f) => f.id === route.query.get("filter"))?.id ?? "review") as FilterId;
  const filter = FILTERS.find((f) => f.id === filterId)!;
  const query = `${filter.query} sort:updated-desc`;

  const counts = useQuery({
    queryKey: ["inbox-counts"],
    queryFn: async () => {
      const vars = Object.fromEntries(FILTERS.map((f, i) => [`q${i}`, f.query]));
      const data = await graphql<Record<string, { issueCount: number }>>(SEARCH_COUNTS, vars);
      return FILTERS.map((_, i) => data[`c${i}`]?.issueCount ?? 0);
    },
  });

  const search = useIssueSearch(query);

  return (
    <Screen
      title="Pull requests"
      actions={
        <button className="icon-btn" aria-label="Search" onClick={() => nav.navigate(paths.search())}>
          <SearchIcon size={20} />
        </button>
      }
      header={
        <Segmented
          value={filterId}
          onChange={(id) => nav.replace(paths.inbox(id === "review" ? undefined : id))}
          options={FILTERS.map((f, i) => ({ value: f.id, label: f.label, count: counts.data?.[i] }))}
        />
      }
      onRefresh={() => Promise.all([search.refetch(), counts.refetch()])}
    >
      {search.isPending ? (
        <SkeletonList />
      ) : search.isError ? (
        <ErrorView error={search.error} onRetry={() => void search.refetch()} />
      ) : search.nodes.length === 0 ? (
        <EmptyState icon={<CheckCircleIcon size={32} />} title="All clear">
          {EMPTY[filterId]}
        </EmptyState>
      ) : (
        <>
          {search.nodes.map((node, i) => (
            <SearchIssueRow key={"id" in node ? (node as { id: string }).id : i} node={node} />
          ))}
          <LoadMore
            hasMore={search.hasNextPage}
            loading={search.isFetchingNextPage}
            onLoadMore={() => void search.fetchNextPage()}
          />
        </>
      )}
    </Screen>
  );
}
