import { TagIcon } from "@primer/octicons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { to } from "../../lib/nav";
import type { Release } from "../../lib/types";
import { releaseQueries } from "../../queries/releases";
import { Avatar, EmptyState, ErrorView, LoadMore, SkeletonList, Time } from "../../components/ui";

/** A repository's releases, newest first. */
export function ReleasesTab({ owner, repo, latestTag }: { owner: string; repo: string; latestTag: string | undefined }) {
  const list = useInfiniteQuery(releaseQueries.list(owner, repo));
  const releases = list.data?.pages.flatMap((p) => p.items) ?? [];
  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorView error={list.error} onRetry={() => void list.refetch()} />;
  if (releases.length === 0) return <EmptyState icon={<TagIcon size={32} />} title="No releases yet" />;
  return (
    <>
      {releases.map((release) => (
        <ReleaseRow key={release.id} owner={owner} repo={repo} release={release} latest={release.tag_name === latestTag} />
      ))}
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => void list.fetchNextPage()} />
    </>
  );
}

function ReleaseRow({ owner, repo, release, latest }: { owner: string; repo: string; release: Release; latest: boolean }) {
  // Drafts have no tag page yet; they open by id.
  const target = release.draft ? to.releaseById(owner, repo, release.id) : to.release(owner, repo, release.tag_name);
  const assets = release.assets.length;
  return (
    <Link {...target} preload="viewport" className="row">
      <span className="row-icon">
        <TagIcon size={16} className={latest ? "c-success" : "c-muted"} />
      </span>
      <span className="row-body">
        <span className="row-flex" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="bold" style={{ overflowWrap: "anywhere" }}>
            {release.name || release.tag_name}
          </span>
          <ReleaseBadges release={release} latest={latest} />
        </span>
        <span className="row-meta">
          <span className="mono ellipsis">{release.tag_name}</span>
          <span>·</span>
          <Time iso={release.published_at ?? release.created_at} />
          {assets > 0 && <span>· {assets} asset{assets === 1 ? "" : "s"}</span>}
        </span>
      </span>
      <span className="row-trailing">
        <Avatar src={release.author.avatar_url} size={24} alt={release.author.login} />
      </span>
    </Link>
  );
}

export function ReleaseBadges({ release, latest }: { release: Release; latest: boolean }) {
  return (
    <>
      {latest && <span className="pill pill-success">Latest</span>}
      {release.prerelease && <span className="pill pill-attention">Pre-release</span>}
      {release.draft && <span className="pill">Draft</span>}
    </>
  );
}
