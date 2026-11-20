// GraphQL documents, each with the schema its result is parsed with. Every
// document is validated against GitHub's schema in queries.test.ts, and its
// schema against what the document selects in schemaCheck.test.ts.

import type { z } from "zod";
import { gql, type GraphQLDocument } from "./schema";
import {
  Acknowledged,
  AddCommentResult,
  AssignableUsersResult,
  IssueResult,
  NewPullResult,
  OwnerResult,
  PullChecksResult,
  PullCommitsResult,
  PullFilesResult,
  PullResult,
  PullThreadsResult,
  PullTimelineResult,
  RateLimitResult,
  RecentBranchesResult,
  ReplyToThreadResult,
  RepoBranchesResult,
  RepoRecentBranchesResult,
  RepoResult,
  ResolveThreadResult,
  ReviewRulesResult,
  SPEC_BLOB_BATCH,
  SpecBlobsResult,
  SpecRootResult,
  SearchBranchesResult,
  SearchCountsResult,
  SearchIssuesResult,
  SearchReposResult,
  SearchUsersResult,
  UnresolveThreadResult,
  UpdatePullBranchResult,
  ViewerReposResult,
  ViewerResult,
  ViewerStarredResult,
} from "./types";

const ACTOR = "login avatarUrl";

export const PULL_LIST_ITEM = /* GraphQL */ `
  fragment PullListItem on PullRequest {
    id
    number
    title
    url
    state
    isDraft
    createdAt
    updatedAt
    additions
    deletions
    totalCommentsCount
    reviewDecision
    author { ${ACTOR} }
    repository { nameWithOwner }
    labels(first: 6) { nodes { name color } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }
`;

export const ISSUE_LIST_ITEM = /* GraphQL */ `
  fragment IssueListItem on Issue {
    id
    number
    title
    url
    issueState: state
    stateReason
    createdAt
    updatedAt
    author { ${ACTOR} }
    repository { nameWithOwner }
    comments { totalCount }
    labels(first: 6) { nodes { name color } }
  }
`;

export const REPO_LIST_ITEM = /* GraphQL */ `
  fragment RepoListItem on Repository {
    id
    name
    nameWithOwner
    description
    isPrivate
    isFork
    isArchived
    stargazerCount
    pushedAt
    owner { ${ACTOR} }
    primaryLanguage { name color }
  }
`;

/** Issue/PR search used by the inbox and repository lists. */
export const SEARCH_ISSUES = gql(
  SearchIssuesResult,
  /* GraphQL */ `
  query SearchIssues($query: String!, $first: Int!, $after: String) {
    search(query: $query, type: ISSUE, first: $first, after: $after) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename
        ...PullListItem
        ...IssueListItem
      }
    }
  }
  ${PULL_LIST_ITEM}
  ${ISSUE_LIST_ITEM}
`,
);

export const SEARCH_COUNTS = gql(
  SearchCountsResult,
  /* GraphQL */ `
  query SearchCounts($q0: String!, $q1: String!, $q2: String!, $q3: String!, $q4: String!) {
    c0: search(query: $q0, type: ISSUE, first: 1) { issueCount }
    c1: search(query: $q1, type: ISSUE, first: 1) { issueCount }
    c2: search(query: $q2, type: ISSUE, first: 1) { issueCount }
    c3: search(query: $q3, type: ISSUE, first: 1) { issueCount }
    c4: search(query: $q4, type: ISSUE, first: 1) { issueCount }
  }
`,
);

export const SEARCH_REPOS = gql(
  SearchReposResult,
  /* GraphQL */ `
  query SearchRepos($query: String!, $after: String) {
    search(query: $query, type: REPOSITORY, first: 25, after: $after) {
      repositoryCount
      pageInfo { hasNextPage endCursor }
      nodes { __typename ...RepoListItem }
    }
  }
  ${REPO_LIST_ITEM}
`,
);

export const SEARCH_USERS = gql(
  SearchUsersResult,
  /* GraphQL */ `
  query SearchUsers($query: String!, $after: String) {
    search(query: $query, type: USER, first: 25, after: $after) {
      userCount
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename
        ... on User { id login name avatarUrl bio }
        ... on Organization { id login name avatarUrl description }
      }
    }
  }
`,
);

export const VIEWER_REPOS = gql(
  ViewerReposResult,
  /* GraphQL */ `
  query ViewerRepos($after: String) {
    viewer {
      repositories(
        first: 30
        after: $after
        orderBy: { field: PUSHED_AT, direction: DESC }
        ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      ) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...RepoListItem }
      }
    }
  }
  ${REPO_LIST_ITEM}
`,
);

export const VIEWER_STARRED = gql(
  ViewerStarredResult,
  /* GraphQL */ `
  query ViewerStarred($after: String) {
    viewer {
      starredRepositories(first: 30, after: $after, orderBy: { field: STARRED_AT, direction: DESC }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...RepoListItem }
      }
    }
  }
  ${REPO_LIST_ITEM}
`,
);

export const VIEWER = gql(
  ViewerResult,
  /* GraphQL */ `
  query Viewer {
    viewer {
      login
      name
      avatarUrl
      bio
      company
      location
      url
      followers { totalCount }
      following { totalCount }
      repositories(ownerAffiliations: [OWNER]) { totalCount }
      starredRepositories { totalCount }
      organizations(first: 30) { nodes { login name avatarUrl } }
    }
    rateLimit { limit remaining resetAt }
  }
`,
);

export const OWNER = gql(
  OwnerResult,
  /* GraphQL */ `
  query Owner($login: String!, $after: String) {
    repositoryOwner(login: $login) {
      __typename
      login
      avatarUrl
      url
      ... on User {
        name
        bio
        company
        location
        followers { totalCount }
        following { totalCount }
      }
      ... on Organization {
        name
        description
        location
      }
      repositories(first: 30, after: $after, orderBy: { field: PUSHED_AT, direction: DESC }, ownerAffiliations: [OWNER]) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...RepoListItem }
      }
    }
  }
  ${REPO_LIST_ITEM}
`,
);

export const REPO = gql(
  RepoResult,
  /* GraphQL */ `
  query Repo($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      name
      nameWithOwner
      description
      url
      homepageUrl
      isPrivate
      isFork
      isArchived
      stargazerCount
      forkCount
      viewerHasStarred
      viewerPermission
      hasIssuesEnabled
      owner { ${ACTOR} }
      defaultBranchRef { name }
      primaryLanguage { name color }
      licenseInfo { spdxId name }
      parent { nameWithOwner }
      latestRelease { name tagName publishedAt isPrerelease }
      releases { totalCount }
      watchers { totalCount }
      pullRequests(states: [OPEN]) { totalCount }
      issues(states: [OPEN]) { totalCount }
      repositoryTopics(first: 12) { nodes { topic { name } } }
    }
  }
`,
);

export const RATE_LIMIT = gql(
  RateLimitResult,
  /* GraphQL */ `
  query RateLimit {
    rateLimit { limit remaining resetAt }
  }
`,
);

// ---------------------------------------------------------------------------
// Pull requests

export const PULL = gql(
  PullResult,
  /* GraphQL */ `
  query Pull($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      id
      nameWithOwner
      viewerPermission
      mergeCommitAllowed
      squashMergeAllowed
      rebaseMergeAllowed
      autoMergeAllowed
      deleteBranchOnMerge
      viewerDefaultMergeMethod
      pullRequest(number: $number) {
        id
        number
        title
        url
        state
        isDraft
        merged
        closed
        locked
        body
        bodyHTML
        createdAt
        updatedAt
        mergedAt
        mergedBy { ${ACTOR} }
        author { ${ACTOR} }
        authorAssociation
        baseRefName
        headRefName
        headRefOid
        isCrossRepository
        headRepository { nameWithOwner }
        additions
        deletions
        changedFiles
        commits { totalCount }
        mergeable
        mergeStateStatus
        reviewDecision
        isInMergeQueue
        autoMergeRequest { mergeMethod enabledBy { login } }
        viewerDidAuthor
        viewerCanUpdate
        viewerCanClose
        viewerCanReopen
        viewerCanDeleteHeadRef
        viewerCanEnableAutoMerge
        viewerCanDisableAutoMerge
        viewerCanMergeAsAdmin
        viewerCanUpdateBranch
        viewerLatestReview { state }
        statusCheckRollup { state }
        labels(first: 20) { nodes { name color } }
        assignees(first: 10) { nodes { ${ACTOR} } }
        milestone { title }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { ${ACTOR} }
              ... on Bot { ${ACTOR} }
              ... on Mannequin { ${ACTOR} }
              ... on Team { name slug }
            }
          }
        }
        latestOpinionatedReviews(first: 20) {
          nodes { state author { ${ACTOR} } }
        }
        squashTitle: viewerMergeHeadlineText(mergeType: SQUASH)
        squashBody: viewerMergeBodyText(mergeType: SQUASH)
        mergeTitle: viewerMergeHeadlineText(mergeType: MERGE)
        mergeBody: viewerMergeBodyText(mergeType: MERGE)
      }
    }
  }
`,
);

const TIMELINE_ACTOR = `actor { ${ACTOR} }`;

export const PULL_TIMELINE = gql(
  PullTimelineResult,
  /* GraphQL */ `
  query PullTimeline($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        timelineItems(
          first: 60
          after: $after
          itemTypes: [
            ISSUE_COMMENT
            PULL_REQUEST_REVIEW
            PULL_REQUEST_COMMIT
            MERGED_EVENT
            CLOSED_EVENT
            REOPENED_EVENT
            HEAD_REF_FORCE_PUSHED_EVENT
            HEAD_REF_DELETED_EVENT
            REVIEW_REQUESTED_EVENT
            REVIEW_DISMISSED_EVENT
            READY_FOR_REVIEW_EVENT
            CONVERT_TO_DRAFT_EVENT
            LABELED_EVENT
            UNLABELED_EVENT
            ASSIGNED_EVENT
            RENAMED_TITLE_EVENT
            CROSS_REFERENCED_EVENT
          ]
        ) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            ... on IssueComment {
              id
              author { ${ACTOR} }
              authorAssociation
              body
              bodyHTML
              createdAt
              url
            }
            ... on PullRequestReview {
              id
              author { ${ACTOR} }
              authorAssociation
              state
              body
              bodyHTML
              submittedAt
              createdAt
              url
              comments(first: 50) {
                totalCount
                nodes { id replyTo { id } }
              }
            }
            ... on PullRequestCommit {
              id
              commit {
                oid
                abbreviatedOid
                messageHeadline
                committedDate
                author { name avatarUrl user { login } }
                statusCheckRollup { state }
              }
            }
            ... on MergedEvent { id ${TIMELINE_ACTOR} createdAt mergeRefName mergeCommit: commit { abbreviatedOid } }
            ... on ClosedEvent { id ${TIMELINE_ACTOR} createdAt }
            ... on ReopenedEvent { id ${TIMELINE_ACTOR} createdAt }
            ... on HeadRefForcePushedEvent {
              id
              ${TIMELINE_ACTOR}
              createdAt
              beforeCommit { abbreviatedOid }
              afterCommit { abbreviatedOid }
            }
            ... on HeadRefDeletedEvent { id ${TIMELINE_ACTOR} createdAt headRefName }
            ... on ReviewRequestedEvent {
              id
              ${TIMELINE_ACTOR}
              createdAt
              requestedReviewer {
                __typename
                ... on User { login }
                ... on Bot { login }
                ... on Mannequin { login }
                ... on Team { name }
              }
            }
            ... on ReviewDismissedEvent { id ${TIMELINE_ACTOR} createdAt previousReviewState }
            ... on ReadyForReviewEvent { id ${TIMELINE_ACTOR} createdAt }
            ... on ConvertToDraftEvent { id ${TIMELINE_ACTOR} createdAt }
            ... on LabeledEvent { id ${TIMELINE_ACTOR} createdAt label { name color } }
            ... on UnlabeledEvent { id ${TIMELINE_ACTOR} createdAt label { name color } }
            ... on AssignedEvent {
              id
              ${TIMELINE_ACTOR}
              createdAt
              assignee {
                __typename
                ... on User { login }
                ... on Bot { login }
                ... on Mannequin { login }
                ... on Organization { login }
              }
            }
            ... on RenamedTitleEvent { id ${TIMELINE_ACTOR} createdAt previousTitle currentTitle }
            ... on CrossReferencedEvent {
              id
              ${TIMELINE_ACTOR}
              createdAt
              source {
                __typename
                ... on Issue { number title url state repository { nameWithOwner } }
                ... on PullRequest { number title url prState: state repository { nameWithOwner } }
              }
            }
          }
        }
      }
    }
  }
`,
);

export const REVIEW_THREAD_FIELDS = /* GraphQL */ `
  fragment ReviewThreadFields on PullRequestReviewThread {
    id
    path
    line
    originalLine
    startLine
    diffSide
    isResolved
    isOutdated
    subjectType
    viewerCanReply
    viewerCanResolve
    viewerCanUnresolve
    resolvedBy { login }
    comments(first: 50) {
      totalCount
      nodes {
        id
        databaseId
        author { ${ACTOR} }
        authorAssociation
        body
        bodyHTML
        createdAt
        diffHunk
        url
        outdated
        pullRequestReview { id }
      }
    }
  }
`;

export const PULL_THREADS = gql(
  PullThreadsResult,
  /* GraphQL */ `
  query PullThreads($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 50, after: $after) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { ...ReviewThreadFields }
        }
      }
    }
  }
  ${REVIEW_THREAD_FIELDS}
`,
);

export const PULL_FILES = gql(
  PullFilesResult,
  /* GraphQL */ `
  query PullFiles($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        files(first: 100, after: $after) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { path additions deletions changeType viewerViewedState }
        }
      }
    }
  }
`,
);

export const PULL_COMMITS = gql(
  PullCommitsResult,
  /* GraphQL */ `
  query PullCommits($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        commits(first: 100, after: $after) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            commit {
              oid
              abbreviatedOid
              messageHeadline
              committedDate
              additions
              deletions
              author { name avatarUrl user { login } }
              statusCheckRollup { state }
            }
          }
        }
      }
    }
  }
`,
);

export const PULL_CHECKS = gql(
  PullChecksResult,
  /* GraphQL */ `
  query PullChecks($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        headRefOid
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                state
                contexts(first: 100) {
                  totalCount
                  nodes {
                    __typename
                    ... on CheckRun {
                      id
                      name
                      status
                      conclusion
                      title
                      detailsUrl
                      startedAt
                      completedAt
                      isRequired(pullRequestNumber: $number)
                      checkSuite {
                        app { name }
                        workflowRun { databaseId runNumber workflow { name } }
                      }
                    }
                    ... on StatusContext {
                      id
                      context
                      state
                      description
                      targetUrl
                      avatarUrl
                      createdAt
                      isRequired(pullRequestNumber: $number)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`,
);

// ---------------------------------------------------------------------------
// Issues

export const ISSUE = gql(
  IssueResult,
  /* GraphQL */ `
  query IssueDetail($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      id
      nameWithOwner
      viewerPermission
      issueOrPullRequest(number: $number) {
        __typename
        ... on Issue {
          id
          number
          title
          url
          state
          stateReason
          locked
          body
          bodyHTML
          createdAt
          author { ${ACTOR} }
          authorAssociation
          viewerCanUpdate
          viewerCanClose
          viewerCanReopen
          labels(first: 20) { nodes { name color } }
          assignees(first: 10) { nodes { ${ACTOR} } }
          milestone { title }
          timelineItems(
            first: 60
            after: $after
            itemTypes: [
              ISSUE_COMMENT
              CLOSED_EVENT
              REOPENED_EVENT
              LABELED_EVENT
              UNLABELED_EVENT
              ASSIGNED_EVENT
              RENAMED_TITLE_EVENT
              CROSS_REFERENCED_EVENT
            ]
          ) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              __typename
              ... on IssueComment {
                id
                author { ${ACTOR} }
                authorAssociation
                body
                bodyHTML
                createdAt
                url
              }
              ... on ClosedEvent { id ${TIMELINE_ACTOR} createdAt stateReason }
              ... on ReopenedEvent { id ${TIMELINE_ACTOR} createdAt }
              ... on LabeledEvent { id ${TIMELINE_ACTOR} createdAt label { name color } }
              ... on UnlabeledEvent { id ${TIMELINE_ACTOR} createdAt label { name color } }
              ... on AssignedEvent {
                id
                ${TIMELINE_ACTOR}
                createdAt
                assignee {
                  __typename
                  ... on User { login }
                  ... on Bot { login }
                  ... on Mannequin { login }
                  ... on Organization { login }
                }
              }
              ... on RenamedTitleEvent { id ${TIMELINE_ACTOR} createdAt previousTitle currentTitle }
              ... on CrossReferencedEvent {
                id
                ${TIMELINE_ACTOR}
                createdAt
                source {
                  __typename
                  ... on Issue { number title url state repository { nameWithOwner } }
                  ... on PullRequest { number title url prState: state repository { nameWithOwner } }
                }
              }
            }
          }
        }
        ... on PullRequest { number }
      }
    }
  }
`,
);

// ---------------------------------------------------------------------------
// Mutations

export const ADD_COMMENT = gql(
  AddCommentResult,
  /* GraphQL */ `
  mutation AddComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      commentEdge { node { id } }
    }
  }
`,
);

export const REPLY_TO_THREAD = gql(
  ReplyToThreadResult,
  /* GraphQL */ `
  mutation ReplyToThread($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
      comment { id }
    }
  }
`,
);

export const RESOLVE_THREAD = gql(
  ResolveThreadResult,
  /* GraphQL */ `
  mutation ResolveThread($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
  }
`,
);

export const UNRESOLVE_THREAD = gql(
  UnresolveThreadResult,
  /* GraphQL */ `
  mutation UnresolveThread($threadId: ID!) {
    unresolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
  }
`,
);

/** Brings the base branch into a pull request's branch, with a merge commit or a rebase. */
export const UPDATE_PULL_BRANCH = gql(
  UpdatePullBranchResult,
  /* GraphQL */ `
  mutation UpdatePullBranch($pullRequestId: ID!, $expectedHeadOid: GitObjectID, $updateMethod: PullRequestBranchUpdateMethod) {
    updatePullRequestBranch(input: { pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid, updateMethod: $updateMethod }) {
      pullRequest { id headRefOid }
    }
  }
`,
);

export const MARK_FILE_VIEWED = gql(
  Acknowledged,
  /* GraphQL */ `
  mutation MarkFileViewed($pullRequestId: ID!, $path: String!) {
    markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) { clientMutationId }
  }
`,
);

export const UNMARK_FILE_VIEWED = gql(
  Acknowledged,
  /* GraphQL */ `
  mutation UnmarkFileViewed($pullRequestId: ID!, $path: String!) {
    unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) { clientMutationId }
  }
`,
);

export const READY_FOR_REVIEW = gql(
  Acknowledged,
  /* GraphQL */ `
  mutation ReadyForReview($pullRequestId: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) { pullRequest { id isDraft } }
  }
`,
);

export const CONVERT_TO_DRAFT = gql(
  Acknowledged,
  /* GraphQL */ `
  mutation ConvertToDraft($pullRequestId: ID!) {
    convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) { pullRequest { id isDraft } }
  }
`,
);

export const CLOSE_PULL = gql(
  Acknowledged,
  /* GraphQL */ `
  mutation ClosePull($pullRequestId: ID!) {
    closePullRequest(input: { pullRequestId: $pullRequestId }) { pullRequest { id state } }
  }
`,
);

export const REOPEN_PULL = gql(
  Acknowledged,
  /* GraphQL */ `
  mutation ReopenPull($pullRequestId: ID!) {
    reopenPullRequest(input: { pullRequestId: $pullRequestId }) { pullRequest { id state } }
  }
`,
);

export const ENABLE_AUTO_MERGE = gql(
  Acknowledged,
  /* GraphQL */ `
  mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
    enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
      pullRequest { id }
    }
  }
`,
);

export const DISABLE_AUTO_MERGE = gql(
  Acknowledged,
  /* GraphQL */ `
  mutation DisableAutoMerge($pullRequestId: ID!) {
    disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) { pullRequest { id } }
  }
`,
);

export const CLOSE_ISSUE = gql(
  Acknowledged,
  /* GraphQL */ `
  mutation CloseIssue($issueId: ID!, $stateReason: IssueClosedStateReason) {
    closeIssue(input: { issueId: $issueId, stateReason: $stateReason }) { issue { id state } }
  }
`,
);

export const REOPEN_ISSUE = gql(
  Acknowledged,
  /* GraphQL */ `
  mutation ReopenIssue($issueId: ID!) {
    reopenIssue(input: { issueId: $issueId }) { issue { id state } }
  }
`,
);

// ------------------------------------------------------- new pull requests

/** A branch's tip, and whether it already has an open pull request. */
const BRANCH_TIP = /* GraphQL */ `
  fragment BranchTip on Ref {
    name
    associatedPullRequests(states: [OPEN], first: 1) {
      totalCount
    }
    target {
      ... on Commit {
        oid
        committedDate
        messageHeadline
        author { user { login } }
      }
    }
  }
`;

/** Recently updated branches in the repositories the viewer pushed to last. */
export const RECENT_BRANCHES = gql(
  RecentBranchesResult,
  /* GraphQL */ `
  query RecentBranches {
    viewer {
      repositories(
        first: 6
        orderBy: { field: PUSHED_AT, direction: DESC }
        ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
        isArchived: false
      ) {
        nodes {
          nameWithOwner
          defaultBranchRef { name }
          parent { nameWithOwner defaultBranchRef { name } }
          refs(refPrefix: "refs/heads/", first: 5, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
            nodes { ...BranchTip }
          }
        }
      }
    }
  }
  ${BRANCH_TIP}
`,
);

export const REPO_RECENT_BRANCHES = gql(
  RepoRecentBranchesResult,
  /* GraphQL */ `
  query RepoRecentBranches($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      nameWithOwner
      defaultBranchRef { name }
      parent { nameWithOwner defaultBranchRef { name } }
      refs(refPrefix: "refs/heads/", first: 8, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
        nodes { ...BranchTip }
      }
    }
  }
  ${BRANCH_TIP}
`,
);

const BRANCH_NAME = /* GraphQL */ `
  fragment BranchName on Ref {
    name
    target {
      ... on Commit { committedDate }
    }
  }
`;

/** Every branch for the branch picker, a page at a time, most recently committed first. */
export const REPO_BRANCHES = gql(
  RepoBranchesResult,
  /* GraphQL */ `
  query RepoBranches($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef { name }
      refs(refPrefix: "refs/heads/", first: 100, after: $after, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...BranchName }
      }
    }
  }
  ${BRANCH_NAME}
`,
);

/** GitHub's own branch search, for repositories with more branches than the picker loads. */
export const SEARCH_BRANCHES = gql(
  SearchBranchesResult,
  /* GraphQL */ `
  query SearchBranches($owner: String!, $name: String!, $query: String!) {
    repository(owner: $owner, name: $name) {
      refs(refPrefix: "refs/heads/", first: 50, query: $query, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
        nodes { ...BranchName }
      }
    }
  }
  ${BRANCH_NAME}
`,
);

/** A repository's .review-rules (src/lib/reviewRules.ts), as "<branch>:.review-rules". */
export const REVIEW_RULES = gql(
  ReviewRulesResult,
  /* GraphQL */ `
  query ReviewRules($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        ... on Blob { text isTruncated }
      }
    }
  }
`,
);

/** A repository's spec folder (src/lib/spec.ts), as "<branch>:.spec": the id of its tree, which changes when anything in it does. */
export const SPEC_ROOT = gql(
  SpecRootResult,
  /* GraphQL */ `
  query SpecRoot($owner: String!, $name: String!, $expression: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expression) {
        ... on Tree { oid }
      }
    }
  }
`,
);

const specBlobSlots = Array.from({ length: SPEC_BLOB_BATCH }, (_, i) => i);

/**
 * The contents of up to SPEC_BLOB_BATCH files, by git object id ($o0, $o1, ...).
 * Every slot needs an id: repeat one to fill a short batch.
 */
export const SPEC_BLOBS = gql(
  SpecBlobsResult,
  /* GraphQL */ `
  query SpecBlobs($owner: String!, $name: String!, ${specBlobSlots.map((i) => `$o${i}: GitObjectID!`).join(", ")}) {
    repository(owner: $owner, name: $name) {
      ${specBlobSlots.map((i) => `b${i}: object(oid: $o${i}) { ... on Blob { oid text isTruncated } }`).join("\n      ")}
    }
  }
`,
);

/** What the "open a pull request" screen needs to know about the base repository. */
export const NEW_PULL = gql(
  NewPullResult,
  /* GraphQL */ `
  query NewPull($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      nameWithOwner
      defaultBranchRef { name }
      parent { nameWithOwner }
      pullRequestTemplates { filename body }
      forks(first: 10, affiliations: [OWNER]) {
        nodes { nameWithOwner }
      }
    }
  }
`,
);

export const ASSIGNABLE_USERS = gql(
  AssignableUsersResult,
  /* GraphQL */ `
  query AssignableUsers($owner: String!, $name: String!, $query: String) {
    repository(owner: $owner, name: $name) {
      assignableUsers(first: 30, query: $query) {
        nodes { login name avatarUrl }
      }
    }
  }
`,
);

export const ALL_DOCUMENTS: Record<string, GraphQLDocument<z.ZodType>> = {
  SEARCH_ISSUES,
  SEARCH_COUNTS,
  SEARCH_REPOS,
  SEARCH_USERS,
  VIEWER_REPOS,
  VIEWER_STARRED,
  VIEWER,
  RATE_LIMIT,
  OWNER,
  REPO,
  PULL,
  PULL_TIMELINE,
  PULL_THREADS,
  PULL_FILES,
  PULL_COMMITS,
  PULL_CHECKS,
  ISSUE,
  ADD_COMMENT,
  REPLY_TO_THREAD,
  RESOLVE_THREAD,
  UNRESOLVE_THREAD,
  UPDATE_PULL_BRANCH,
  MARK_FILE_VIEWED,
  UNMARK_FILE_VIEWED,
  READY_FOR_REVIEW,
  CONVERT_TO_DRAFT,
  CLOSE_PULL,
  REOPEN_PULL,
  ENABLE_AUTO_MERGE,
  DISABLE_AUTO_MERGE,
  CLOSE_ISSUE,
  REOPEN_ISSUE,
  RECENT_BRANCHES,
  REPO_RECENT_BRANCHES,
  REPO_BRANCHES,
  SEARCH_BRANCHES,
  REVIEW_RULES,
  SPEC_ROOT,
  SPEC_BLOBS,
  NEW_PULL,
  ASSIGNABLE_USERS,
};
