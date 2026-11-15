import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { ApiError, encodePath, graphql, rest, restPage } from "../lib/api";
import { REPO } from "../lib/queries";
import type { RepoResult, RestCommit, RestCommitListItem, RestContentFile, RestContentItem } from "../lib/types";
import { isGuest } from "../lib/guest";
import { guestRepoDetail } from "./guest";
import { affects, keys } from "./keys";
import { patchQueries, useAppMutation } from "./mutation";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i;
const MAX_TEXT_BYTES = 3 * 1024 * 1024;

export type LoadedBlob =
  | { kind: "text"; text: string; meta: RestContentFile }
  | { kind: "image"; meta: RestContentFile }
  | { kind: "binary"; meta: RestContentFile }
  | { kind: "too-large"; meta: RestContentFile };

function decodeBase64(content: string): Uint8Array {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export const repoQueries = {
  detail: (owner: string, repo: string) =>
    queryOptions({
      queryKey: keys.repo.detail(owner, repo),
      queryFn: () => (isGuest() ? guestRepoDetail(owner, repo) : graphql<RepoResult>(REPO, { owner, name: repo })),
    }),
  /** Rendered README HTML, or null when the repository has none. */
  readme: (owner: string, repo: string) =>
    queryOptions({
      queryKey: keys.repo.readme(owner, repo),
      queryFn: async () => {
        try {
          return await rest<string>(`/repos/${owner}/${repo}/readme`, { accept: "application/vnd.github.html+json" });
        } catch (e) {
          if (ApiError.from(e).status === 404) return null;
          throw e;
        }
      },
      staleTime: 10 * 60_000,
    }),
  contents: (owner: string, repo: string, ref: string, path: string) =>
    queryOptions({
      queryKey: keys.repo.contents(owner, repo, ref, path),
      queryFn: () => rest<RestContentItem[] | RestContentItem>(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, { query: { ref } }),
    }),
  blob: (owner: string, repo: string, ref: string, path: string) =>
    queryOptions({
      queryKey: keys.repo.blob(owner, repo, ref, path),
      queryFn: async (): Promise<LoadedBlob> => {
        const meta = await rest<RestContentFile>(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, { query: { ref } });
        if (IMAGE.test(path)) return { kind: "image", meta };
        if (meta.size > MAX_TEXT_BYTES) return { kind: "too-large", meta };
        if (!(meta.content && meta.encoding === "base64")) {
          // Files over 1 MB come without inline content.
          const raw = await rest<string>(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
            query: { ref },
            accept: "application/vnd.github.raw+json",
          });
          return { kind: "text", text: typeof raw === "string" ? raw : JSON.stringify(raw, null, 2), meta };
        }
        const bytes = decodeBase64(meta.content);
        if (looksBinary(bytes)) return { kind: "binary", meta };
        return { kind: "text", text: new TextDecoder().decode(bytes), meta };
      },
      gcTime: 10 * 60_000,
      meta: { persist: false },
    }),
  /** A markdown file rendered by GitHub. */
  blobHtml: (owner: string, repo: string, ref: string, path: string) =>
    queryOptions({
      queryKey: keys.repo.blobHtml(owner, repo, ref, path),
      queryFn: () =>
        rest<string>(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
          query: { ref },
          accept: "application/vnd.github.html+json",
        }),
      gcTime: 10 * 60_000,
      meta: { persist: false },
    }),
  commits: (owner: string, repo: string, ref: string) =>
    infiniteQueryOptions({
      queryKey: keys.repo.commits(owner, repo, ref),
      queryFn: ({ pageParam }) =>
        pageParam
          ? restPage<RestCommitListItem>(pageParam)
          : restPage<RestCommitListItem>(`/repos/${owner}/${repo}/commits`, { query: { sha: ref, per_page: 30 } }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next ?? undefined,
    }),
  /** A commit with its diff; commits never change. */
  commit: (owner: string, repo: string, sha: string) =>
    queryOptions({
      queryKey: keys.repo.commit(owner, repo, sha),
      queryFn: () => rest<RestCommit>(`/repos/${owner}/${repo}/commits/${sha}`),
      staleTime: Infinity,
      gcTime: 10 * 60_000,
      meta: { persist: false },
    }),
};

export function useStarRepo(owner: string, repo: string) {
  return useAppMutation({
    mutationFn: (star: boolean) => rest(`/user/starred/${owner}/${repo}`, { method: star ? "PUT" : "DELETE" }),
    optimistic: (star, queryClient) =>
      patchQueries<RepoResult>(queryClient, { queryKey: keys.repo.detail(owner, repo), exact: true }, (old) =>
        old.repository
          ? { repository: { ...old.repository, viewerHasStarred: star, stargazerCount: old.repository.stargazerCount + (star ? 1 : -1) } }
          : old,
      ),
    invalidates: affects.star(owner, repo),
  });
}
