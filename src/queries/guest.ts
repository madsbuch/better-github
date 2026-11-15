// REST versions of what guest mode shows (see lib/guest.ts). GitHub serves
// these without a token; responses are mapped to the shapes the GraphQL
// queries return, so the same screens and rows render them.

import { queryOptions } from "@tanstack/react-query";
import { ApiError, rest, restPage, type Page } from "../lib/api";
import type { OwnerResult, RepoDetail, RepoListItem } from "../lib/types";
import { keys } from "./keys";

/** Guests get 60 requests an hour, so their data stays fresh for longer. */
export const GUEST_STALE_TIME = 10 * 60_000;
/** Repositories per profile in the guest repository list: the most recently pushed. */
export const GUEST_REPOS_PER_PROFILE = 100;

export interface RestOwner {
  login: string;
  avatar_url: string;
  html_url: string;
  type: "User" | "Organization" | "Bot";
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  blog?: string | null;
  followers?: number;
  following?: number;
  public_repos?: number;
}

export interface RestRepo {
  node_id: string;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  forks_count: number;
  subscribers_count?: number;
  open_issues_count: number;
  has_issues: boolean;
  pushed_at: string | null;
  default_branch: string;
  /** 0 for a repository without commits. */
  size: number;
  language: string | null;
  topics?: string[];
  license: { spdx_id: string | null; name: string } | null;
  owner: { login: string; avatar_url: string };
  parent?: { full_name: string };
}

interface RestRelease {
  name: string | null;
  tag_name: string;
  published_at: string | null;
  prerelease: boolean;
}

interface RestBranch {
  name: string;
}

export function toRepoListItem(repo: RestRepo): RepoListItem {
  return {
    __typename: "Repository",
    id: repo.node_id,
    name: repo.name,
    nameWithOwner: repo.full_name,
    description: repo.description,
    isPrivate: repo.private,
    isFork: repo.fork,
    isArchived: repo.archived,
    stargazerCount: repo.stargazers_count,
    pushedAt: repo.pushed_at,
    owner: { login: repo.owner.login, avatarUrl: repo.owner.avatar_url },
    primaryLanguage: repo.language ? { name: repo.language, color: null } : null,
  };
}

export function toRepoDetail(repo: RestRepo, latest: RestRelease | null): RepoDetail {
  return {
    ...toRepoListItem(repo),
    url: repo.html_url,
    homepageUrl: repo.homepage || null,
    forkCount: repo.forks_count,
    viewerHasStarred: false,
    viewerPermission: "READ",
    hasIssuesEnabled: repo.has_issues,
    defaultBranchRef: repo.size > 0 || repo.pushed_at ? { name: repo.default_branch } : null,
    licenseInfo: repo.license ? { spdxId: repo.license.spdx_id, name: repo.license.name } : null,
    parent: repo.parent ? { nameWithOwner: repo.parent.full_name } : null,
    latestRelease: latest
      ? { name: latest.name, tagName: latest.tag_name, publishedAt: latest.published_at, isPrerelease: latest.prerelease }
      : null,
    // REST has no counts for these; guest screens don't show them.
    releases: { totalCount: latest ? 1 : 0 },
    pullRequests: { totalCount: 0 },
    issues: { totalCount: 0 },
    watchers: { totalCount: repo.subscribers_count ?? 0 },
    repositoryTopics: { nodes: (repo.topics ?? []).map((name) => ({ topic: { name } })) },
  };
}

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (e) {
    if (ApiError.from(e).status === 404) return null;
    throw e;
  }
}

/** A repository and its latest release, shaped like the `Repo` GraphQL query's result. */
export async function guestRepoDetail(owner: string, repo: string): Promise<{ repository: RepoDetail | null }> {
  const [detail, latest] = await Promise.all([
    orNull(rest<RestRepo>(`/repos/${owner}/${repo}`)),
    orNull(rest<RestRelease>(`/repos/${owner}/${repo}/releases/latest`)),
  ]);
  return { repository: detail ? toRepoDetail(detail, latest) : null };
}

/** A page of an owner's profile and repositories, shaped like the `Owner` GraphQL query's result. */
export function toOwnerResult(profile: RestOwner | null, repos: Page<RestRepo>): OwnerResult {
  if (!profile) return { repositoryOwner: null };
  return {
    repositoryOwner: {
      __typename: profile.type === "Organization" ? "Organization" : "User",
      login: profile.login,
      avatarUrl: profile.avatar_url,
      url: profile.html_url,
      name: profile.name ?? null,
      bio: profile.bio ?? null,
      company: profile.company ?? null,
      location: profile.location ?? null,
      followers: profile.followers === undefined ? undefined : { totalCount: profile.followers },
      following: profile.following === undefined ? undefined : { totalCount: profile.following },
      repositories: {
        totalCount: profile.public_repos ?? repos.items.length,
        pageInfo: { hasNextPage: repos.next !== null, endCursor: repos.next },
        nodes: repos.items.map(toRepoListItem),
      },
    },
  };
}

/** A repository's branches over REST: no commit dates, and no search. */
export async function guestBranchPage(owner: string, repo: string, next: string | null) {
  const page = next
    ? await restPage<RestBranch>(next)
    : await restPage<RestBranch>(`/repos/${owner}/${repo}/branches`, { query: { per_page: 100 } });
  return { branches: page.items.map((b) => ({ name: b.name, committedDate: null })), next: page.next };
}

export const guestQueries = {
  /** A user's or organization's public profile; null if there's no such account. */
  profile: (login: string) =>
    queryOptions({
      queryKey: keys.guest.profile(login),
      queryFn: () => orNull(rest<RestOwner>(`/users/${login}`)),
      staleTime: GUEST_STALE_TIME,
    }),
  /** An owner's most recently pushed public repositories (the first page). */
  repos: (login: string) =>
    queryOptions({
      queryKey: keys.guest.repos(login),
      queryFn: async (): Promise<Page<RestRepo>> =>
        (await orNull(
          restPage<RestRepo>(`/users/${login}/repos`, { query: { sort: "pushed", per_page: GUEST_REPOS_PER_PROFILE } }),
        )) ?? { items: [], next: null },
      staleTime: GUEST_STALE_TIME,
    }),
  /** GitHub's request budget for this device's address. */
  rateLimit: () =>
    queryOptions({
      queryKey: keys.guest.rateLimit(),
      queryFn: async () => {
        const { resources } = await rest<{ resources: { core: { limit: number; remaining: number; reset: number } } }>("/rate_limit");
        return { limit: resources.core.limit, remaining: resources.core.remaining, resetAt: new Date(resources.core.reset * 1000).toISOString() };
      },
      staleTime: 0,
      meta: { persist: false },
    }),
};
