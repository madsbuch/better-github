import { SearchIcon } from "@primer/octicons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { to, useNav } from "../lib/nav";
import type { SearchReposResult, UserListItem } from "../lib/types";
import { searchQueries, useIssueSearch } from "../queries/search";
import { Screen } from "../components/Screen";
import { RepoRow, SearchIssueRow } from "../components/rows";
import { Avatar, EmptyState, ErrorView, LoadMore, Segmented, SkeletonList } from "../components/ui";

const route = getRouteApi("/search");

type RepoNode = Extract<SearchReposResult["search"]["nodes"][number], { __typename: "Repository" }>;

/** `text`, or null when it is missing or empty. */
const nonEmpty = (text: string | null | undefined): string | null => (text === null || text === undefined || text === "" ? null : text);


export function SearchScreen() {
  const search = route.useSearch();
  const q = search.q ?? "";
  const type = search.type ?? "repos";
  const nav = useNav();
  const [input, setInput] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q === "") inputRef.current?.focus();
  }, [q]);

  // Debounce typing into the URL (which drives the query).
  useEffect(() => {
    if (input.trim() === q) return;
    const timer = window.setTimeout(() => nav.replace(to.search(input.trim(), type)), 400);
    return () => window.clearTimeout(timer);
  }, [input, q, type, nav]);

  return (
    <Screen
      title="Search"
      header={
        <>
          <div className="search-bar">
            <SearchIcon size={16} />
            <input
              ref={inputRef}
              type="search"
              placeholder="Search GitHub"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") nav.replace(to.search(input.trim(), type));
              }}
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="search"
            />
          </div>
          <Segmented
            value={type}
            onChange={(value) => nav.replace(to.search(q, value))}
            options={[
              { value: "repos", label: "Repositories" },
              { value: "pulls", label: "Pull requests" },
              { value: "issues", label: "Issues" },
              { value: "users", label: "People" },
            ]}
          />
        </>
      }
    >
      {q === "" ? (
        <EmptyState icon={<SearchIcon size={32} />} title="Search GitHub">
          Supports GitHub search syntax, e.g. <span className="mono">is:open author:octocat</span>
        </EmptyState>
      ) : type === "repos" ? (
        <RepoResults q={q} />
      ) : type === "users" ? (
        <UserResults q={q} />
      ) : (
        <IssueResults q={`${q} ${type === "pulls" ? "is:pr" : "is:issue"}`} />
      )}
    </Screen>
  );
}

function RepoResults({ q }: { q: string }) {
  const list = useInfiniteQuery(searchQueries.repos(q));
  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorView error={list.error} onRetry={() => void list.refetch()} />;
  const repos = list.data.pages.flatMap((p) => p.search.nodes).filter((n): n is RepoNode => n.__typename === "Repository");
  if (repos.length === 0) return <EmptyState title="No repositories found" />;
  return (
    <>
      <div className="section-title">{(list.data.pages[0]?.search.repositoryCount ?? 0).toLocaleString()} repositories</div>
      {repos.map((repo) => (
        <RepoRow key={repo.id} repo={repo} />
      ))}
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => void list.fetchNextPage()} />
    </>
  );
}

function IssueResults({ q }: { q: string }) {
  const search = useIssueSearch(q);
  if (search.isPending) return <SkeletonList />;
  if (search.isError) return <ErrorView error={search.error} onRetry={() => void search.refetch()} />;
  if (search.nodes.length === 0) return <EmptyState title="Nothing found" />;
  return (
    <>
      <div className="section-title">{(search.total ?? 0).toLocaleString()} results</div>
      {search.nodes.map((node, i) => (
        <SearchIssueRow key={"id" in node ? node.id : i} node={node} />
      ))}
      <LoadMore hasMore={search.hasNextPage} loading={search.isFetchingNextPage} onLoadMore={() => void search.fetchNextPage()} />
    </>
  );
}

function UserResults({ q }: { q: string }) {
  const list = useInfiniteQuery(searchQueries.users(q));
  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorView error={list.error} onRetry={() => void list.refetch()} />;
  const users = list.data.pages
    .flatMap((p) => p.search.nodes)
    .filter((n): n is UserListItem => n.__typename === "User" || n.__typename === "Organization");
  if (users.length === 0) return <EmptyState title="Nobody found" />;
  return (
    <>
      {users.map((user) => (
        <Link key={user.id} {...to.user(user.login)} preload="viewport" className="row" style={{ alignItems: "center" }}>
          <Avatar src={user.avatarUrl} size={36} square={user.__typename === "Organization"} />
          <span className="row-body">
            <span className="bold">{nonEmpty(user.name) ?? user.login}</span>
            {nonEmpty(user.name) !== null && <span className="muted small"> {user.login}</span>}
            {(nonEmpty(user.bio) ?? nonEmpty(user.description)) !== null && (
              <span className="muted small ellipsis" style={{ display: "block" }}>
                {nonEmpty(user.bio) ?? user.description}
              </span>
            )}
          </span>
        </Link>
      ))}
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => void list.fetchNextPage()} />
    </>
  );
}
