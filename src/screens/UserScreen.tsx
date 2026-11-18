import { LinkExternalIcon, LocationIcon, OrganizationIcon, PeopleIcon } from "@primer/octicons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { backend } from "../lib/backend";
import { compactNumber } from "../lib/format";
import { viewerQueries } from "../queries/viewer";
import { Screen } from "../components/Screen";
import { RepoRow } from "../components/rows";
import { Avatar, EmptyState, ErrorView, LoadMore, SkeletonList } from "../components/ui";

const route = getRouteApi("/$owner/");

/** `text`, or null when it is missing or empty. */
const nonEmpty = (text: string | null | undefined): string | null => (text === null || text === undefined || text === "" ? null : text);

export function UserScreen() {
  const login = route.useParams({ select: (p) => p.owner });
  const owner = useInfiniteQuery(viewerQueries.owner(login));

  const first = owner.data?.pages[0]?.repositoryOwner;
  const repos = owner.data?.pages.flatMap((p) => p.repositoryOwner?.repositories.nodes ?? []) ?? [];

  return (
    <Screen
      title={login}
      actions={
        <button className="icon-btn" aria-label="Open on GitHub" onClick={() => void backend.openUrl(`https://github.com/${login}`)}>
          <LinkExternalIcon size={18} />
        </button>
      }
      onRefresh={() => owner.refetch()}
    >
      {owner.isPending ? (
        <SkeletonList />
      ) : owner.isError ? (
        <ErrorView error={owner.error} onRetry={() => void owner.refetch()} />
      ) : !first ? (
        <EmptyState title="Not found">There's no user or organization called {login}.</EmptyState>
      ) : (
        <>
          <div className="profile-header">
            <Avatar src={first.avatarUrl} size={64} square={first.__typename === "Organization"} />
            <div className="grow">
              <h2 className="ellipsis">{nonEmpty(first.name) ?? first.login}</h2>
              {nonEmpty(first.name) !== null && <div className="muted">{first.login}</div>}
            </div>
          </div>
          <div style={{ padding: "0 16px 12px" }}>
            {(nonEmpty(first.bio) ?? nonEmpty(first.description)) !== null && <p style={{ margin: "0 0 10px" }}>{nonEmpty(first.bio) ?? first.description}</p>}
            <div className="stats-row" style={{ marginTop: 0 }}>
              {first.followers && (
                <span>
                  <PeopleIcon size={14} /> <strong>{compactNumber(first.followers.totalCount)}</strong> followers
                </span>
              )}
              {nonEmpty(first.company) !== null && (
                <span>
                  <OrganizationIcon size={14} /> {first.company}
                </span>
              )}
              {nonEmpty(first.location) !== null && (
                <span>
                  <LocationIcon size={14} /> {first.location}
                </span>
              )}
            </div>
          </div>
          <h3 className="section-title">Repositories · {compactNumber(first.repositories.totalCount)}</h3>
          {repos.map((repo) => (
            <RepoRow key={repo.id} repo={repo} showOwner={false} />
          ))}
          <LoadMore hasMore={owner.hasNextPage} loading={owner.isFetchingNextPage} onLoadMore={() => void owner.fetchNextPage()} />
        </>
      )}
    </Screen>
  );
}
