// Opening a pull request that carries a reworked spec: a new branch off the
// one that was read, one commit with the changed files, and a description that
// tells a coding agent what follows from it.
// Spec: RW14

import { z } from "zod";
import { ApiError, rest } from "../lib/api";
import { specPullBranch } from "../lib/specRework";
import { affects } from "./keys";
import { useAppMutation } from "./mutation";
import { RestCreatedPull } from "./newPull";

const RestCommitRef = z.object({ sha: z.string(), commit: z.object({ tree: z.object({ sha: z.string() }) }) });
const RestSha = z.object({ sha: z.string() });

export interface SpecPullInput {
  /** The branch the spec was read on: the pull request goes into it. */
  base: string;
  title: string;
  body: string;
  /** The changed files, whole, by their path in the repository. */
  files: { path: string; text: string }[];
}

/** Commits `files` to a new branch off `base` and opens a pull request for it. */
export function useOpenSpecPull(owner: string, repo: string) {
  return useAppMutation({
    mutationFn: async (input: SpecPullInput) => {
      const at = `/repos/${owner}/${repo}`;
      const tip = await rest(RestCommitRef, `${at}/commits/${encodeURIComponent(input.base)}`);
      const tree = await rest(RestSha, `${at}/git/trees`, {
        method: "POST",
        body: { base_tree: tip.commit.tree.sha, tree: input.files.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.text })) },
      });
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
