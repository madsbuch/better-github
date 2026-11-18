import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { errorMessage, graphql } from "../lib/api";
import { backend } from "../lib/backend";
import { REVIEW_RULES } from "../lib/queries";
import { NO_RULES, parseReviewRules, reviewFile, RULES_FILE, type FileReview, type ReviewRules } from "../lib/reviewRules";
import { rulesPrompt } from "../lib/rulesPrompt";
import { useToast } from "../lib/toast";
import type { PullDetail } from "../lib/types";
import { keys } from "./keys";
import { pullQueries } from "./pulls";

export const reviewQueries = {
  /** .review-rules on a branch; `text` is null when the repository has none. */
  rules: (owner: string, repo: string, ref: string) =>
    queryOptions({
      queryKey: keys.repo.reviewRules(owner, repo, ref),
      queryFn: async () => {
        const { repository } = await graphql(REVIEW_RULES, { owner, name: repo, expression: `${ref}:${RULES_FILE}` });
        const blob = repository?.object;
        return { text: blob?.text ?? null, truncated: blob?.isTruncated ?? false };
      },
      // Rules rarely change, but once someone adds them they should show up
      // soon: a screen showing verdicts checks again when it opens.
      staleTime: 30_000,
    }),
};

export interface PullReview {
  /** Verdicts by path, once the rules and files have loaded. */
  files: Map<string, FileReview>;
  /** The rules in force: those on the branch the pull request merges into. */
  rules: ReviewRules | null;
  /** Whether that branch has been checked for rules. */
  loaded: boolean;
  /** The pull request changes .review-rules; its version applies only after merging. */
  changesRules: boolean;
  /** The base branch has no rules, but the pull request's own commit does. */
  headHasRules: boolean;
  /** .review-rules was too large for GitHub to send whole. */
  truncated: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Judges a pull request's files by the review rules of the branch it merges
 * into, never by its own version of them, so it can't lower its own risk.
 */
export function usePullReview(owner: string, repo: string, number: number, pr: PullDetail | null): PullReview {
  const rulesFile = useQuery({ ...reviewQueries.rules(owner, repo, pr?.baseRefName ?? ""), enabled: pr !== null });
  const patches = useQuery({ ...pullQueries.patches(owner, repo, number, pr?.headRefOid ?? ""), enabled: pr !== null });
  const text = rulesFile.data?.text ?? null;
  const rules = useMemo(() => (text === null ? null : parseReviewRules(text)), [text]);

  const changed = patches.data;
  const files = useMemo(() => {
    const verdicts = new Map<string, FileReview>();
    for (const file of changed ?? []) {
      const touchesRules = file.filename === RULES_FILE || file.previous_filename === RULES_FILE;
      // Without rules, only a change to the rules file itself is judged.
      if (rules || touchesRules) verdicts.set(file.filename, reviewFile(rules ?? NO_RULES, file.filename, file.previous_filename));
    }
    return verdicts;
  }, [rules, changed]);

  const changesRules = (changed ?? []).some((f) => f.filename === RULES_FILE || f.previous_filename === RULES_FILE);
  // Without rules on the base branch, say so if the pull request's own commit
  // has some: they aren't used until they're on the base branch.
  const headRules = useQuery({
    ...reviewQueries.rules(owner, repo, pr?.headRefOid ?? ""),
    enabled: pr !== null && rulesFile.isSuccess && text === null && !changesRules,
  });

  return {
    files,
    rules,
    loaded: rulesFile.isSuccess,
    changesRules,
    headHasRules: text === null && !changesRules && (headRules.data?.text ?? null) !== null,
    truncated: rulesFile.data?.truncated ?? false,
    error: rulesFile.error,
    retry: () => void rulesFile.refetch(),
  };
}

/** Checks the rules again, if they're more than a moment old, when a screen showing verdicts opens. */
export function useRecheckReviewRules(owner: string, repo: string, ref: string) {
  useQuery(reviewQueries.rules(owner, repo, ref));
}

/**
 * Copies a prompt for a coding agent to write the repository's review
 * rules, or to improve the ones on `branch`.
 */
export function useCopyRulesPrompt() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return async (owner: string, repo: string, branch: string) => {
    try {
      const { text } = await queryClient.fetchQuery(reviewQueries.rules(owner, repo, branch));
      const current = text === null ? null : { text, warnings: parseReviewRules(text).warnings };
      await backend.copyText(rulesPrompt({ repo: `${owner}/${repo}`, branch, current }));
      toast.show("Prompt copied. Paste it into your coding agent.", "success");
      // The agent is about to change them: check again when the app is back in front.
      void queryClient.invalidateQueries({ queryKey: keys.repo.reviewRules(owner, repo, branch), refetchType: "none" });
    } catch (error) {
      toast.show(`Couldn't copy the prompt: ${errorMessage(error)}`, "error");
    }
  };
}
