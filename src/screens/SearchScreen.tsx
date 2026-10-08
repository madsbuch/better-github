import { SearchIcon } from "@primer/octicons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { graphql } from "../lib/api";
import { SEARCH_REPOS, SEARCH_USERS } from "../lib/queries";
import { Link, nav, useScreen } from "../lib/router";
import { paths } from "../lib/routes";
import type { RepoListItem, SearchReposResult, SearchUsersResult, UserListItem } from "../lib/types";
import { useIssueSearch } from "../hooks/useSearch";
import { Screen } from "../components/Screen";
import { RepoRow, SearchIssueRow } from "../components/rows";
import { Avatar, EmptyState, ErrorView, LoadMore, Segmented, SkeletonList } from "../components/ui";

type SearchType = "repos" | "pulls" | "issues" | "users";

export function SearchScreen() {
  const { route, path, active } = useScreen();
  const q = route.query.get("q") ?? "";
  const type = (["pulls", "issues", "users"].includes(route.query.get("type") ?? "") ? route.query.get("type") : "repos") as SearchType;
  const [input, setInput] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active && !q) inputRef.current?.focus();
  }, [active, q]);

  // Debounce typing into the URL (which drives the query).
  useEffect(() => {
    if (input.trim() === q) return;
    const timer = window.setTimeout(() => nav.replace(paths.search(input.trim() || undefined, type)), 400);
    return () => window.clearTimeout(timer);
  }, [input, q, type, path]);

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
                if (e.key === "Enter") nav.replace(paths.search(input.trim() || undefined, type));
              }}
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="search"
            />
          </div>
          <Segmented
            value={type}
            onChange={(value) => nav.replace(paths.search(q || undefined, value))}
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
      {!q ? (
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
  const list = useInfiniteQuery({
    queryKey: ["search-repos", q],
    queryFn: ({ pageParam }) => graphql<SearchReposResult>(SEARCH_REPOS, { query: q, after: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.search.pageInfo.hasNextPage ? last.search.pageInfo.endCursor : undefined),
  });
  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorView error={list.error} onRetry={() => void list.refetch()} />;
  const repos = list.data.pages.flatMap((p) => p.search.nodes).filter((n): n is RepoListItem => n.__typename === "Repository");
  if (repos.length === 0) return <EmptyState title="No repositories found" />;
  return (
    <>
      <div className="section-title">{list.data.pages[0].search.repositoryCount.toLocaleString()} repositories</div>
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
        <SearchIssueRow key={"id" in node ? (node as { id: string }).id : i} node={node} />
      ))}
      <LoadMore hasMore={search.hasNextPage} loading={search.isFetchingNextPage} onLoadMore={() => void search.fetchNextPage()} />
    </>
  );
}

function UserResults({ q }: { q: string }) {
  const list = useInfiniteQuery({
    queryKey: ["search-users", q],
    queryFn: ({ pageParam }) => graphql<SearchUsersResult>(SEARCH_USERS, { query: q, after: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.search.pageInfo.hasNextPage ? last.search.pageInfo.endCursor : undefined),
  });
  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorView error={list.error} onRetry={() => void list.refetch()} />;
  const users = list.data.pages
    .flatMap((p) => p.search.nodes)
    .filter((n): n is UserListItem => n.__typename === "User" || n.__typename === "Organization");
  if (users.length === 0) return <EmptyState title="Nobody found" />;
  return (
    <>
      {users.map((user) => (
        <Link key={user.id} to={paths.user(user.login)} className="row" style={{ alignItems: "center" }}>
          <Avatar src={user.avatarUrl} size={36} square={user.__typename === "Organization"} />
          <span className="row-body">
            <span className="bold">{user.name || user.login}</span>
            {user.name && <span className="muted small"> {user.login}</span>}
            {(user.bio || user.description) && (
              <span className="muted small ellipsis" style={{ display: "block" }}>
                {user.bio || user.description}
              </span>
            )}
          </span>
        </Link>
      ))}
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => void list.fetchNextPage()} />
    </>
  );
}
