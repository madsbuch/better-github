import { CommentIcon, LockIcon, RepoForkedIcon, StarIcon } from "@primer/octicons-react";
import { compactNumber } from "../lib/format";
import { Link } from "@tanstack/react-router";
import { splitRepo, to } from "../lib/nav";
import type { IssueListItem, PullListItem, RepoListItem, SearchIssueNode } from "../lib/types";
import {
  Avatar,
  ChecksIcon,
  DiffStat,
  IssueStateIcon,
  Labels,
  PullStateIcon,
  ReviewDecisionPill,
  Time,
  pullVisualState,
} from "./ui";

export function PullRow({ pr, showRepo = true }: { pr: PullListItem; showRepo?: boolean }) {
  const [owner, repo] = splitRepo(pr.repository.nameWithOwner);
  const checks = pr.commits.nodes[0]?.commit.statusCheckRollup?.state;
  const comments = pr.totalCommentsCount ?? 0;
  return (
    // Rows preload their screen as they scroll into view, so opening one is instant.
    <Link {...to.pull(owner, repo, pr.number)} preload="viewport" className="row">
      <span className="row-icon">
        <PullStateIcon state={pullVisualState(pr.state, pr.isDraft)} />
      </span>
      <span className="row-body">
        <span className="row-meta">
          <span className="ellipsis">{showRepo ? `${pr.repository.nameWithOwner} #${pr.number}` : `#${pr.number}`}</span>
          <span>·</span>
          <span className="nowrap">
            <Time iso={pr.updatedAt} />
          </span>
        </span>
        <span className="row-title" style={{ display: "block" }}>
          {pr.title}
        </span>
        <Labels labels={pr.labels?.nodes} />
        <span className="row-stats">
          {checks && (
            <span>
              <ChecksIcon state={checks} />
            </span>
          )}
          <DiffStat additions={pr.additions} deletions={pr.deletions} />
          {comments > 0 && (
            <span>
              <CommentIcon size={13} /> {comments}
            </span>
          )}
          <ReviewDecisionPill decision={pr.reviewDecision} />
        </span>
      </span>
      <span className="row-trailing">
        <Avatar src={pr.author?.avatarUrl} size={24} alt={pr.author?.login} />
      </span>
    </Link>
  );
}

export function IssueRow({ issue, showRepo = true }: { issue: IssueListItem; showRepo?: boolean }) {
  const [owner, repo] = splitRepo(issue.repository.nameWithOwner);
  return (
    <Link {...to.issue(owner, repo, issue.number)} preload="viewport" className="row">
      <span className="row-icon">
        <IssueStateIcon state={issue.issueState} reason={issue.stateReason} />
      </span>
      <span className="row-body">
        <span className="row-meta">
          <span className="ellipsis">
            {showRepo ? `${issue.repository.nameWithOwner} #${issue.number}` : `#${issue.number}`}
          </span>
          <span>·</span>
          <span className="nowrap">
            <Time iso={issue.updatedAt} />
          </span>
        </span>
        <span className="row-title" style={{ display: "block" }}>
          {issue.title}
        </span>
        <Labels labels={issue.labels?.nodes} />
        {issue.comments.totalCount > 0 && (
          <span className="row-stats">
            <span>
              <CommentIcon size={13} /> {issue.comments.totalCount}
            </span>
          </span>
        )}
      </span>
      <span className="row-trailing">
        <Avatar src={issue.author?.avatarUrl} size={24} alt={issue.author?.login} />
      </span>
    </Link>
  );
}

export function SearchIssueRow({ node, showRepo = true }: { node: SearchIssueNode; showRepo?: boolean }) {
  if (node.__typename === "PullRequest") return <PullRow pr={node as PullListItem} showRepo={showRepo} />;
  if (node.__typename === "Issue") return <IssueRow issue={node as IssueListItem} showRepo={showRepo} />;
  return null;
}

export function RepoRow({ repo, showOwner = true }: { repo: RepoListItem; showOwner?: boolean }) {
  return (
    <Link {...to.repo(repo.owner.login, repo.name)} preload="viewport" className="row">
      <span className="row-icon" style={{ paddingTop: 0 }}>
        <Avatar src={repo.owner.avatarUrl} size={32} square alt={repo.owner.login} />
      </span>
      <span className="row-body">
        <span className="row-flex">
          <span className="bold ellipsis">{showOwner ? repo.nameWithOwner : repo.name}</span>
          {repo.isPrivate && <LockIcon size={13} className="c-muted" aria-label="Private" />}
          {repo.isArchived && <span className="pill pill-attention">Archived</span>}
        </span>
        {repo.description && (
          <span className="muted small" style={{ display: "block", marginTop: 2, overflowWrap: "anywhere" }}>
            {repo.description}
          </span>
        )}
        <span className="row-stats">
          {repo.primaryLanguage && (
            <span>
              <span className="lang-dot" style={{ background: repo.primaryLanguage.color ?? "var(--fg-subtle)" }} />
              {repo.primaryLanguage.name}
            </span>
          )}
          <span>
            <StarIcon size={13} /> {compactNumber(repo.stargazerCount)}
          </span>
          {repo.isFork && (
            <span>
              <RepoForkedIcon size={13} /> fork
            </span>
          )}
          {repo.pushedAt && (
            <span>
              Updated <Time iso={repo.pushedAt} />
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
