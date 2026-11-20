// Schemas for the GraphQL results in queries.ts and the REST payloads we use.
// Every response is parsed with one of these before the app reads it; the
// TypeScript types are inferred from the schemas, so the two can't drift.
//
// GraphQL schemas are checked against GitHub's published schema and the
// documents that select them (schemaCheck.test.ts). REST schemas are checked
// against GitHub's OpenAPI types (restSchemas.check.ts).

import { z } from "zod";
import { byTypename, nodes } from "./schema";

export const Actor = z.object({ login: z.string(), avatarUrl: z.string() });
export type Actor = z.infer<typeof Actor>;

export const Label = z.object({ name: z.string(), color: z.string() });
export type Label = z.infer<typeof Label>;

export const PageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
export type PageInfo = z.infer<typeof PageInfo>;

const TotalCount = z.object({ totalCount: z.number() });
const Labels = z.object({ nodes: nodes(Label) }).nullable();
const RepoName = z.object({ nameWithOwner: z.string() });
const BranchRef = z.object({ name: z.string() });

export const StatusState = z.enum(["EXPECTED", "ERROR", "FAILURE", "PENDING", "SUCCESS"]);
export type StatusState = z.infer<typeof StatusState>;
export const PullState = z.enum(["OPEN", "CLOSED", "MERGED"]);
export type PullState = z.infer<typeof PullState>;
export const IssueState = z.enum(["OPEN", "CLOSED"]);
export type IssueState = z.infer<typeof IssueState>;
export const IssueStateReason = z.enum(["COMPLETED", "NOT_PLANNED", "REOPENED", "DUPLICATE"]).nullable();
export type IssueStateReason = z.infer<typeof IssueStateReason>;
export const ReviewDecision = z.enum(["CHANGES_REQUESTED", "APPROVED", "REVIEW_REQUIRED"]).nullable();
export type ReviewDecision = z.infer<typeof ReviewDecision>;
export const ReviewState = z.enum(["PENDING", "COMMENTED", "APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);
export type ReviewState = z.infer<typeof ReviewState>;
export const MergeMethod = z.enum(["MERGE", "SQUASH", "REBASE"]);
export type MergeMethod = z.infer<typeof MergeMethod>;
/** How the base branch is brought into a pull request's branch. */
export const UpdateBranchMethod = z.enum(["MERGE", "REBASE"]);
export type UpdateBranchMethod = z.infer<typeof UpdateBranchMethod>;
export const Permission = z.enum(["ADMIN", "MAINTAIN", "WRITE", "TRIAGE", "READ"]).nullable();
export type Permission = z.infer<typeof Permission>;
export const MergeStateStatus = z.enum(["DIRTY", "UNKNOWN", "BLOCKED", "BEHIND", "DRAFT", "UNSTABLE", "HAS_HOOKS", "CLEAN"]);
export type MergeStateStatus = z.infer<typeof MergeStateStatus>;
export const Mergeable = z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]);
export type Mergeable = z.infer<typeof Mergeable>;
export const FileViewedState = z.enum(["DISMISSED", "VIEWED", "UNVIEWED"]);
export type FileViewedState = z.infer<typeof FileViewedState>;
export const PatchStatus = z.enum(["ADDED", "DELETED", "RENAMED", "COPIED", "MODIFIED", "CHANGED"]);
export type PatchStatus = z.infer<typeof PatchStatus>;

const StatusRollup = z.object({ state: StatusState }).nullable();

export const PullListItem = z.object({
  __typename: z.literal("PullRequest"),
  id: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: PullState,
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  additions: z.number(),
  deletions: z.number(),
  totalCommentsCount: z.number().nullable(),
  reviewDecision: ReviewDecision,
  author: Actor.nullable(),
  repository: RepoName,
  labels: Labels,
  commits: z.object({ nodes: nodes(z.object({ commit: z.object({ statusCheckRollup: StatusRollup }) })) }),
});
export type PullListItem = z.infer<typeof PullListItem>;

export const IssueListItem = z.object({
  __typename: z.literal("Issue"),
  id: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  issueState: IssueState,
  stateReason: IssueStateReason,
  createdAt: z.string(),
  updatedAt: z.string(),
  author: Actor.nullable(),
  repository: RepoName,
  comments: TotalCount,
  labels: Labels,
});
export type IssueListItem = z.infer<typeof IssueListItem>;

export const SearchIssueNode = byTypename([PullListItem, IssueListItem]);
export type SearchIssueNode = z.infer<typeof SearchIssueNode>;

export const SearchIssuesResult = z.object({
  search: z.object({ issueCount: z.number(), pageInfo: PageInfo, nodes: nodes(SearchIssueNode) }),
});
export type SearchIssuesResult = z.infer<typeof SearchIssuesResult>;

const IssueCount = z.object({ issueCount: z.number() });
export const SearchCountsResult = z.object({ c0: IssueCount, c1: IssueCount, c2: IssueCount, c3: IssueCount, c4: IssueCount });
export type SearchCountsResult = z.infer<typeof SearchCountsResult>;

const Language = z.object({ name: z.string(), color: z.string().nullable() }).nullable();

export const RepoListItem = z.object({
  id: z.string(),
  name: z.string(),
  nameWithOwner: z.string(),
  description: z.string().nullable(),
  isPrivate: z.boolean(),
  isFork: z.boolean(),
  isArchived: z.boolean(),
  stargazerCount: z.number(),
  pushedAt: z.string().nullable(),
  owner: Actor,
  primaryLanguage: Language,
});
export type RepoListItem = z.infer<typeof RepoListItem>;

export const SearchReposResult = z.object({
  search: z.object({
    repositoryCount: z.number(),
    pageInfo: PageInfo,
    nodes: nodes(byTypename([RepoListItem.extend({ __typename: z.literal("Repository") })])),
  }),
});
export type SearchReposResult = z.infer<typeof SearchReposResult>;

export const UserListItem = z.object({
  __typename: z.enum(["User", "Organization"]),
  id: z.string(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  bio: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type UserListItem = z.infer<typeof UserListItem>;

export const SearchUsersResult = z.object({
  search: z.object({ userCount: z.number(), pageInfo: PageInfo, nodes: nodes(byTypename([UserListItem])) }),
});
export type SearchUsersResult = z.infer<typeof SearchUsersResult>;

const RepoConnection = z.object({ totalCount: z.number(), pageInfo: PageInfo, nodes: nodes(RepoListItem) });

export const ViewerReposResult = z.object({ viewer: z.object({ repositories: RepoConnection }) });
export type ViewerReposResult = z.infer<typeof ViewerReposResult>;

export const ViewerStarredResult = z.object({ viewer: z.object({ starredRepositories: RepoConnection }) });
export type ViewerStarredResult = z.infer<typeof ViewerStarredResult>;

export const RateLimit = z.object({ limit: z.number(), remaining: z.number(), resetAt: z.string() }).nullable();
export type RateLimit = z.infer<typeof RateLimit>;

export const RateLimitResult = z.object({ rateLimit: RateLimit });
export type RateLimitResult = z.infer<typeof RateLimitResult>;

export const ViewerResult = z.object({
  viewer: z.object({
    login: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string(),
    bio: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    url: z.string(),
    followers: TotalCount,
    following: TotalCount,
    repositories: TotalCount,
    starredRepositories: TotalCount,
    organizations: z.object({ nodes: nodes(z.object({ login: z.string(), name: z.string().nullable(), avatarUrl: z.string() })) }),
  }),
  rateLimit: RateLimit,
});
export type ViewerResult = z.infer<typeof ViewerResult>;

/** An organization the viewer belongs to, as the organizations page lists it. */
export const ViewerOrg = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  description: z.string().nullable(),
  repositories: z.object({ totalCount: z.number() }),
});
export type ViewerOrg = z.infer<typeof ViewerOrg>;

export const ViewerOrgsResult = z.object({
  viewer: z.object({ organizations: z.object({ totalCount: z.number(), pageInfo: PageInfo, nodes: nodes(ViewerOrg) }) }),
});
export type ViewerOrgsResult = z.infer<typeof ViewerOrgsResult>;

export const OwnerResult = z.object({
  repositoryOwner: z
    .object({
      __typename: z.enum(["User", "Organization"]),
      login: z.string(),
      avatarUrl: z.string(),
      url: z.string(),
      name: z.string().nullable().optional(),
      bio: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      company: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      followers: TotalCount.optional(),
      following: TotalCount.optional(),
      repositories: RepoConnection,
    })
    .nullable(),
});
export type OwnerResult = z.infer<typeof OwnerResult>;

export const RepoDetail = z.object({
  id: z.string(),
  name: z.string(),
  nameWithOwner: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  homepageUrl: z.string().nullable(),
  isPrivate: z.boolean(),
  isFork: z.boolean(),
  isArchived: z.boolean(),
  stargazerCount: z.number(),
  forkCount: z.number(),
  viewerHasStarred: z.boolean(),
  viewerPermission: Permission,
  hasIssuesEnabled: z.boolean(),
  owner: Actor,
  defaultBranchRef: BranchRef.nullable(),
  primaryLanguage: Language,
  licenseInfo: z.object({ spdxId: z.string().nullable(), name: z.string() }).nullable(),
  parent: RepoName.nullable(),
  latestRelease: z
    .object({ name: z.string().nullable(), tagName: z.string(), publishedAt: z.string().nullable(), isPrerelease: z.boolean() })
    .nullable(),
  releases: TotalCount,
  watchers: TotalCount,
  pullRequests: TotalCount,
  issues: TotalCount,
  repositoryTopics: z.object({ nodes: nodes(z.object({ topic: z.object({ name: z.string() }) })) }),
});
export type RepoDetail = z.infer<typeof RepoDetail>;

export const RepoResult = z.object({ repository: RepoDetail.nullable() });
export type RepoResult = z.infer<typeof RepoResult>;

// ---------------------------------------------------------------------------
// Pull request detail

export const RequestedReviewer = byTypename([
  z.object({ __typename: z.enum(["User", "Bot", "Mannequin"]), login: z.string(), avatarUrl: z.string() }),
  z.object({ __typename: z.literal("Team"), name: z.string(), slug: z.string() }),
]);
export type RequestedReviewer = z.infer<typeof RequestedReviewer>;

export const PullDetail = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: PullState,
  isDraft: z.boolean(),
  merged: z.boolean(),
  closed: z.boolean(),
  locked: z.boolean(),
  body: z.string(),
  bodyHTML: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  mergedAt: z.string().nullable(),
  mergedBy: Actor.nullable(),
  author: Actor.nullable(),
  authorAssociation: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  headRefOid: z.string(),
  isCrossRepository: z.boolean(),
  headRepository: RepoName.nullable(),
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  commits: TotalCount,
  mergeable: Mergeable,
  mergeStateStatus: MergeStateStatus,
  reviewDecision: ReviewDecision,
  isInMergeQueue: z.boolean(),
  autoMergeRequest: z.object({ mergeMethod: MergeMethod, enabledBy: z.object({ login: z.string() }).nullable() }).nullable(),
  viewerDidAuthor: z.boolean(),
  viewerCanUpdate: z.boolean(),
  viewerCanClose: z.boolean(),
  viewerCanReopen: z.boolean(),
  viewerCanDeleteHeadRef: z.boolean(),
  viewerCanEnableAutoMerge: z.boolean(),
  viewerCanDisableAutoMerge: z.boolean(),
  viewerCanMergeAsAdmin: z.boolean(),
  viewerCanUpdateBranch: z.boolean(),
  viewerLatestReview: z.object({ state: ReviewState }).nullable(),
  statusCheckRollup: StatusRollup,
  labels: Labels,
  assignees: z.object({ nodes: nodes(Actor) }),
  milestone: z.object({ title: z.string() }).nullable(),
  reviewRequests: z.object({ nodes: nodes(z.object({ requestedReviewer: RequestedReviewer.nullable() })) }).nullable(),
  latestOpinionatedReviews: z.object({ nodes: nodes(z.object({ state: ReviewState, author: Actor.nullable() })) }).nullable(),
  squashTitle: z.string(),
  squashBody: z.string(),
  mergeTitle: z.string(),
  mergeBody: z.string(),
});
export type PullDetail = z.infer<typeof PullDetail>;

export const PullResult = z.object({
  repository: z
    .object({
      id: z.string(),
      nameWithOwner: z.string(),
      viewerPermission: Permission,
      mergeCommitAllowed: z.boolean(),
      squashMergeAllowed: z.boolean(),
      rebaseMergeAllowed: z.boolean(),
      autoMergeAllowed: z.boolean(),
      deleteBranchOnMerge: z.boolean(),
      viewerDefaultMergeMethod: MergeMethod,
      pullRequest: PullDetail.nullable(),
    })
    .nullable(),
});
export type PullResult = z.infer<typeof PullResult>;

const EventBase = z.object({ id: z.string(), actor: Actor.nullable(), createdAt: z.string() });

export const IssueCommentItem = z.object({
  __typename: z.literal("IssueComment"),
  id: z.string(),
  author: Actor.nullable(),
  authorAssociation: z.string(),
  body: z.string(),
  bodyHTML: z.string(),
  createdAt: z.string(),
  url: z.string(),
});
export type IssueCommentItem = z.infer<typeof IssueCommentItem>;

export const ReviewItem = z.object({
  __typename: z.literal("PullRequestReview"),
  id: z.string(),
  author: Actor.nullable(),
  authorAssociation: z.string(),
  state: ReviewState,
  body: z.string(),
  bodyHTML: z.string(),
  submittedAt: z.string().nullable(),
  createdAt: z.string(),
  url: z.string(),
  comments: z.object({
    totalCount: z.number(),
    nodes: nodes(z.object({ id: z.string(), replyTo: z.object({ id: z.string() }).nullable() })),
  }),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

const CommitAuthor = z
  .object({ name: z.string().nullable(), avatarUrl: z.string(), user: z.object({ login: z.string() }).nullable() })
  .nullable();

export const CommitItem = z.object({
  __typename: z.literal("PullRequestCommit"),
  id: z.string(),
  commit: z.object({
    oid: z.string(),
    abbreviatedOid: z.string(),
    messageHeadline: z.string(),
    committedDate: z.string(),
    author: CommitAuthor,
    statusCheckRollup: StatusRollup,
  }),
});
export type CommitItem = z.infer<typeof CommitItem>;

export const ReferencedSubject = byTypename([
  z.object({ __typename: z.literal("Issue"), number: z.number(), title: z.string(), url: z.string(), state: IssueState, repository: RepoName }),
  z.object({ __typename: z.literal("PullRequest"), number: z.number(), title: z.string(), url: z.string(), prState: PullState, repository: RepoName }),
]);
export type ReferencedSubject = z.infer<typeof ReferencedSubject>;

const ShortCommit = z.object({ abbreviatedOid: z.string() }).nullable();
const NamedActor = z.object({ __typename: z.string(), login: z.string().optional(), name: z.string().optional() }).nullable();

const TIMELINE_EVENTS = [
  EventBase.extend({ __typename: z.literal("MergedEvent"), mergeRefName: z.string(), mergeCommit: ShortCommit }),
  EventBase.extend({ __typename: z.literal("ClosedEvent"), stateReason: IssueStateReason.optional() }),
  EventBase.extend({ __typename: z.literal("ReopenedEvent") }),
  EventBase.extend({ __typename: z.literal("HeadRefForcePushedEvent"), beforeCommit: ShortCommit, afterCommit: ShortCommit }),
  EventBase.extend({ __typename: z.literal("HeadRefDeletedEvent"), headRefName: z.string() }),
  EventBase.extend({ __typename: z.literal("ReviewRequestedEvent"), requestedReviewer: NamedActor }),
  EventBase.extend({ __typename: z.literal("ReviewDismissedEvent"), previousReviewState: ReviewState }),
  EventBase.extend({ __typename: z.literal("ReadyForReviewEvent") }),
  EventBase.extend({ __typename: z.literal("ConvertToDraftEvent") }),
  EventBase.extend({ __typename: z.literal("LabeledEvent"), label: Label }),
  EventBase.extend({ __typename: z.literal("UnlabeledEvent"), label: Label }),
  EventBase.extend({ __typename: z.literal("AssignedEvent"), assignee: NamedActor }),
  EventBase.extend({ __typename: z.literal("RenamedTitleEvent"), previousTitle: z.string(), currentTitle: z.string() }),
  EventBase.extend({ __typename: z.literal("CrossReferencedEvent"), source: ReferencedSubject }),
] as const;

export const TimelineEvent = z.discriminatedUnion("__typename", TIMELINE_EVENTS);
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const TimelineItem = byTypename([IssueCommentItem, ReviewItem, CommitItem, ...TIMELINE_EVENTS]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export const PullTimelineResult = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({ timelineItems: z.object({ totalCount: z.number(), pageInfo: PageInfo, nodes: nodes(TimelineItem) }) })
        .nullable(),
    })
    .nullable(),
});
export type PullTimelineResult = z.infer<typeof PullTimelineResult>;

export const ThreadComment = z.object({
  id: z.string(),
  databaseId: z.number().nullable(),
  author: Actor.nullable(),
  authorAssociation: z.string(),
  body: z.string(),
  bodyHTML: z.string(),
  createdAt: z.string(),
  diffHunk: z.string(),
  url: z.string(),
  outdated: z.boolean(),
  pullRequestReview: z.object({ id: z.string() }).nullable(),
});
export type ThreadComment = z.infer<typeof ThreadComment>;

export const DiffSide = z.enum(["LEFT", "RIGHT"]);
export type DiffSide = z.infer<typeof DiffSide>;

export const ReviewThread = z.object({
  id: z.string(),
  path: z.string(),
  line: z.number().nullable(),
  originalLine: z.number().nullable(),
  startLine: z.number().nullable(),
  diffSide: DiffSide,
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  subjectType: z.enum(["LINE", "FILE"]),
  viewerCanReply: z.boolean(),
  viewerCanResolve: z.boolean(),
  viewerCanUnresolve: z.boolean(),
  resolvedBy: z.object({ login: z.string() }).nullable(),
  comments: z.object({ totalCount: z.number(), nodes: nodes(ThreadComment) }),
});
export type ReviewThread = z.infer<typeof ReviewThread>;

export const PullThreadsResult = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({ reviewThreads: z.object({ totalCount: z.number(), pageInfo: PageInfo, nodes: nodes(ReviewThread) }) })
        .nullable(),
    })
    .nullable(),
});
export type PullThreadsResult = z.infer<typeof PullThreadsResult>;

export const ChangedFileState = z.object({
  path: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changeType: PatchStatus,
  viewerViewedState: FileViewedState,
});
export type ChangedFileState = z.infer<typeof ChangedFileState>;

export const PullFilesResult = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({ files: z.object({ totalCount: z.number(), pageInfo: PageInfo, nodes: nodes(ChangedFileState) }).nullable() })
        .nullable(),
    })
    .nullable(),
});
export type PullFilesResult = z.infer<typeof PullFilesResult>;

export const PullCommitNode = z.object({
  id: z.string(),
  commit: z.object({
    oid: z.string(),
    abbreviatedOid: z.string(),
    messageHeadline: z.string(),
    committedDate: z.string(),
    additions: z.number(),
    deletions: z.number(),
    author: CommitAuthor,
    statusCheckRollup: StatusRollup,
  }),
});
export type PullCommitNode = z.infer<typeof PullCommitNode>;

export const PullCommitsResult = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({ commits: z.object({ totalCount: z.number(), pageInfo: PageInfo, nodes: nodes(PullCommitNode) }) })
        .nullable(),
    })
    .nullable(),
});
export type PullCommitsResult = z.infer<typeof PullCommitsResult>;

export const CheckStatus = z.enum(["REQUESTED", "QUEUED", "IN_PROGRESS", "COMPLETED", "WAITING", "PENDING"]);
export type CheckStatus = z.infer<typeof CheckStatus>;
export const CheckConclusion = z.enum([
  "ACTION_REQUIRED",
  "TIMED_OUT",
  "CANCELLED",
  "FAILURE",
  "SUCCESS",
  "NEUTRAL",
  "SKIPPED",
  "STARTUP_FAILURE",
  "STALE",
]);
export type CheckConclusion = z.infer<typeof CheckConclusion>;

export const CheckRunNode = z.object({
  __typename: z.literal("CheckRun"),
  id: z.string(),
  name: z.string(),
  status: CheckStatus,
  conclusion: CheckConclusion.nullable(),
  title: z.string().nullable(),
  detailsUrl: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  isRequired: z.boolean(),
  checkSuite: z.object({
    app: z.object({ name: z.string() }).nullable(),
    workflowRun: z
      .object({ databaseId: z.number().nullable(), runNumber: z.number(), workflow: z.object({ name: z.string() }) })
      .nullable(),
  }),
});
export type CheckRunNode = z.infer<typeof CheckRunNode>;

export const StatusContextNode = z.object({
  __typename: z.literal("StatusContext"),
  id: z.string(),
  context: z.string(),
  state: StatusState,
  description: z.string().nullable(),
  targetUrl: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string(),
  isRequired: z.boolean(),
});
export type StatusContextNode = z.infer<typeof StatusContextNode>;

export const CheckContext = byTypename([CheckRunNode, StatusContextNode]);
export type CheckContext = z.infer<typeof CheckContext>;

export const PullChecksResult = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({
          headRefOid: z.string(),
          commits: z.object({
            nodes: nodes(
              z.object({
                commit: z.object({
                  oid: z.string(),
                  statusCheckRollup: z
                    .object({ state: StatusState, contexts: z.object({ totalCount: z.number(), nodes: nodes(CheckContext) }) })
                    .nullable(),
                }),
              }),
            ),
          }),
        })
        .nullable(),
    })
    .nullable(),
});
export type PullChecksResult = z.infer<typeof PullChecksResult>;

// ---------------------------------------------------------------------------
// Issue detail

const ISSUE_TIMELINE_EVENTS = [
  IssueCommentItem,
  EventBase.extend({ __typename: z.literal("ClosedEvent"), stateReason: IssueStateReason.optional() }),
  EventBase.extend({ __typename: z.literal("ReopenedEvent") }),
  EventBase.extend({ __typename: z.literal("LabeledEvent"), label: Label }),
  EventBase.extend({ __typename: z.literal("UnlabeledEvent"), label: Label }),
  EventBase.extend({ __typename: z.literal("AssignedEvent"), assignee: NamedActor }),
  EventBase.extend({ __typename: z.literal("RenamedTitleEvent"), previousTitle: z.string(), currentTitle: z.string() }),
  EventBase.extend({ __typename: z.literal("CrossReferencedEvent"), source: ReferencedSubject }),
] as const;

export const IssueTimelineItem = byTypename(ISSUE_TIMELINE_EVENTS);
export type IssueTimelineItem = z.infer<typeof IssueTimelineItem>;

export const IssueDetail = z.object({
  __typename: z.literal("Issue"),
  id: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: IssueState,
  stateReason: IssueStateReason,
  locked: z.boolean(),
  body: z.string(),
  bodyHTML: z.string(),
  createdAt: z.string(),
  author: Actor.nullable(),
  authorAssociation: z.string(),
  viewerCanUpdate: z.boolean(),
  viewerCanClose: z.boolean(),
  viewerCanReopen: z.boolean(),
  labels: Labels,
  assignees: z.object({ nodes: nodes(Actor) }),
  milestone: z.object({ title: z.string() }).nullable(),
  timelineItems: z.object({ totalCount: z.number(), pageInfo: PageInfo, nodes: nodes(IssueTimelineItem) }),
});
export type IssueDetail = z.infer<typeof IssueDetail>;

export const IssueResult = z.object({
  repository: z
    .object({
      id: z.string(),
      nameWithOwner: z.string(),
      viewerPermission: Permission,
      issueOrPullRequest: byTypename([IssueDetail, z.object({ __typename: z.literal("PullRequest"), number: z.number() })]).nullable(),
    })
    .nullable(),
});
export type IssueResult = z.infer<typeof IssueResult>;

// ---------------------------------------------------------------------------
// Mutations: only what the app reads back.

export const AddCommentResult = z.object({
  addComment: z.object({ commentEdge: z.object({ node: z.object({ id: z.string() }).nullable() }).nullable() }).nullable(),
});
export const ReplyToThreadResult = z.object({
  addPullRequestReviewThreadReply: z.object({ comment: z.object({ id: z.string() }).nullable() }).nullable(),
});
const ThreadState = z.object({ thread: z.object({ id: z.string(), isResolved: z.boolean() }).nullable() }).nullable();
export const ResolveThreadResult = z.object({ resolveReviewThread: ThreadState });
export const UnresolveThreadResult = z.object({ unresolveReviewThread: ThreadState });
export const UpdatePullBranchResult = z.object({
  updatePullRequestBranch: z.object({ pullRequest: z.object({ id: z.string(), headRefOid: z.string() }).nullable() }).nullable(),
});
/** For mutations whose result the app doesn't read: only that GitHub answered. */
export const Acknowledged = z.object({});

// ---------------------------------------------------------------------------
// Opening pull requests

/** A branch's tip commit, and whether it already has an open pull request. */
export const BranchTip = z.object({
  name: z.string(),
  associatedPullRequests: TotalCount,
  target: z
    .object({
      oid: z.string().optional(),
      committedDate: z.string().optional(),
      messageHeadline: z.string().optional(),
      author: z.object({ user: z.object({ login: z.string() }).nullable() }).nullable().optional(),
    })
    .nullable(),
});
export type BranchTip = z.infer<typeof BranchTip>;

export const BranchesRepo = z.object({
  nameWithOwner: z.string(),
  defaultBranchRef: BranchRef.nullable(),
  parent: z.object({ nameWithOwner: z.string(), defaultBranchRef: BranchRef.nullable() }).nullable(),
  refs: z.object({ nodes: nodes(BranchTip) }).nullable(),
});
export type BranchesRepo = z.infer<typeof BranchesRepo>;

export const RecentBranchesResult = z.object({ viewer: z.object({ repositories: z.object({ nodes: nodes(BranchesRepo) }) }) });
export type RecentBranchesResult = z.infer<typeof RecentBranchesResult>;

export const RepoRecentBranchesResult = z.object({ repository: BranchesRepo.nullable() });
export type RepoRecentBranchesResult = z.infer<typeof RepoRecentBranchesResult>;

/** A branch for the branch picker (fragment BranchName). */
export const BranchNameNode = z.object({
  name: z.string(),
  target: z.object({ committedDate: z.string().optional() }).nullable(),
});
export type BranchNameNode = z.infer<typeof BranchNameNode>;

export const RepoBranchesResult = z.object({
  repository: z
    .object({
      defaultBranchRef: BranchRef.nullable(),
      refs: z.object({ totalCount: z.number(), pageInfo: PageInfo, nodes: nodes(BranchNameNode) }).nullable(),
    })
    .nullable(),
});
export type RepoBranchesResult = z.infer<typeof RepoBranchesResult>;

/** A blob has text; a folder (or nothing) at that path doesn't. */
export const ReviewRulesResult = z.object({
  repository: z
    .object({ object: z.object({ text: z.string().nullable().optional(), isTruncated: z.boolean().optional() }).nullable() })
    .nullable(),
});
export type ReviewRulesResult = z.infer<typeof ReviewRulesResult>;

// The spec folder (src/lib/spec.ts). Its files are listed over REST; this is
// the folder's own tree (a file called .spec has no tree oid), and the
// contents of a batch of its files.
export const SpecRootResult = z.object({ repository: z.object({ object: z.object({ oid: z.string().optional() }).nullable() }).nullable() });
export type SpecRootResult = z.infer<typeof SpecRootResult>;

/** How many files one SpecBlobs request reads. */
export const SPEC_BLOB_BATCH = 40;
const SpecBlob = z.object({ oid: z.string().optional(), text: z.string().nullable().optional(), isTruncated: z.boolean().optional() }).nullable();
export const SpecBlobsResult = z.object({
  repository: z.object(Object.fromEntries(Array.from({ length: SPEC_BLOB_BATCH }, (_, i) => [`b${i}`, SpecBlob]))).nullable(),
});
export type SpecBlobsResult = z.infer<typeof SpecBlobsResult>;

export const SearchBranchesResult = z.object({
  repository: z.object({ refs: z.object({ nodes: nodes(BranchNameNode) }).nullable() }).nullable(),
});
export type SearchBranchesResult = z.infer<typeof SearchBranchesResult>;

export const NewPullResult = z.object({
  repository: z
    .object({
      id: z.string(),
      nameWithOwner: z.string(),
      defaultBranchRef: BranchRef.nullable(),
      parent: RepoName.nullable(),
      pullRequestTemplates: z.array(z.object({ filename: z.string().nullable(), body: z.string().nullable() })).nullable(),
      forks: z.object({ nodes: nodes(RepoName) }),
    })
    .nullable(),
});
export type NewPullResult = z.infer<typeof NewPullResult>;

export const AssignableUser = z.object({ login: z.string(), name: z.string().nullable(), avatarUrl: z.string() });
export type AssignableUser = z.infer<typeof AssignableUser>;

export const AssignableUsersResult = z.object({
  repository: z.object({ assignableUsers: z.object({ nodes: nodes(AssignableUser) }) }).nullable(),
});
export type AssignableUsersResult = z.infer<typeof AssignableUsersResult>;

// ---------------------------------------------------------------------------
// GitHub Actions (REST)

export const ActionsActor = z.object({ login: z.string(), avatar_url: z.string() });
export type ActionsActor = z.infer<typeof ActionsActor>;

/** `status` is queued, in_progress, completed, waiting, requested or pending. */
export const WorkflowRun = z.object({
  id: z.number(),
  /** The workflow's name. */
  name: z.string().nullable().optional(),
  display_title: z.string(),
  run_number: z.number(),
  run_attempt: z.number().optional(),
  event: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  workflow_id: z.number(),
  path: z.string(),
  head_branch: z.string().nullable(),
  head_sha: z.string(),
  html_url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  run_started_at: z.string().optional(),
  actor: ActionsActor.optional(),
  triggering_actor: ActionsActor.optional(),
  head_commit: z.object({ message: z.string() }).nullable(),
  pull_requests: z.array(z.object({ number: z.number() })).nullable(),
});
export type WorkflowRun = z.infer<typeof WorkflowRun>;

export const WorkflowRunsPage = z.object({ total_count: z.number(), workflow_runs: z.array(WorkflowRun) });

export const WorkflowStep = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  number: z.number(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const WorkflowJob = z.object({
  id: z.number(),
  run_id: z.number(),
  run_attempt: z.number().optional(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  html_url: z.string().nullable(),
  head_sha: z.string(),
  head_branch: z.string().nullable().optional(),
  workflow_name: z.string().nullable().optional(),
  runner_name: z.string().nullable(),
  labels: z.array(z.string()),
  steps: z.array(WorkflowStep).optional(),
});
export type WorkflowJob = z.infer<typeof WorkflowJob>;

export const WorkflowJobsPage = z.object({ total_count: z.number(), jobs: z.array(WorkflowJob) });
export type WorkflowJobsPage = z.infer<typeof WorkflowJobsPage>;

export const Workflow = z.object({ id: z.number(), name: z.string(), path: z.string(), state: z.string(), html_url: z.string() });
export type Workflow = z.infer<typeof Workflow>;

export const WorkflowsPage = z.object({ total_count: z.number(), workflows: z.array(Workflow) });
export type WorkflowsPage = z.infer<typeof WorkflowsPage>;

export const CheckAnnotation = z.object({
  path: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  annotation_level: z.string().nullable(),
  title: z.string().nullable(),
  message: z.string().nullable(),
});
export type CheckAnnotation = z.infer<typeof CheckAnnotation>;
