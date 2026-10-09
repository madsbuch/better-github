import { infiniteQueryOptions } from "@tanstack/react-query";
import { graphql } from "../lib/api";
import { ADD_COMMENT, CLOSE_ISSUE, ISSUE, REOPEN_ISSUE } from "../lib/queries";
import type { IssueResult } from "../lib/types";
import { affects, keys } from "./keys";
import { useAppMutation } from "./mutation";

export const issueQueries = {
  /** The issue and its timeline, paginated. GitHub answers with a pull request for PR numbers. */
  detail: (owner: string, repo: string, number: number) =>
    infiniteQueryOptions({
      queryKey: keys.issue.detail(owner, repo, number),
      queryFn: ({ pageParam }) => graphql<IssueResult>(ISSUE, { owner, name: repo, number, after: pageParam }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => {
        const issue = last.repository?.issueOrPullRequest;
        return issue?.__typename === "Issue" && issue.timelineItems.pageInfo.hasNextPage ? issue.timelineItems.pageInfo.endCursor : undefined;
      },
    }),
};

export function useIssueMutations(owner: string, repo: string, number: number) {
  const invalidates = affects.issue(owner, repo, number);
  const comment = useAppMutation({
    mutationFn: ({ subjectId, body }: { subjectId: string; body: string }) => graphql(ADD_COMMENT, { subjectId, body }),
    invalidates,
  });
  const setState = useAppMutation({
    mutationFn: ({ issueId, close, reason }: { issueId: string; close: boolean; reason?: "COMPLETED" | "NOT_PLANNED" }) =>
      close ? graphql(CLOSE_ISSUE, { issueId, stateReason: reason ?? "COMPLETED" }) : graphql(REOPEN_ISSUE, { issueId }),
    success: ({ close }) => (close ? "Issue closed" : "Issue reopened"),
    invalidates,
  });
  return { comment, setState };
}
