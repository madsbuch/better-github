import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, encodePath, graphql, rest, restPage, restSend } from "../lib/api";
import { REPO } from "../lib/queries";
import type { RepoResult } from "../lib/types";
import { isGuest } from "../lib/guest";
import { guestRepoDetail } from "./guest";
import { affects, keys } from "./keys";
import { patchQueries, useAppMutation } from "./mutation";

// ------------------------------------------------------------ REST shapes
// Only the fields the app reads; see lib/restConformance.repos.ts.

/** A commit's author or committer on GitHub: a user, `{}` (no matching account, read as null) or null. */
const CommitUser = z
  .union([z.object({ login: z.string(), avatar_url: z.string() }), z.object({}).transform(() => null)])
  .nullable();

/** Name, email and date from the commit itself (`nullable-git-user`). */
const GitUser = z.object({ name: z.string().optional(), date: z.string().optional() }).nullable();

/** A changed file in a commit or comparison (`diff-entry`). */
export const DiffEntry = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
});
export type DiffEntry = z.infer<typeof DiffEntry>;

/** A commit as REST lists it (`commit`): in a branch's history or a comparison. */
export const RestCommitListItem = z.object({
  sha: z.string(),
  commit: z.object({ message: z.string(), author: GitUser, committer: GitUser }),
  author: CommitUser,
});
export type RestCommitListItem = z.infer<typeof RestCommitListItem>;

/** A single commit with its diff (`commit`). */
export const RestCommit = RestCommitListItem.extend({
  parents: z.array(z.object({ sha: z.string() })),
  stats: z.object({ additions: z.number().optional(), deletions: z.number().optional() }).optional(),
  files: z.array(DiffEntry).optional(),
});
export type RestCommit = z.infer<typeof RestCommit>;

/** An entry of a directory listing (`content-directory`). */
export const RestContentItem = z.object({
  type: z.enum(["dir", "file", "submodule", "symlink"]),
  name: z.string(),
  path: z.string(),
  html_url: z.string().nullable(),
});
export type RestContentItem = z.infer<typeof RestContentItem>;

/** A path's contents: a directory's entries, or a single file, symlink or submodule (not read). */
export const RestContents = z.union([z.array(RestContentItem), z.object({})]);

/**
 * A file (`content-file`). `content` and `encoding` are optional here: files
 * over 1 MB come with empty content, and symlinks or submodules have none.
 */
export const RestContentFile = z.object({
  size: z.number(),
  download_url: z.string().nullable(),
  content: z.string().optional(),
  encoding: z.string().optional(),
});
export type RestContentFile = z.infer<typeof RestContentFile>;

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i;
const MAX_TEXT_BYTES = 3 * 1024 * 1024;

/**
 * A raw file body. The backend hands text over as a string, but may have
 * parsed a JSON file already; that is shown pretty-printed.
 */
const rawBody = z.union([z.string(), z.json().transform((value) => JSON.stringify(value, null, 2))]);

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
      queryFn: () => (isGuest() ? guestRepoDetail(owner, repo) : graphql(REPO, { owner, name: repo })),
    }),
  /** Rendered README HTML, or null when the repository has none. */
  readme: (owner: string, repo: string) =>
    queryOptions({
      queryKey: keys.repo.readme(owner, repo),
      queryFn: async () => {
        try {
          return await rest(z.string(), `/repos/${owner}/${repo}/readme`, { accept: "application/vnd.github.html+json" });
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
      queryFn: () => rest(RestContents, `/repos/${owner}/${repo}/contents/${encodePath(path)}`, { query: { ref } }),
    }),
  blob: (owner: string, repo: string, ref: string, path: string) =>
    queryOptions({
      queryKey: keys.repo.blob(owner, repo, ref, path),
      queryFn: async (): Promise<LoadedBlob> => {
        const meta = await rest(RestContentFile, `/repos/${owner}/${repo}/contents/${encodePath(path)}`, { query: { ref } });
        if (IMAGE.test(path)) return { kind: "image", meta };
        if (meta.size > MAX_TEXT_BYTES) return { kind: "too-large", meta };
        if (meta.content === undefined || meta.content === "" || meta.encoding !== "base64") {
          // Files over 1 MB come without inline content.
          const raw = await rest(rawBody, `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
            query: { ref },
            accept: "application/vnd.github.raw+json",
          });
          return { kind: "text", text: raw, meta };
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
        rest(z.string(), `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
          query: { ref },
          accept: "application/vnd.github.html+json",
        }),
      gcTime: 10 * 60_000,
      meta: { persist: false },
    }),
  commits: (owner: string, repo: string, ref: string) =>
    infiniteQueryOptions({
      queryKey: keys.repo.commits(owner, repo, ref),
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        pageParam !== null && pageParam !== ""
          ? restPage(RestCommitListItem, pageParam)
          : restPage(RestCommitListItem, `/repos/${owner}/${repo}/commits`, { query: { sha: ref, per_page: 30 } }),
      initialPageParam: null,
      getNextPageParam: (last) => last.next ?? undefined,
    }),
  /** A commit with its diff; commits never change. */
  commit: (owner: string, repo: string, sha: string) =>
    queryOptions({
      queryKey: keys.repo.commit(owner, repo, sha),
      queryFn: () => rest(RestCommit, `/repos/${owner}/${repo}/commits/${sha}`),
      staleTime: Infinity,
      gcTime: 10 * 60_000,
      meta: { persist: false },
    }),
};

export function useStarRepo(owner: string, repo: string) {
  return useAppMutation({
    mutationFn: (star: boolean) => restSend(`/user/starred/${owner}/${repo}`, { method: star ? "PUT" : "DELETE" }),
    optimistic: (star, queryClient) =>
      patchQueries<RepoResult>(queryClient, { queryKey: keys.repo.detail(owner, repo), exact: true }, (old) =>
        old.repository !== null
          ? { repository: { ...old.repository, viewerHasStarred: star, stargazerCount: old.repository.stargazerCount + (star ? 1 : -1) } }
          : old,
      ),
    invalidates: affects.star(owner, repo),
  });
}
