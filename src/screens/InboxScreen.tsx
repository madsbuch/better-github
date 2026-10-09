import { CheckCircleIcon, SearchIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { to, useNav } from "../lib/nav";
import type { InboxFilter } from "../queries/keys";
import { INBOX_FILTERS, inboxQuery, searchQueries, useIssueSearch } from "../queries/search";
import { Screen } from "../components/Screen";
import { SearchIssueRow } from "../components/rows";
import { EmptyState, ErrorView, LoadMore, Segmented, SkeletonList } from "../components/ui";

const route = getRouteApi("/");

const EMPTY: Record<InboxFilter, string> = {
  review: "Nobody is waiting on your review. Nice.",
  created: "You have no open pull requests.",
  assigned: "Nothing is assigned to you.",
  mentioned: "No open threads mention you.",
  reviewed: "No open pull requests you've reviewed.",
};

export function InboxScreen() {
  const filter = route.useSearch({ select: (s) => s.filter ?? "review" });
  const nav = useNav();
  const counts = useQuery(searchQueries.inboxCounts());
  const search = useIssueSearch(inboxQuery(filter));

  return (
    <Screen
      title="Pull requests"
      actions={
        <Link {...to.search()} className="icon-btn" aria-label="Search">
          <SearchIcon size={20} />
        </Link>
      }
      header={
        <Segmented
          value={filter}
          onChange={(id) => nav.replace(to.inbox(id))}
          options={INBOX_FILTERS.map((f) => ({ value: f.id, label: f.label, count: counts.data?.[f.id] }))}
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
          {EMPTY[filter]}
        </EmptyState>
      ) : (
        <>
          {search.nodes.map((node, i) => (
            <SearchIssueRow key={"id" in node ? (node as { id: string }).id : i} node={node} />
          ))}
          <LoadMore hasMore={search.hasNextPage} loading={search.isFetchingNextPage} onLoadMore={() => void search.fetchNextPage()} />
        </>
      )}
    </Screen>
  );
}
