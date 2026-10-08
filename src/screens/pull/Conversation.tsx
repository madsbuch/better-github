import {
  AlertIcon,
  CheckCircleFillIcon,
  CheckIcon,
  CommentIcon,
  DotFillIcon,
  EyeIcon,
  FileDiffIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { graphql } from "../../lib/api";
import { PULL_TIMELINE } from "../../lib/queries";
import { Link } from "../../lib/router";
import { paths } from "../../lib/routes";
import type { PullDetail, PullResult, PullTimelineResult, ReviewItem, ReviewState, ReviewThread } from "../../lib/types";
import { Markdown } from "../../components/Markdown";
import { CommentCard, CommitRow, EventRow, IssueCommentCard, ThreadCard, reviewVerb, type ThreadActions } from "../../components/Timeline";
import { Avatar, Labels, LoadMore, Spinner, StateBadge, Time, pullVisualState } from "../../components/ui";
import { pullKey } from "./data";

type RepoInfo = NonNullable<PullResult["repository"]>;

export function canMerge(repo: RepoInfo, pr: PullDetail): boolean {
  return pr.state === "OPEN" && !pr.isDraft && ["ADMIN", "MAINTAIN", "WRITE"].includes(repo.viewerPermission ?? "");
}

export function Conversation({
  owner,
  repo,
  number,
  pr,
  threads,
  threadActions,
  viewerLogin,
  onQuote,
  onShowChecks,
  onReadyForReview,
  onUpdateBranch,
  onDisableAutoMerge,
}: {
  owner: string;
  repo: string;
  number: number;
  pr: PullDetail;
  threads: ReviewThread[];
  threadActions: ThreadActions;
  viewerLogin: string;
  onQuote: (text: string) => void;
  onShowChecks: () => void;
  onReadyForReview: () => void;
  onUpdateBranch: () => void;
  onDisableAutoMerge: () => void;
}) {
  const timeline = useInfiniteQuery({
    queryKey: [...pullKey(owner, repo, number), "timeline"],
    queryFn: ({ pageParam }) => graphql<PullTimelineResult>(PULL_TIMELINE, { owner, name: repo, number, after: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => {
      const items = last.repository?.pullRequest?.timelineItems;
      return items?.pageInfo.hasNextPage ? items.pageInfo.endCursor : undefined;
    },
  });
  const items = timeline.data?.pages.flatMap((p) => p.repository?.pullRequest?.timelineItems.nodes ?? []) ?? [];

  // Threads hang off the review that started them.
  const threadsByReview = new Map<string, ReviewThread[]>();
  for (const thread of threads) {
    const reviewId = thread.comments.nodes[0]?.pullRequestReview?.id;
    if (!reviewId) continue;
    const list = threadsByReview.get(reviewId) ?? [];
    list.push(thread);
    threadsByReview.set(reviewId, list);
  }

  return (
    <div className="timeline">
      <PullHeader pr={pr} />
      <CommentCard
        author={pr.author}
        association={pr.authorAssociation}
        createdAt={pr.createdAt}
        bodyHTML={pr.bodyHTML}
        body={pr.body}
        url={pr.url}
        highlight={pr.author?.login === viewerLogin}
        onQuote={onQuote}
      />
      {timeline.isPending ? (
        <div className="center">
          <Spinner />
        </div>
      ) : (
        items.map((item) => {
          switch (item.__typename) {
            case "IssueComment":
              return <IssueCommentCard key={item.id} item={item} viewerLogin={viewerLogin} onQuote={onQuote} />;
            case "PullRequestReview":
              return (
                <ReviewBlock
                  key={item.id}
                  review={item}
                  threads={threadsByReview.get(item.id) ?? []}
                  threadActions={threadActions}
                  viewerLogin={viewerLogin}
                />
              );
            case "PullRequestCommit":
              return <CommitRow key={item.id} item={item} owner={owner} repo={repo} />;
            default:
              return <EventRow key={item.id} event={item} owner={owner} repo={repo} isPull />;
          }
        })
      )}
      <LoadMore hasMore={timeline.hasNextPage} loading={timeline.isFetchingNextPage} onLoadMore={() => void timeline.fetchNextPage()} />
      {pr.state === "OPEN" && (
        <MergeBox
          pr={pr}
          onShowChecks={onShowChecks}
          onReadyForReview={onReadyForReview}
          onUpdateBranch={onUpdateBranch}
          onDisableAutoMerge={onDisableAutoMerge}
        />
      )}
      {pr.locked && <div className="banner">This conversation is locked.</div>}
    </div>
  );
}

function reviewIcon(state: ReviewState | "REQUESTED") {
  switch (state) {
    case "APPROVED":
      return <CheckIcon size={14} className="c-success" aria-label="Approved" />;
    case "CHANGES_REQUESTED":
      return <FileDiffIcon size={14} className="c-danger" aria-label="Changes requested" />;
    case "REQUESTED":
      return <DotFillIcon size={14} className="c-attention" aria-label="Review requested" />;
    default:
      return <CommentIcon size={14} className="c-muted" aria-label="Commented" />;
  }
}

function PullHeader({ pr }: { pr: PullDetail }) {
  const reviewers: { key: string; label: string; avatar?: string; state: ReviewState | "REQUESTED" }[] = [];
  for (const r of pr.latestOpinionatedReviews?.nodes ?? []) {
    if (r.author) reviewers.push({ key: r.author.login, label: r.author.login, avatar: r.author.avatarUrl, state: r.state });
  }
  for (const req of pr.reviewRequests?.nodes ?? []) {
    const reviewer = req.requestedReviewer;
    if (!reviewer) continue;
    if (reviewer.__typename === "Team") {
      reviewers.push({ key: `team:${reviewer.slug}`, label: reviewer.name, state: "REQUESTED" });
    } else if (!reviewers.some((r) => r.key === reviewer.login)) {
      reviewers.push({ key: reviewer.login, label: reviewer.login, avatar: reviewer.avatarUrl, state: "REQUESTED" });
    }
  }

  const headLabel = pr.isCrossRepository && pr.headRepository ? `${pr.headRepository.nameWithOwner.split("/")[0]}:${pr.headRefName}` : pr.headRefName;
  const verb = pr.merged ? "merged" : "wants to merge";
  return (
    <div className="detail-header">
      <StateBadge kind={pullVisualState(pr.state, pr.isDraft)} />
      <h2>
        {pr.title} <span className="num">#{pr.number}</span>
      </h2>
      <div className="small muted" style={{ lineHeight: 1.7 }}>
        <Avatar src={pr.author?.avatarUrl} size={18} />{" "}
        {pr.author ? (
          <Link to={paths.user(pr.author.login)} className="bold" style={{ color: "var(--fg)" }}>
            {pr.author.login}
          </Link>
        ) : (
          "ghost"
        )}{" "}
        {verb} {pr.commits.totalCount} commit{pr.commits.totalCount === 1 ? "" : "s"} into <span className="branch">{pr.baseRefName}</span> from{" "}
        <span className="branch">{headLabel}</span> · <Time iso={pr.merged ? pr.mergedAt : pr.createdAt} />
      </div>
      <Labels labels={pr.labels?.nodes} />
      {reviewers.length > 0 && (
        <div className="wrap-flex small" style={{ marginTop: 10 }}>
          <span className="muted">Reviewers</span>
          {reviewers.map((r) => (
            <span key={r.key} className="pill" style={{ paddingLeft: r.avatar ? 2 : 8 }}>
              {r.avatar && <Avatar src={r.avatar} size={16} />}
              {r.label}
              {reviewIcon(r.state)}
            </span>
          ))}
        </div>
      )}
      {(pr.assignees.nodes.length > 0 || pr.milestone) && (
        <div className="row-flex small muted" style={{ marginTop: 8, flexWrap: "wrap" }}>
          {pr.assignees.nodes.length > 0 && (
            <span className="row-flex">
              Assignees
              <span className="avatar-stack">
                {pr.assignees.nodes.map((a) => (
                  <Avatar key={a.login} src={a.avatarUrl} size={20} alt={a.login} />
                ))}
              </span>
            </span>
          )}
          {pr.milestone && <span>Milestone: {pr.milestone.title}</span>}
        </div>
      )}
      <div className="row-flex small" style={{ marginTop: 10 }}>
        <span className="diffstat">
          <span className="add">+{pr.additions}</span>
          <span className="del">−{pr.deletions}</span>
        </span>
        <span className="muted">
          {pr.changedFiles} file{pr.changedFiles === 1 ? "" : "s"} changed
        </span>
      </div>
    </div>
  );
}

function ReviewBlock({
  review,
  threads,
  threadActions,
  viewerLogin,
}: {
  review: ReviewItem;
  threads: ReviewThread[];
  threadActions: ThreadActions;
  viewerLogin: string;
}) {
  const hasBody = review.body.trim().length > 0;
  // Replies to existing threads arrive as their own "commented" reviews; the
  // replies already show inside the original thread.
  if (!hasBody && threads.length === 0 && review.state === "COMMENTED") return null;

  const verb = reviewVerb(review.state);
  return (
    <>
      <div className="event">
        <span className={`event-icon${verb.tone ? ` ${verb.tone}` : ""}`}>{verb.icon}</span>
        <span className="event-text">
          <Avatar src={review.author?.avatarUrl} size={16} /> <strong>{review.author?.login ?? "ghost"}</strong> {verb.text}
          {review.state === "PENDING" && <span className="pill pill-attention" style={{ marginLeft: 6 }}>Pending</span>}{" "}
          <span className="nowrap">
            · <Time iso={review.submittedAt ?? review.createdAt} />
          </span>
        </span>
      </div>
      {hasBody && (
        <div className="comment" style={{ marginTop: 8 }}>
          <div className="comment-body">
            <Markdown html={review.bodyHTML} />
          </div>
        </div>
      )}
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} actions={threadActions} showContext viewerLogin={viewerLogin} />
      ))}
    </>
  );
}

function MergeRow({ icon, title, detail, action }: { icon: ReactNode; title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="merge-box-row">
      <span style={{ paddingTop: 2 }}>{icon}</span>
      <span className="grow">
        <span className="bold" style={{ display: "block" }}>
          {title}
        </span>
        {detail && <span className="muted small">{detail}</span>}
      </span>
      {action}
    </div>
  );
}

function MergeBox({
  pr,
  onShowChecks,
  onReadyForReview,
  onUpdateBranch,
  onDisableAutoMerge,
}: {
  pr: PullDetail;
  onShowChecks: () => void;
  onReadyForReview: () => void;
  onUpdateBranch: () => void;
  onDisableAutoMerge: () => void;
}) {
  const rows: ReactNode[] = [];

  if (pr.reviewDecision === "APPROVED") {
    rows.push(<MergeRow key="review" icon={<CheckCircleFillIcon size={18} className="c-success" />} title="Changes approved" />);
  } else if (pr.reviewDecision === "CHANGES_REQUESTED") {
    rows.push(<MergeRow key="review" icon={<XCircleFillIcon size={18} className="c-danger" />} title="Changes requested" />);
  } else if (pr.reviewDecision === "REVIEW_REQUIRED") {
    rows.push(
      <MergeRow key="review" icon={<EyeIcon size={18} className="c-attention" />} title="Review required" detail="At least one approving review is required." />,
    );
  }

  const checks = pr.statusCheckRollup?.state;
  if (checks) {
    const map = {
      SUCCESS: { icon: <CheckCircleFillIcon size={18} className="c-success" />, title: "All checks have passed" },
      FAILURE: { icon: <XCircleFillIcon size={18} className="c-danger" />, title: "Some checks were not successful" },
      ERROR: { icon: <XCircleFillIcon size={18} className="c-danger" />, title: "Some checks errored" },
      PENDING: { icon: <DotFillIcon size={18} className="c-attention" />, title: "Some checks haven't completed yet" },
      EXPECTED: { icon: <DotFillIcon size={18} className="c-attention" />, title: "Waiting for status to be reported" },
    }[checks];
    rows.push(
      <MergeRow
        key="checks"
        icon={map.icon}
        title={map.title}
        action={
          <button className="btn btn-sm" onClick={onShowChecks}>
            Details
          </button>
        }
      />,
    );
  }

  if (pr.isDraft) {
    rows.push(
      <MergeRow
        key="draft"
        icon={<GitPullRequestDraftIcon size={18} className="c-muted" />}
        title="This pull request is still a draft"
        detail="It can't be merged until it's marked ready for review."
        action={
          pr.viewerCanUpdate ? (
            <button className="btn btn-sm" onClick={onReadyForReview}>
              Ready
            </button>
          ) : undefined
        }
      />,
    );
  } else if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
    rows.push(
      <MergeRow
        key="merge"
        icon={<AlertIcon size={18} className="c-danger" />}
        title="This branch has conflicts"
        detail="Resolve them on GitHub or locally before merging."
      />,
    );
  } else if (pr.mergeStateStatus === "BEHIND") {
    rows.push(
      <MergeRow
        key="merge"
        icon={<AlertIcon size={18} className="c-attention" />}
        title="This branch is out-of-date"
        detail={`Merge the latest changes from ${pr.baseRefName} into this branch.`}
        action={
          pr.viewerCanUpdateBranch ? (
            <button className="btn btn-sm" onClick={onUpdateBranch}>
              Update
            </button>
          ) : undefined
        }
      />,
    );
  } else if (pr.mergeStateStatus === "BLOCKED") {
    rows.push(
      <MergeRow
        key="merge"
        icon={<AlertIcon size={18} className="c-attention" />}
        title="Merging is blocked"
        detail="Branch protection requirements aren't met yet."
      />,
    );
  } else if (pr.mergeStateStatus === "UNKNOWN" || pr.mergeable === "UNKNOWN") {
    rows.push(<MergeRow key="merge" icon={<Spinner small />} title="Checking mergeability…" />);
  } else {
    rows.push(
      <MergeRow key="merge" icon={<CheckCircleFillIcon size={18} className="c-success" />} title="No conflicts with the base branch" />,
    );
  }

  if (pr.autoMergeRequest) {
    rows.push(
      <MergeRow
        key="auto"
        icon={<GitMergeIcon size={18} className="c-done" />}
        title="Auto-merge enabled"
        detail={`${pr.autoMergeRequest.mergeMethod.toLowerCase()} · by ${pr.autoMergeRequest.enabledBy?.login ?? "someone"}`}
        action={
          pr.viewerCanDisableAutoMerge ? (
            <button className="btn btn-sm" onClick={onDisableAutoMerge}>
              Disable
            </button>
          ) : undefined
        }
      />,
    );
  }

  return <div className="merge-box">{rows}</div>;
}
