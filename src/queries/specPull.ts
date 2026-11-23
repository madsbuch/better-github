// Opening a pull request that carries a reworked spec: a new branch off the
// one that was read, one commit with the changed files, and a description that
// tells a coding agent what follows from it. The same, with files copied
// from another repository, pulls a shared part into a spec.
// Spec: RW14, SC5

import { z } from "zod";
import { ApiError, rest } from "../lib/api";
import { specPullBranch } from "../lib/specRework";
import { affects } from "./keys";
import { useAppMutation } from "./mutation";
import { RestCreatedPull } from "./newPull";

const RestCommitRef = z.object({ sha: z.string(), commit: z.object({ tree: z.object({ sha: z.string() }) }) });
const RestSha = z.object({ sha: z.string() });
const RestBlob = z.object({ content: z.string(), encoding: z.string() });

export interface SpecPullInput {
  /** The branch the spec was read on: the pull request goes into it. */
  base: string;
  title: string;
  body: string;
  /** The changed files, whole, by their path in the repository. */
  files: { path: string; text: string }[];
  /** Files copied byte for byte from another repository's object store, by their path here. */
  copies?: { path: string; owner: string; repo: string; oid: string }[] | undefined;
  /** Files to remove. */
  deletes?: string[] | undefined;
}

/**
 * Copies a blob from one repository to another, exactly. A blob's id is made
 * from its bytes, so the copy has the same id, or it isn't a copy.
 */
async function copyBlob(at: string, copy: { owner: string; repo: string; oid: string }): Promise<string> {
  const blob = await rest(RestBlob, `/repos/${copy.owner}/${copy.repo}/git/blobs/${copy.oid}`);
  if (blob.encoding !== "base64") throw new Error(`GitHub sent ${copy.oid} as ${blob.encoding}, not base64.`);
  const made = await rest(RestSha, `${at}/git/blobs`, { method: "POST", body: { content: blob.content.replace(/\s/g, ""), encoding: "base64" } });
  if (made.sha !== copy.oid) throw new Error(`The copy of ${copy.oid} came out as ${made.sha}.`);
  return made.sha;
}

/** Commits `files` to a new branch off `base` and opens a pull request for it. */
export function useOpenSpecPull(owner: string, repo: string) {
  return useAppMutation({
    mutationFn: async (input: SpecPullInput) => {
      const at = `/repos/${owner}/${repo}`;
      const tip = await rest(RestCommitRef, `${at}/commits/${encodeURIComponent(input.base)}`);
      const copied = await Promise.all((input.copies ?? []).map(async (copy) => ({ path: copy.path, sha: await copyBlob(at, copy) })));
      const entries = [
        ...input.files.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.text })),
        ...copied.map((file) => ({ path: file.path, mode: "100644", type: "blob", sha: file.sha })),
        // A null sha takes the file out of the tree.
        ...(input.deletes ?? []).map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
      ];
      const tree = await rest(RestSha, `${at}/git/trees`, { method: "POST", body: { base_tree: tip.commit.tree.sha, tree: entries } });
      const commit = await rest(RestSha, `${at}/git/commits`, { method: "POST", body: { message: input.title.trim(), tree: tree.sha, parents: [tip.sha] } });
      // Named after the title and the commit, so the same change twice isn't a clash.
      const branch = specPullBranch(input.title, commit.sha.slice(0, 6));
      try {
        await rest(RestSha.partial(), `${at}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
      } catch (error) {
        // 422: the branch is there, from an earlier try that got this far. It has this very commit.
        if (!(error instanceof ApiError) || error.status !== 422) throw error;
      }
      const pull = await rest(RestCreatedPull, `${at}/pulls`, { method: "POST", body: { title: input.title.trim(), body: input.body, base: input.base, head: branch } });
      return { number: pull.number, branch };
    },
    invalidates: () => affects.newPull(owner, repo, `${owner}/${repo}`),
  });
}
