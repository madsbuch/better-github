import { infiniteQueryOptions } from "@tanstack/react-query";
import { graphql } from "../lib/api";
import { ADD_COMMENT, CLOSE_ISSUE, ISSUE, REOPEN_ISSUE } from "../lib/queries";
import { affects, keys } from "./keys";
import { useAppMutation } from "./mutation";

/** The first page of the timeline: no cursor yet (typed so later pages can pass one). */
function noCursor(): string | null {
  return null;
}

export const issueQueries = {
  /** The issue and its timeline, paginated. GitHub answers with a pull request for PR numbers. */
  detail: (owner: string, repo: string, number: number) =>
    infiniteQueryOptions({
      queryKey: keys.issue.detail(owner, repo, number),
      queryFn: ({ pageParam }) => graphql(ISSUE, { owner, name: repo, number, after: pageParam }),
      initialPageParam: noCursor(),
      getNextPageParam: (last) => {
        const issue = last.repository?.issueOrPullRequest;
        return issue?.__typename === "Issue" && "timelineItems" in issue && issue.timelineItems.pageInfo.hasNextPage ? issue.timelineItems.pageInfo.endCursor : undefined;
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
    mutationFn: ({ issueId, close, reason }: { issueId: string; close: boolean; reason?: "COMPLETED" | "NOT_PLANNED" | undefined }) =>
      close ? graphql(CLOSE_ISSUE, { issueId, stateReason: reason ?? "COMPLETED" }) : graphql(REOPEN_ISSUE, { issueId }),
    success: ({ close }) => (close ? "Issue closed" : "Issue reopened"),
    invalidates,
  });
  return { comment, setState };
}
