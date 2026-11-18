import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { encodePath, rest, restPage, type Page } from "../lib/api";
import { queryClient } from "./client";
import { keys } from "./keys";

/** The fields of GitHub's `release-asset` the app reads. */
export const ReleaseAsset = z.object({
  id: z.number(),
  name: z.string(),
  content_type: z.string(),
  size: z.number(),
  download_count: z.number(),
  browser_download_url: z.string(),
});
export type ReleaseAsset = z.infer<typeof ReleaseAsset>;

/** The fields of GitHub's `release` the app reads. */
export const Release = z.object({
  id: z.number(),
  html_url: z.string(),
  tag_name: z.string(),
  name: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  created_at: z.string(),
  published_at: z.string().nullable(),
  author: z.object({ login: z.string(), avatar_url: z.string() }),
  assets: z.array(ReleaseAsset),
  /** Present when requested with the HTML media type (see `HTML`). */
  body_html: z.string().optional(),
});
export type Release = z.infer<typeof Release>;

export type ReleaseLookup = { tag: string } | { id: number } | "latest";

/** The cache key part and API path for a lookup. */
function lookupParts(lookup: ReleaseLookup): [key: string, path: string] {
  if (lookup === "latest") return ["latest", "latest"];
  if ("tag" in lookup) return [`tag:${lookup.tag}`, `tags/${encodePath(lookup.tag)}`];
  return [`id:${lookup.id.toString()}`, lookup.id.toString()];
}

// Releases come with their notes rendered by GitHub (`body_html`).
const HTML = "application/vnd.github.html+json";

export const releaseQueries = {
  list: (owner: string, repo: string) =>
    infiniteQueryOptions({
      queryKey: keys.releases.list(owner, repo),
      queryFn: async ({ pageParam }: { pageParam: string | null }) => {
        const page: Page<Release> =
          pageParam !== null && pageParam !== ""
            ? await restPage(Release, pageParam, { accept: HTML })
            : await restPage(Release, `/repos/${owner}/${repo}/releases`, { query: { per_page: 20 }, accept: HTML });
        // The list has everything a release's screen shows: opening one needs no request.
        for (const release of page.items) {
          if (!release.draft) queryClient.setQueryData(keys.releases.one(owner, repo, lookupParts({ tag: release.tag_name })[0]), release);
        }
        return page;
      },
      initialPageParam: null,
      getNextPageParam: (last) => last.next ?? undefined,
      staleTime: 5 * 60_000,
    }),
  /** One release: by tag (links), by id (notifications) or the latest. */
  one: (owner: string, repo: string, lookup: ReleaseLookup) => {
    const [key, path] = lookupParts(lookup);
    return queryOptions({
      queryKey: keys.releases.one(owner, repo, key),
      queryFn: () => rest(Release, `/repos/${owner}/${repo}/releases/${path}`, { accept: HTML }),
      staleTime: 5 * 60_000,
    });
  },
};
