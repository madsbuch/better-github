import { ChevronRightIcon, LockIcon, OrganizationIcon, RepoIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { compactNumber } from "../lib/format";
import { to } from "../lib/nav";
import { useIsGuest } from "../lib/session";
import { keys } from "../queries/keys";
import { viewerQueries } from "../queries/viewer";
import { Screen } from "../components/Screen";
import { Avatar, EmptyState, ErrorView, LoadMore, SkeletonList } from "../components/ui";

/** The organizations you belong to. Each opens its page, with its repositories. */
export function OrgsScreen() {
  const guest = useIsGuest();
  const queryClient = useQueryClient();
  const list = useInfiniteQuery({ ...viewerQueries.orgs(), enabled: !guest });
  const [filter, setFilter] = useState("");
  const orgs = list.data?.pages.flatMap((page) => page.nodes) ?? [];
  const needle = filter.trim().toLowerCase();
  const visible =
    needle === "" ? orgs : orgs.filter((org) => `${org.login} ${org.name ?? ""} ${org.description ?? ""}`.toLowerCase().includes(needle));

  return (
    <Screen
      title="Organizations"
      onRefresh={guest ? undefined : () => queryClient.refetchQueries({ queryKey: keys.viewer.orgs(), type: "active" })}
      header={
        // Worth a filter once the list is longer than a screen.
        orgs.length > 8 ? (
          <div className="search-bar">
            <SearchIcon size={16} />
            <input
              type="search"
              placeholder="Filter organizations"
              aria-label="Filter organizations"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="search"
            />
            {filter !== "" && (
              <button className="icon-btn sm" aria-label="Clear" onClick={() => setFilter("")}>
                <XIcon size={14} />
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      {guest ? (
        <EmptyState icon={<LockIcon size={32} />} title="Sign in to see your organizations">
          Without an account you can still follow profiles and browse their public repositories.
        </EmptyState>
      ) : list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorView error={list.error} onRetry={() => void list.refetch()} />
      ) : orgs.length === 0 ? (
        <EmptyState icon={<OrganizationIcon size={32} />} title="No organizations">
          You aren't a member of any organization, or the ones you are in haven't given this app access.
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing matches">No organization contains “{filter.trim()}”.</EmptyState>
      ) : (
        <>
          {visible.map((org) => (
            <Link key={org.login} {...to.user(org.login)} preload="viewport" className="row org-row">
              <span className="row-icon" style={{ paddingTop: 0 }}>
                <Avatar src={org.avatarUrl} size={40} square />
              </span>
              <span className="row-body">
                <span className="row-title" style={{ display: "block" }}>
                  {org.name !== null && org.name !== "" ? org.name : org.login}
                </span>
                {org.description !== null && org.description !== "" && <span className="org-description">{org.description}</span>}
                <span className="row-meta">
                  <span className="ellipsis">{org.login}</span>
                  <span>·</span>
                  <span className="nowrap">
                    <RepoIcon size={12} /> {compactNumber(org.repositories.totalCount)} {org.repositories.totalCount === 1 ? "repository" : "repositories"}
                  </span>
                </span>
              </span>
              <ChevronRightIcon size={16} className="c-muted" />
            </Link>
          ))}
          <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => void list.fetchNextPage()} />
        </>
      )}
    </Screen>
  );
}
