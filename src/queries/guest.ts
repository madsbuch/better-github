// REST versions of what guest mode shows (see lib/guest.ts). GitHub serves
// these without a token; responses are mapped to the shapes the GraphQL
// queries return, so the same screens and rows render them.

import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, rest, restPage, type Page } from "../lib/api";
import type { OwnerResult, RepoDetail, RepoListItem } from "../lib/types";
import { keys } from "./keys";

/** Guests get 60 requests an hour, so their data stays fresh for longer. */
export const GUEST_STALE_TIME = 10 * 60_000;
/** Repositories per profile in the guest repository list: the most recently pushed. */
export const GUEST_REPOS_PER_PROFILE = 100;

// ------------------------------------------------------------ REST shapes
// Only the fields the app reads; see lib/restConformance.repos.ts.

/** A user or organization (`public-user`; `private-user` for yourself). */
export const RestOwner = z.object({
  login: z.string(),
  avatar_url: z.string(),
  html_url: z.string(),
  /** "User", "Organization" or "Bot". */
  type: z.string(),
  name: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  blog: z.string().nullable().optional(),
  followers: z.number().optional(),
  following: z.number().optional(),
  public_repos: z.number().optional(),
});
export type RestOwner = z.infer<typeof RestOwner>;

/** A repository in a list (`minimal-repository`). */
export const RestRepo = z.object({
  node_id: z.string(),
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  fork: z.boolean(),
  archived: z.boolean().optional(),
  stargazers_count: z.number().optional(),
  pushed_at: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  owner: z.object({ login: z.string(), avatar_url: z.string() }),
});
export type RestRepo = z.infer<typeof RestRepo>;

/** A repository on its own (`full-repository`). */
export const RestRepoDetail = RestRepo.extend({
  html_url: z.string(),
  homepage: z.string().nullable(),
  forks_count: z.number(),
  subscribers_count: z.number().optional(),
  has_issues: z.boolean(),
  default_branch: z.string(),
  /** 0 for a repository without commits. */
  size: z.number(),
  topics: z.array(z.string()).optional(),
  license: z.object({ spdx_id: z.string().nullable(), name: z.string() }).nullable(),
  parent: z.object({ full_name: z.string() }).optional(),
});
export type RestRepoDetail = z.infer<typeof RestRepoDetail>;

/** The latest release (`release`). */
export const RestLatestRelease = z.object({
  name: z.string().nullable(),
  tag_name: z.string(),
  published_at: z.string().nullable(),
  prerelease: z.boolean(),
});
export type RestLatestRelease = z.infer<typeof RestLatestRelease>;

/** A branch in a list (`short-branch`). */
export const RestBranch = z.object({ name: z.string() });

const RateLimitBudget = z.object({ limit: z.number(), remaining: z.number(), reset: z.number() });
/** GitHub's request budgets (`rate-limit-overview`); only the core one is read. */
export const RestRateLimit = z.object({ resources: z.object({ core: RateLimitBudget }) });

export function toRepoListItem(repo: RestRepo): RepoListItem {
  return {
    id: repo.node_id,
    name: repo.name,
    nameWithOwner: repo.full_name,
    description: repo.description,
    isPrivate: repo.private,
    isFork: repo.fork,
    // GitHub lists these; they are optional only in its schema.
    isArchived: repo.archived ?? false,
    stargazerCount: repo.stargazers_count ?? 0,
    pushedAt: repo.pushed_at ?? null,
    owner: { login: repo.owner.login, avatarUrl: repo.owner.avatar_url },
    primaryLanguage: repo.language !== undefined && repo.language !== null && repo.language !== "" ? { name: repo.language, color: null } : null,
  };
}

export function toRepoDetail(repo: RestRepoDetail, latest: RestLatestRelease | null): RepoDetail {
  return {
    ...toRepoListItem(repo),
    url: repo.html_url,
    homepageUrl: repo.homepage === "" ? null : repo.homepage,
    forkCount: repo.forks_count,
    viewerHasStarred: false,
    viewerPermission: "READ",
    hasIssuesEnabled: repo.has_issues,
    defaultBranchRef: repo.size > 0 || (repo.pushed_at !== undefined && repo.pushed_at !== null && repo.pushed_at !== "") ? { name: repo.default_branch } : null,
    licenseInfo: repo.license !== null ? { spdxId: repo.license.spdx_id, name: repo.license.name } : null,
    parent: repo.parent !== undefined ? { nameWithOwner: repo.parent.full_name } : null,
    latestRelease:
      latest !== null
        ? { name: latest.name, tagName: latest.tag_name, publishedAt: latest.published_at, isPrerelease: latest.prerelease }
      : null,
    // REST has no counts for these; guest screens don't show them.
    releases: { totalCount: latest !== null ? 1 : 0 },
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
    orNull(rest(RestRepoDetail, `/repos/${owner}/${repo}`)),
    orNull(rest(RestLatestRelease, `/repos/${owner}/${repo}/releases/latest`)),
  ]);
  return { repository: detail !== null ? toRepoDetail(detail, latest) : null };
}

/** A page of an owner's profile and repositories, shaped like the `Owner` GraphQL query's result. */
export function toOwnerResult(profile: RestOwner | null, repos: Page<RestRepo>): OwnerResult {
  if (profile === null) return { repositoryOwner: null };
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
  const page =
    next !== null && next !== ""
      ? await restPage(RestBranch, next)
      : await restPage(RestBranch, `/repos/${owner}/${repo}/branches`, { query: { per_page: 100 } });
  return { branches: page.items.map((b) => ({ name: b.name, committedDate: null })), next: page.next };
}

export const guestQueries = {
  /** A user's or organization's public profile; null if there's no such account. */
  profile: (login: string) =>
    queryOptions({
      queryKey: keys.guest.profile(login),
      queryFn: () => orNull(rest(RestOwner, `/users/${login}`)),
      staleTime: GUEST_STALE_TIME,
    }),
  /** An owner's most recently pushed public repositories (the first page). */
  repos: (login: string) =>
    queryOptions({
      queryKey: keys.guest.repos(login),
      queryFn: async (): Promise<Page<RestRepo>> =>
        (await orNull(
          restPage(RestRepo, `/users/${login}/repos`, { query: { sort: "pushed", per_page: GUEST_REPOS_PER_PROFILE } }),
        )) ?? { items: [], next: null },
      staleTime: GUEST_STALE_TIME,
    }),
  /** GitHub's request budget for this device's address. */
  rateLimit: () =>
    queryOptions({
      queryKey: keys.guest.rateLimit(),
      queryFn: async () => {
        const { resources } = await rest(RestRateLimit, "/rate_limit");
        return { limit: resources.core.limit, remaining: resources.core.remaining, resetAt: new Date(resources.core.reset * 1000).toISOString() };
      },
      staleTime: 0,
      meta: { persist: false },
    }),
};
