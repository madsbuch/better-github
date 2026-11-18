import {
  FileDirectoryFillIcon,
  FileIcon,
  FileSubmoduleIcon,
  FileSymlinkFileIcon,
  GitBranchIcon,
  TriangleDownIcon,
} from "@primer/octicons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { backend } from "../lib/backend";
import { to } from "../lib/nav";
import { repoQueries, type RestCommitListItem } from "../queries/repos";
import { BranchSheet } from "./BranchSheet";
import { Avatar, EmptyState, ErrorView, LoadMore, SkeletonList, Time } from "./ui";

// ---------------------------------------------------------------- branches

export function BranchBar({ owner, repo, gitRef, onChange }: { owner: string; repo: string; gitRef: string; onChange: (ref: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-muted)" }}>
      <button className="btn btn-sm" onClick={() => setOpen(true)} style={{ maxWidth: "100%" }}>
        <GitBranchIcon size={14} />
        <span className="ellipsis mono">{gitRef}</span>
        <TriangleDownIcon size={14} />
      </button>
      <BranchSheet open={open} onClose={() => setOpen(false)} owner={owner} repo={repo} current={gitRef} onSelect={onChange} />
    </div>
  );
}

// -------------------------------------------------------------------- tree

function iconFor(type: string) {
  switch (type) {
    case "dir":
      return <FileDirectoryFillIcon size={16} className="c-accent" />;
    case "submodule":
      return <FileSubmoduleIcon size={16} className="c-muted" />;
    case "symlink":
      return <FileSymlinkFileIcon size={16} className="c-muted" />;
    default:
      return <FileIcon size={16} className="c-muted" />;
  }
}

export function TreeView({ owner, repo, gitRef, path }: { owner: string; repo: string; gitRef: string; path: string }) {
  const contents = useQuery(repoQueries.contents(owner, repo, gitRef, path));

  if (contents.isPending) return <SkeletonList rows={10} />;
  if (contents.isError) return <ErrorView error={contents.error} onRetry={() => void contents.refetch()} />;
  if (!Array.isArray(contents.data)) {
    return (
      <div className="center">
        <Link {...to.blob(owner, repo, gitRef, path)} className="btn">
          Open file
        </Link>
      </div>
    );
  }
  if (contents.data.length === 0) return <EmptyState title="Empty directory" />;

  const items = [...contents.data].sort((a, b) => {
    const rank = (t: string) => (t === "dir" ? 0 : t === "submodule" ? 1 : 2);
    const byType = rank(a.type) - rank(b.type);
    return byType !== 0 ? byType : a.name.localeCompare(b.name);
  });

  return (
    <div>
      {items.map((item) =>
        item.type === "submodule" ? (
          <button
            key={item.path}
            className="row"
            style={{ alignItems: "center", paddingTop: 11, paddingBottom: 11 }}
            onClick={() => {
              if (item.html_url !== null && item.html_url !== "") void backend.openUrl(item.html_url);
            }}
          >
            {iconFor(item.type)}
            <span className="grow ellipsis">{item.name}</span>
          </button>
        ) : (
          <Link
            key={item.path}
            {...(item.type === "dir" ? to.tree(owner, repo, gitRef, item.path) : to.blob(owner, repo, gitRef, item.path))}
            // Directory listings are small; files (up to megabytes) load only when touched.
            preload={item.type === "dir" ? "viewport" : "intent"}
            className="row"
            style={{ alignItems: "center", paddingTop: 11, paddingBottom: 11 }}
          >
            {iconFor(item.type)}
            <span className="grow ellipsis">{item.name}</span>
          </Link>
        ),
      )}
    </div>
  );
}

export function Breadcrumbs({ owner, repo, gitRef, path }: { owner: string; repo: string; gitRef: string; path: string }) {
  const parts = path.split("/").filter(Boolean);
  return (
    <nav className="breadcrumbs" aria-label="Path">
      <Link {...to.tree(owner, repo, gitRef)}>{repo}</Link>
      {parts.map((part, i) => {
        const sub = parts.slice(0, i + 1).join("/");
        const last = i === parts.length - 1;
        return (
          <span key={sub} className="row-flex" style={{ gap: 4 }}>
            <span className="sep">/</span>
            {last ? (
              <span className="bold">{part}</span>
            ) : (
              <Link {...to.tree(owner, repo, gitRef, sub)}>{part}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ----------------------------------------------------------------- commits

export function CommitList({ owner, repo, gitRef }: { owner: string; repo: string; gitRef: string }) {
  const list = useInfiniteQuery(repoQueries.commits(owner, repo, gitRef));

  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorView error={list.error} onRetry={() => void list.refetch()} />;
  const commits = list.data.pages.flatMap((p) => p.items);
  if (commits.length === 0) return <EmptyState title="No commits" />;

  return (
    <>
      {commits.map((c) => (
        <CommitRow key={c.sha} owner={owner} repo={repo} commit={c} />
      ))}
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => void list.fetchNextPage()} />
    </>
  );
}

/** A commit from the REST API (lists, comparisons). */
export function CommitRow({ owner, repo, commit: c }: { owner: string; repo: string; commit: RestCommitListItem }) {
  const [headline] = c.commit.message.split("\n");
  return (
    // A commit's diff can be large: preload on touch, not on sight.
    <Link {...to.commit(owner, repo, c.sha)} className="row">
      <span className="row-icon" style={{ paddingTop: 0 }}>
        <Avatar src={c.author?.avatar_url ?? null} size={28} />
      </span>
      <span className="row-body">
        <span className="row-title" style={{ display: "block", fontWeight: 500 }}>
          {headline}
        </span>
        <span className="row-meta">
          <span className="ellipsis">{c.author?.login ?? c.commit.author?.name}</span>
          <span>·</span>
          <Time iso={c.commit.author?.date ?? c.commit.committer?.date} />
          <span className="grow" />
          <span className="mono">{c.sha.slice(0, 7)}</span>
        </span>
      </span>
    </Link>
  );
}
