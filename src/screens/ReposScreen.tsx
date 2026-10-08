import { RepoIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { graphql } from "../lib/api";
import { VIEWER_REPOS, VIEWER_STARRED } from "../lib/queries";
import { Link, nav, useScreen } from "../lib/router";
import { paths } from "../lib/routes";
import type { Connection, RepoListItem } from "../lib/types";
import { Screen } from "../components/Screen";
import { RepoRow } from "../components/rows";
import { EmptyState, ErrorView, LoadMore, Segmented, SkeletonList } from "../components/ui";

type Tab = "yours" | "starred";

export function ReposScreen() {
  const { route } = useScreen();
  const tab: Tab = route.query.get("tab") === "starred" ? "starred" : "yours";
  const [filter, setFilter] = useState("");

  const list = useInfiniteQuery({
    queryKey: ["viewer-repos", tab],
    queryFn: async ({ pageParam }) => {
      if (tab === "starred") {
        const data = await graphql<{ viewer: { starredRepositories: Connection<RepoListItem> } }>(VIEWER_STARRED, { after: pageParam });
        return data.viewer.starredRepositories;
      }
      const data = await graphql<{ viewer: { repositories: Connection<RepoListItem> } }>(VIEWER_REPOS, { after: pageParam });
      return data.viewer.repositories;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.endCursor : undefined),
  });

  const repos = list.data?.pages.flatMap((p) => p.nodes) ?? [];
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? repos.filter((r) => r.nameWithOwner.toLowerCase().includes(needle) || r.description?.toLowerCase().includes(needle))
    : repos;

  return (
    <Screen
      title="Repositories"
      header={
        <>
          <Segmented
            value={tab}
            onChange={(value) => nav.replace(value === "yours" ? paths.repos() : `${paths.repos()}?tab=starred`)}
            options={[
              { value: "yours", label: "Yours", count: list.data && tab === "yours" ? list.data.pages[0].totalCount : undefined },
              { value: "starred", label: "Starred", count: list.data && tab === "starred" ? list.data.pages[0].totalCount : undefined },
            ]}
          />
          <div className="search-bar">
            <SearchIcon size={16} />
            <input
              type="search"
              placeholder={tab === "yours" ? "Filter your repositories" : "Filter starred repositories"}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="search"
            />
            {filter && (
              <button className="icon-btn sm" aria-label="Clear" onClick={() => setFilter("")}>
                <XIcon size={14} />
              </button>
            )}
          </div>
        </>
      }
      onRefresh={() => list.refetch()}
    >
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorView error={list.error} onRetry={() => void list.refetch()} />
      ) : visible.length === 0 && !needle ? (
        <EmptyState icon={<RepoIcon size={32} />} title={tab === "yours" ? "No repositories yet" : "No stars yet"} />
      ) : (
        <>
          {visible.map((repo) => (
            <RepoRow key={repo.id} repo={repo} />
          ))}
          {needle && (
            <Link to={paths.search(filter.trim(), "repos")} className="row">
              <span className="row-icon c-muted">
                <SearchIcon size={16} />
              </span>
              <span className="row-body">
                Search all of GitHub for “{filter.trim()}”
              </span>
            </Link>
          )}
          {/* Keep loading while filtering so matches further down show up too. */}
          <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => void list.fetchNextPage()} />
        </>
      )}
    </Screen>
  );
}
