// Shapes of the GraphQL results in queries.ts and the REST payloads we use.

import type { components } from "@octokit/openapi-types";

export interface Actor {
  login: string;
  avatarUrl: string;
}

export interface Label {
  name: string;
  color: string;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Connection<T> {
  totalCount?: number;
  pageInfo: PageInfo;
  nodes: T[];
}

export type StatusState = "EXPECTED" | "ERROR" | "FAILURE" | "PENDING" | "SUCCESS";
export type PullState = "OPEN" | "CLOSED" | "MERGED";
export type IssueState = "OPEN" | "CLOSED";
export type IssueStateReason = "COMPLETED" | "NOT_PLANNED" | "REOPENED" | "DUPLICATE" | null;
export type ReviewDecision = "CHANGES_REQUESTED" | "APPROVED" | "REVIEW_REQUIRED" | null;
export type ReviewState = "PENDING" | "COMMENTED" | "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED";
export type MergeMethod = "MERGE" | "SQUASH" | "REBASE";
export type Permission = "ADMIN" | "MAINTAIN" | "WRITE" | "TRIAGE" | "READ" | null;
export type MergeStateStatus = "DIRTY" | "UNKNOWN" | "BLOCKED" | "BEHIND" | "DRAFT" | "UNSTABLE" | "HAS_HOOKS" | "CLEAN";
export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
export type FileViewedState = "DISMISSED" | "VIEWED" | "UNVIEWED";
export type PatchStatus = "ADDED" | "DELETED" | "RENAMED" | "COPIED" | "MODIFIED" | "CHANGED";

export interface PullListItem {
  __typename: "PullRequest";
  id: string;
  number: number;
  title: string;
  url: string;
  state: PullState;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  totalCommentsCount: number | null;
  reviewDecision: ReviewDecision;
  author: Actor | null;
  repository: { nameWithOwner: string };
  labels: { nodes: Label[] } | null;
  commits: { nodes: { commit: { statusCheckRollup: { state: StatusState } | null } }[] };
}

export interface IssueListItem {
  __typename: "Issue";
  id: string;
  number: number;
  title: string;
  url: string;
  issueState: IssueState;
  stateReason: IssueStateReason;
  createdAt: string;
  updatedAt: string;
  author: Actor | null;
  repository: { nameWithOwner: string };
  comments: { totalCount: number };
  labels: { nodes: Label[] } | null;
}

export type SearchIssueNode = PullListItem | IssueListItem | { __typename: string };

export interface SearchIssuesResult {
  search: {
    issueCount: number;
    pageInfo: PageInfo;
    nodes: SearchIssueNode[];
  };
}

export interface RepoListItem {
  __typename?: "Repository";
  id: string;
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  stargazerCount: number;
  pushedAt: string | null;
  owner: Actor;
  primaryLanguage: { name: string; color: string | null } | null;
}

export interface SearchReposResult {
  search: { repositoryCount: number; pageInfo: PageInfo; nodes: (RepoListItem | { __typename: string })[] };
}

export interface UserListItem {
  __typename: "User" | "Organization";
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string;
  bio?: string | null;
  description?: string | null;
}

export interface SearchUsersResult {
  search: { userCount: number; pageInfo: PageInfo; nodes: (UserListItem | { __typename: string })[] };
}

export interface ViewerResult {
  viewer: {
    login: string;
    name: string | null;
    avatarUrl: string;
    bio: string | null;
    company: string | null;
    location: string | null;
    url: string;
    followers: { totalCount: number };
    following: { totalCount: number };
    repositories: { totalCount: number };
    starredRepositories: { totalCount: number };
    organizations: { nodes: { login: string; name: string | null; avatarUrl: string }[] };
  };
  rateLimit: { limit: number; remaining: number; resetAt: string } | null;
}

export interface OwnerResult {
  repositoryOwner: {
    __typename: "User" | "Organization";
    login: string;
    avatarUrl: string;
    url: string;
    name?: string | null;
    bio?: string | null;
    description?: string | null;
    company?: string | null;
    location?: string | null;
    followers?: { totalCount: number };
    following?: { totalCount: number };
    repositories: Connection<RepoListItem>;
  } | null;
}

export interface RepoDetail {
  id: string;
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  homepageUrl: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  stargazerCount: number;
  forkCount: number;
  viewerHasStarred: boolean;
  viewerPermission: Permission;
  hasIssuesEnabled: boolean;
  owner: Actor;
  defaultBranchRef: { name: string } | null;
  primaryLanguage: { name: string; color: string | null } | null;
  licenseInfo: { spdxId: string | null; name: string } | null;
  parent: { nameWithOwner: string } | null;
  latestRelease: { name: string | null; tagName: string; publishedAt: string | null; isPrerelease: boolean } | null;
  releases: { totalCount: number };
  watchers: { totalCount: number };
  pullRequests: { totalCount: number };
  issues: { totalCount: number };
  repositoryTopics: { nodes: { topic: { name: string } }[] };
}

export interface RepoResult {
  repository: RepoDetail | null;
}

// ---------------------------------------------------------------------------
// Pull request detail

export type RequestedReviewer =
  | { __typename: "User" | "Bot" | "Mannequin"; login: string; avatarUrl: string }
  | { __typename: "Team"; name: string; slug: string };

export interface PullDetail {
  id: string;
  number: number;
  title: string;
  url: string;
  state: PullState;
  isDraft: boolean;
  merged: boolean;
  closed: boolean;
  locked: boolean;
  body: string;
  bodyHTML: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  mergedBy: Actor | null;
  author: Actor | null;
  authorAssociation: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  headRepository: { nameWithOwner: string } | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: { totalCount: number };
  mergeable: Mergeable;
  mergeStateStatus: MergeStateStatus;
  reviewDecision: ReviewDecision;
  isInMergeQueue: boolean;
  autoMergeRequest: { mergeMethod: MergeMethod; enabledBy: { login: string } | null } | null;
  viewerDidAuthor: boolean;
  viewerCanUpdate: boolean;
  viewerCanClose: boolean;
  viewerCanReopen: boolean;
  viewerCanDeleteHeadRef: boolean;
  viewerCanEnableAutoMerge: boolean;
  viewerCanDisableAutoMerge: boolean;
  viewerCanMergeAsAdmin: boolean;
  viewerCanUpdateBranch: boolean;
  viewerLatestReview: { state: ReviewState } | null;
  statusCheckRollup: { state: StatusState } | null;
  labels: { nodes: Label[] } | null;
  assignees: { nodes: Actor[] };
  milestone: { title: string } | null;
  reviewRequests: { nodes: { requestedReviewer: RequestedReviewer | null }[] } | null;
  latestOpinionatedReviews: { nodes: { state: ReviewState; author: Actor | null }[] } | null;
  squashTitle: string;
  squashBody: string;
  mergeTitle: string;
  mergeBody: string;
}

export interface PullResult {
  repository: {
    id: string;
    nameWithOwner: string;
    viewerPermission: Permission;
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
    autoMergeAllowed: boolean;
    deleteBranchOnMerge: boolean;
    viewerDefaultMergeMethod: MergeMethod;
    pullRequest: PullDetail | null;
  } | null;
}

interface EventBase {
  id: string;
  actor: Actor | null;
  createdAt: string;
}

export interface IssueCommentItem {
  __typename: "IssueComment";
  id: string;
  author: Actor | null;
  authorAssociation: string;
  body: string;
  bodyHTML: string;
  createdAt: string;
  url: string;
}

export interface ReviewItem {
  __typename: "PullRequestReview";
  id: string;
  author: Actor | null;
  authorAssociation: string;
  state: ReviewState;
  body: string;
  bodyHTML: string;
  submittedAt: string | null;
  createdAt: string;
  url: string;
  comments: { totalCount: number; nodes: { id: string; replyTo: { id: string } | null }[] };
}

export interface CommitItem {
  __typename: "PullRequestCommit";
  id: string;
  commit: {
    oid: string;
    abbreviatedOid: string;
    messageHeadline: string;
    committedDate: string;
    author: { name: string | null; avatarUrl: string; user: { login: string } | null } | null;
    statusCheckRollup: { state: StatusState } | null;
  };
}

export type ReferencedSubject =
  | { __typename: "Issue"; number: number; title: string; url: string; state: IssueState; repository: { nameWithOwner: string } }
  | { __typename: "PullRequest"; number: number; title: string; url: string; prState: PullState; repository: { nameWithOwner: string } };

export type TimelineEvent =
  | (EventBase & { __typename: "MergedEvent"; mergeRefName: string; mergeCommit: { abbreviatedOid: string } | null })
  | (EventBase & { __typename: "ClosedEvent"; stateReason?: IssueStateReason })
  | (EventBase & { __typename: "ReopenedEvent" })
  | (EventBase & { __typename: "HeadRefForcePushedEvent"; beforeCommit: { abbreviatedOid: string } | null; afterCommit: { abbreviatedOid: string } | null })
  | (EventBase & { __typename: "HeadRefDeletedEvent"; headRefName: string })
  | (EventBase & { __typename: "ReviewRequestedEvent"; requestedReviewer: { __typename: string; login?: string; name?: string } | null })
  | (EventBase & { __typename: "ReviewDismissedEvent"; previousReviewState: ReviewState })
  | (EventBase & { __typename: "ReadyForReviewEvent" })
  | (EventBase & { __typename: "ConvertToDraftEvent" })
  | (EventBase & { __typename: "LabeledEvent"; label: Label })
  | (EventBase & { __typename: "UnlabeledEvent"; label: Label })
  | (EventBase & { __typename: "AssignedEvent"; assignee: { __typename: string; login?: string } | null })
  | (EventBase & { __typename: "RenamedTitleEvent"; previousTitle: string; currentTitle: string })
  | (EventBase & { __typename: "CrossReferencedEvent"; source: ReferencedSubject });

export type TimelineItem = IssueCommentItem | ReviewItem | CommitItem | TimelineEvent;

export interface PullTimelineResult {
  repository: {
    pullRequest: {
      timelineItems: Connection<TimelineItem> & { totalCount: number };
    } | null;
  } | null;
}

export interface ThreadComment {
  id: string;
  databaseId: number | null;
  author: Actor | null;
  authorAssociation: string;
  body: string;
  bodyHTML: string;
  createdAt: string;
  diffHunk: string;
  url: string;
  outdated: boolean;
  pullRequestReview: { id: string } | null;
}

export interface ReviewThread {
  id: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  isResolved: boolean;
  isOutdated: boolean;
  subjectType: "LINE" | "FILE";
  viewerCanReply: boolean;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  resolvedBy: { login: string } | null;
  comments: { totalCount: number; nodes: ThreadComment[] };
}

export interface PullThreadsResult {
  repository: { pullRequest: { reviewThreads: Connection<ReviewThread> } | null } | null;
}

export interface ChangedFileState {
  path: string;
  additions: number;
  deletions: number;
  changeType: PatchStatus;
  viewerViewedState: FileViewedState;
}

export interface PullFilesResult {
  repository: { pullRequest: { files: Connection<ChangedFileState> | null } | null } | null;
}

export interface PullCommitNode {
  id: string;
  commit: {
    oid: string;
    abbreviatedOid: string;
    messageHeadline: string;
    committedDate: string;
    additions: number;
    deletions: number;
    author: { name: string | null; avatarUrl: string; user: { login: string } | null } | null;
    statusCheckRollup: { state: StatusState } | null;
  };
}

export interface PullCommitsResult {
  repository: { pullRequest: { commits: Connection<PullCommitNode> } | null } | null;
}

export type CheckStatus = "REQUESTED" | "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "WAITING" | "PENDING";
export type CheckConclusion =
  | "ACTION_REQUIRED" | "TIMED_OUT" | "CANCELLED" | "FAILURE" | "SUCCESS" | "NEUTRAL" | "SKIPPED" | "STARTUP_FAILURE" | "STALE";

export interface CheckRunNode {
  __typename: "CheckRun";
  id: string;
  name: string;
  status: CheckStatus;
  conclusion: CheckConclusion | null;
  title: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  isRequired: boolean;
  checkSuite: {
    app: { name: string } | null;
    workflowRun: { databaseId: number | null; runNumber: number; workflow: { name: string } } | null;
  };
}

export interface StatusContextNode {
  __typename: "StatusContext";
  id: string;
  context: string;
  state: StatusState;
  description: string | null;
  targetUrl: string | null;
  avatarUrl: string | null;
  createdAt: string;
  isRequired: boolean;
}

export interface PullChecksResult {
  repository: {
    pullRequest: {
      headRefOid: string;
      commits: {
        nodes: {
          commit: {
            oid: string;
            statusCheckRollup: {
              state: StatusState;
              contexts: { totalCount: number; nodes: (CheckRunNode | StatusContextNode)[] };
            } | null;
          };
        }[];
      };
    } | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Issue detail

export type IssueTimelineItem = IssueCommentItem | TimelineEvent;

export interface IssueDetail {
  __typename: "Issue";
  id: string;
  number: number;
  title: string;
  url: string;
  state: IssueState;
  stateReason: IssueStateReason;
  locked: boolean;
  body: string;
  bodyHTML: string;
  createdAt: string;
  author: Actor | null;
  authorAssociation: string;
  viewerCanUpdate: boolean;
  viewerCanClose: boolean;
  viewerCanReopen: boolean;
  labels: { nodes: Label[] } | null;
  assignees: { nodes: Actor[] };
  milestone: { title: string } | null;
  timelineItems: Connection<IssueTimelineItem> & { totalCount: number };
}

export interface IssueResult {
  repository: {
    id: string;
    nameWithOwner: string;
    viewerPermission: Permission;
    issueOrPullRequest: IssueDetail | { __typename: "PullRequest"; number: number } | null;
  } | null;
}

// ---------------------------------------------------------------------------
// REST payloads

export type RestPullFile = components["schemas"]["diff-entry"];
export type RestCommit = components["schemas"]["commit"];
export type RestContentItem = components["schemas"]["content-directory"][number];
export type RestContentFile = components["schemas"]["content-file"];
export type RestNotification = components["schemas"]["thread"];
export type RestUser = components["schemas"]["public-user"];
export type RestCommitListItem = components["schemas"]["commit"];

// ---------------------------------------------------------------------------
// GitHub Actions (REST). Hand-written: Octokit types ids as `number | bigint`.

export interface ActionsActor {
  login: string;
  avatar_url: string;
}

/** `status` is queued, in_progress, completed, waiting, requested or pending. */
export interface WorkflowRun {
  id: number;
  /** The workflow's name. */
  name: string | null;
  display_title: string;
  run_number: number;
  run_attempt?: number;
  event: string;
  status: string | null;
  conclusion: string | null;
  workflow_id: number;
  path: string;
  head_branch: string | null;
  head_sha: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  actor?: ActionsActor;
  triggering_actor?: ActionsActor;
  head_commit: { message: string } | null;
  pull_requests: { number: number }[] | null;
}

export interface WorkflowStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface WorkflowJob {
  id: number;
  run_id: number;
  run_attempt?: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  started_at: string;
  completed_at: string | null;
  html_url: string | null;
  head_sha: string;
  head_branch?: string | null;
  workflow_name?: string | null;
  runner_name: string | null;
  labels: string[];
  steps?: WorkflowStep[];
}

export interface WorkflowJobsPage {
  total_count: number;
  jobs: WorkflowJob[];
}

export interface Workflow {
  id: number;
  name: string;
  path: string;
  state: string;
  html_url: string;
}

export interface WorkflowsPage {
  total_count: number;
  workflows: Workflow[];
}

export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: string | null;
  title: string | null;
  message: string | null;
}

// ---------------------------------------------------------------------------
// Opening pull requests

/** A branch's tip commit, and whether it already has an open pull request. */
export interface BranchTip {
  name: string;
  associatedPullRequests: { totalCount: number };
  target: {
    oid?: string;
    committedDate?: string;
    messageHeadline?: string;
    author?: { user: { login: string } | null } | null;
  } | null;
}

export interface BranchesRepo {
  nameWithOwner: string;
  defaultBranchRef: { name: string } | null;
  parent: { nameWithOwner: string; defaultBranchRef: { name: string } | null } | null;
  refs: { nodes: BranchTip[] } | null;
}

export interface RecentBranchesResult {
  viewer: { repositories: { nodes: BranchesRepo[] } };
}

export interface RepoRecentBranchesResult {
  repository: BranchesRepo | null;
}

/** A branch for the branch picker (fragment BranchName). */
export interface BranchNameNode {
  name: string;
  target: { committedDate?: string } | null;
}

export interface RepoBranchesResult {
  repository: {
    defaultBranchRef: { name: string } | null;
    refs: (Connection<BranchNameNode> & { totalCount: number }) | null;
  } | null;
}

export interface SearchBranchesResult {
  repository: { refs: { nodes: BranchNameNode[] } | null } | null;
}

export interface NewPullResult {
  repository: {
    id: string;
    nameWithOwner: string;
    defaultBranchRef: { name: string } | null;
    parent: { nameWithOwner: string } | null;
    pullRequestTemplates: { filename: string; body: string | null }[] | null;
    forks: { nodes: { nameWithOwner: string }[] };
  } | null;
}

export interface AssignableUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface AssignableUsersResult {
  repository: { assignableUsers: { nodes: AssignableUser[] } } | null;
}

export type RestComparison = components["schemas"]["commit-comparison"];
export type RestPullSimple = components["schemas"]["pull-request-simple"];

// ---------------------------------------------------------------------------
// Releases

export type Release = components["schemas"]["release"];
export type ReleaseAsset = components["schemas"]["release-asset"];
