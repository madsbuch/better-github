import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { graphql, restPage } from "../lib/api";
import { isGuest } from "../lib/guest";
import { queryClient } from "./client";
import { guestQueries, toOwnerResult, type RestRepo } from "./guest";
import { OWNER, RATE_LIMIT, VIEWER, VIEWER_REPOS, VIEWER_STARRED } from "../lib/queries";
import type { Connection, OwnerResult, RepoListItem, ViewerResult } from "../lib/types";
import { keys, type ViewerRepoTab } from "./keys";

export const viewerQueries = {
  profile: () => queryOptions({ queryKey: keys.viewer.profile(), queryFn: () => graphql<ViewerResult>(VIEWER) }),
  rateLimit: () =>
    queryOptions({
      queryKey: keys.viewer.rateLimit(),
      queryFn: () => graphql<{ rateLimit: { limit: number; remaining: number; resetAt: string } }>(RATE_LIMIT),
      staleTime: 0,
      meta: { persist: false },
    }),
  repos: (tab: ViewerRepoTab) =>
    infiniteQueryOptions({
      queryKey: keys.viewer.repos(tab),
      queryFn: async ({ pageParam }): Promise<Connection<RepoListItem> & { totalCount: number }> => {
        if (tab === "starred") {
          const data = await graphql<{ viewer: { starredRepositories: Connection<RepoListItem> & { totalCount: number } } }>(
            VIEWER_STARRED,
            { after: pageParam },
          );
          return data.viewer.starredRepositories;
        }
        const data = await graphql<{ viewer: { repositories: Connection<RepoListItem> & { totalCount: number } } }>(VIEWER_REPOS, {
          after: pageParam,
        });
        return data.viewer.repositories;
      },
      initialPageParam: null as string | null,
      getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.endCursor : undefined),
    }),
  /** A user's or organization's profile with their repositories. */
  owner: (login: string) =>
    infiniteQueryOptions({
      queryKey: keys.owner(login),
      queryFn: async ({ pageParam }): Promise<OwnerResult> => {
        if (!isGuest()) return graphql<OwnerResult>(OWNER, { login, after: pageParam });
        // Guests: the first page shares the profile list's cached requests; later pages follow REST links.
        const profile = await queryClient.fetchQuery(guestQueries.profile(login));
        if (!profile) return { repositoryOwner: null };
        const repos = pageParam ? await restPage<RestRepo>(pageParam) : await queryClient.fetchQuery(guestQueries.repos(login));
        return toOwnerResult(profile, repos);
      },
      initialPageParam: null as string | null,
      getNextPageParam: (last) =>
        last.repositoryOwner?.repositories.pageInfo.hasNextPage ? last.repositoryOwner.repositories.pageInfo.endCursor : undefined,
    }),
};
