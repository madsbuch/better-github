import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { encodePath, rest, restPage, type Page } from "../lib/api";
import type { Release } from "../lib/types";
import { queryClient } from "./client";
import { keys } from "./keys";

export type ReleaseLookup = { tag: string } | { id: number } | "latest";

/** The cache key part and API path for a lookup. */
function lookupParts(lookup: ReleaseLookup): [key: string, path: string] {
  if (lookup === "latest") return ["latest", "latest"];
  if ("tag" in lookup) return [`tag:${lookup.tag}`, `tags/${encodePath(lookup.tag)}`];
  return [`id:${lookup.id}`, String(lookup.id)];
}

// Releases come with their notes rendered by GitHub (`body_html`).
const HTML = "application/vnd.github.html+json";

export const releaseQueries = {
  list: (owner: string, repo: string) =>
    infiniteQueryOptions({
      queryKey: keys.releases.list(owner, repo),
      queryFn: async ({ pageParam }) => {
        const page: Page<Release> = pageParam
          ? await restPage<Release>(pageParam, { accept: HTML })
          : await restPage<Release>(`/repos/${owner}/${repo}/releases`, { query: { per_page: 20 }, accept: HTML });
        // The list has everything a release's screen shows: opening one needs no request.
        for (const release of page.items) {
          if (!release.draft) queryClient.setQueryData(keys.releases.one(owner, repo, lookupParts({ tag: release.tag_name })[0]), release);
        }
        return page;
      },
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next ?? undefined,
      staleTime: 5 * 60_000,
    }),
  /** One release: by tag (links), by id (notifications) or the latest. */
  one: (owner: string, repo: string, lookup: ReleaseLookup) => {
    const [key, path] = lookupParts(lookup);
    return queryOptions({
      queryKey: keys.releases.one(owner, repo, key),
      queryFn: () => rest<Release>(`/repos/${owner}/${repo}/releases/${path}`, { accept: HTML }),
      staleTime: 5 * 60_000,
    });
  },
};
