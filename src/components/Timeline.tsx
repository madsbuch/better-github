import {
  CheckIcon,
  CommentIcon,
  CrossReferenceIcon,
  EyeIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  IssueClosedIcon,
  IssueReopenedIcon,
  KebabHorizontalIcon,
  PencilIcon,
  PersonIcon,
  RepoPushIcon,
  SkipIcon,
  TagIcon,
  XIcon,
} from "@primer/octicons-react";
import { useState, type ReactNode } from "react";
import { backend } from "../lib/backend";
import { Link } from "../lib/router";
import { paths, splitRepo } from "../lib/routes";
import { useToast } from "../lib/toast";
import type { Actor, IssueCommentItem, ReviewState, ReviewThread, TimelineEvent, TimelineItem } from "../lib/types";
import { Markdown } from "./Markdown";
import { ActionSheet } from "./Sheet";
import { Avatar, ChecksIcon, LabelPill, Spinner, Time } from "./ui";

const ASSOCIATION: Record<string, string> = {
  OWNER: "Owner",
  MEMBER: "Member",
  COLLABORATOR: "Collaborator",
  CONTRIBUTOR: "Contributor",
  FIRST_TIME_CONTRIBUTOR: "First-time contributor",
  FIRST_TIMER: "First-timer",
};

function Who({ actor }: { actor: Actor | null }) {
  if (!actor) return <strong>ghost</strong>;
  return (
    <Link to={paths.user(actor.login)} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>
      <strong>{actor.login}</strong>
    </Link>
  );
}

export interface CommentCardProps {
  author: Actor | null;
  association?: string;
  createdAt: string;
  bodyHTML: string;
  body?: string;
  url?: string;
  highlight?: boolean;
  headerExtra?: ReactNode;
  emptyText?: string;
  onQuote?: (body: string) => void;
}

export function CommentCard({ author, association, createdAt, bodyHTML, body, url, highlight, headerExtra, emptyText, onQuote }: CommentCardProps) {
  const [menu, setMenu] = useState(false);
  const toast = useToast();
  const assoc = association ? ASSOCIATION[association] : undefined;
  return (
    <div className={`comment${highlight ? " viewer" : ""}`}>
      <div className="comment-header">
        <Avatar src={author?.avatarUrl} size={22} />
        <span className="grow ellipsis">
          <span className="author">{author?.login ?? "ghost"}</span>{" "}
          <span className="muted">
            <Time iso={createdAt} />
          </span>
        </span>
        {headerExtra}
        {assoc && <span className="pill">{assoc}</span>}
        {(url || onQuote) && (
          <button className="icon-btn sm" aria-label="Comment actions" onClick={() => setMenu(true)}>
            <KebabHorizontalIcon size={16} />
          </button>
        )}
      </div>
      <div className="comment-body">
        <Markdown html={bodyHTML} empty={emptyText ?? "No description provided."} />
      </div>
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title="Comment"
        actions={[
          {
            label: "Quote reply",
            hidden: !onQuote || !body,
            onSelect: () => onQuote?.(quote(body ?? "")),
          },
          {
            label: "Copy link",
            hidden: !url,
            onSelect: () => void backend.copyText(url!).then(() => toast.show("Link copied")),
          },
          {
            label: "Copy text",
            hidden: !body,
            onSelect: () => void backend.copyText(body!).then(() => toast.show("Copied")),
          },
          { label: "Open in browser", hidden: !url, onSelect: () => void backend.openUrl(url!) },
        ]}
      />
    </div>
  );
}

export function quote(body: string): string {
  return (
    body
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n") + "\n\n"
  );
}

export function IssueCommentCard({ item, viewerLogin, onQuote }: { item: IssueCommentItem; viewerLogin: string; onQuote?: (body: string) => void }) {
  return (
    <CommentCard
      author={item.author}
      association={item.authorAssociation}
      createdAt={item.createdAt}
      bodyHTML={item.bodyHTML}
      body={item.body}
      url={item.url}
      highlight={item.author?.login === viewerLogin}
      onQuote={onQuote}
    />
  );
}

function EventLine({ icon, tone, children, at }: { icon: ReactNode; tone?: string; children: ReactNode; at: string }) {
  return (
    <div className="event">
      <span className={`event-icon${tone ? ` ${tone}` : ""}`}>{icon}</span>
      <span className="event-text">
        {children} <span className="nowrap">· <Time iso={at} /></span>
      </span>
    </div>
  );
}

export function EventRow({ event, owner, repo, isPull }: { event: TimelineEvent; owner: string; repo: string; isPull: boolean }) {
  switch (event.__typename) {
    case "MergedEvent":
      return (
        <EventLine icon={<GitMergeIcon size={14} />} tone="done" at={event.createdAt}>
          <Who actor={event.actor} /> merged {event.mergeCommit ? <span className="mono">{event.mergeCommit.abbreviatedOid}</span> : "this"} into{" "}
          <span className="branch">{event.mergeRefName}</span>
        </EventLine>
      );
    case "ClosedEvent":
      return (
        <EventLine
          icon={isPull ? <GitPullRequestClosedIcon size={14} /> : event.stateReason === "NOT_PLANNED" ? <SkipIcon size={14} /> : <IssueClosedIcon size={14} />}
          tone={isPull ? "danger" : event.stateReason === "NOT_PLANNED" ? undefined : "done"}
          at={event.createdAt}
        >
          <Who actor={event.actor} /> closed this{event.stateReason === "NOT_PLANNED" ? " as not planned" : event.stateReason === "COMPLETED" ? " as completed" : ""}
        </EventLine>
      );
    case "ReopenedEvent":
      return (
        <EventLine icon={<IssueReopenedIcon size={14} />} tone="success" at={event.createdAt}>
          <Who actor={event.actor} /> reopened this
        </EventLine>
      );
    case "HeadRefForcePushedEvent":
      return (
        <EventLine icon={<RepoPushIcon size={14} />} at={event.createdAt}>
          <Who actor={event.actor} /> force-pushed
          {event.beforeCommit && event.afterCommit && (
            <>
              {" "}
              from <span className="mono">{event.beforeCommit.abbreviatedOid}</span> to{" "}
              <span className="mono">{event.afterCommit.abbreviatedOid}</span>
            </>
          )}
        </EventLine>
      );
    case "HeadRefDeletedEvent":
      return (
        <EventLine icon={<GitBranchIcon size={14} />} at={event.createdAt}>
          <Who actor={event.actor} /> deleted the <span className="branch">{event.headRefName}</span> branch
        </EventLine>
      );
    case "ReviewRequestedEvent": {
      const reviewer = event.requestedReviewer;
      return (
        <EventLine icon={<EyeIcon size={14} />} at={event.createdAt}>
          <Who actor={event.actor} /> requested a review from <strong>{reviewer?.login ?? reviewer?.name ?? "someone"}</strong>
        </EventLine>
      );
    }
    case "ReviewDismissedEvent":
      return (
        <EventLine icon={<XIcon size={14} />} at={event.createdAt}>
          <Who actor={event.actor} /> dismissed a review
        </EventLine>
      );
    case "ReadyForReviewEvent":
      return (
        <EventLine icon={<EyeIcon size={14} />} at={event.createdAt}>
          <Who actor={event.actor} /> marked this ready for review
        </EventLine>
      );
    case "ConvertToDraftEvent":
      return (
        <EventLine icon={<GitPullRequestDraftIcon size={14} />} at={event.createdAt}>
          <Who actor={event.actor} /> converted this to a draft
        </EventLine>
      );
    case "LabeledEvent":
    case "UnlabeledEvent":
      return (
        <EventLine icon={<TagIcon size={14} />} at={event.createdAt}>
          <Who actor={event.actor} /> {event.__typename === "LabeledEvent" ? "added" : "removed"} <LabelPill label={event.label} />
        </EventLine>
      );
    case "AssignedEvent": {
      const assignee = event.assignee?.login;
      return (
        <EventLine icon={<PersonIcon size={14} />} at={event.createdAt}>
          <Who actor={event.actor} /> {assignee && assignee === event.actor?.login ? "self-assigned this" : <>assigned <strong>{assignee ?? "someone"}</strong></>}
        </EventLine>
      );
    }
    case "RenamedTitleEvent":
      return (
        <EventLine icon={<PencilIcon size={14} />} at={event.createdAt}>
          <Who actor={event.actor} /> changed the title <s>{event.previousTitle}</s> {event.currentTitle}
        </EventLine>
      );
    case "CrossReferencedEvent": {
      const source = event.source;
      const [o, r] = splitRepo(source.repository.nameWithOwner);
      const to = source.__typename === "PullRequest" ? paths.pull(o, r, source.number) : paths.issue(o, r, source.number);
      const sameRepo = o === owner && r === repo;
      return (
        <EventLine icon={<CrossReferenceIcon size={14} />} at={event.createdAt}>
          <Who actor={event.actor} /> mentioned this in{" "}
          <Link to={to}>
            {sameRepo ? "" : source.repository.nameWithOwner}#{source.number} {source.title}
          </Link>
        </EventLine>
      );
    }
    default:
      return null;
  }
}

export function reviewVerb(state: ReviewState): { text: string; icon: ReactNode; tone?: string } {
  switch (state) {
    case "APPROVED":
      return { text: "approved these changes", icon: <CheckIcon size={14} />, tone: "success" };
    case "CHANGES_REQUESTED":
      return { text: "requested changes", icon: <FileDiffIcon size={14} />, tone: "danger" };
    case "DISMISSED":
      return { text: "reviewed (dismissed)", icon: <EyeIcon size={14} /> };
    case "PENDING":
      return { text: "started a review", icon: <EyeIcon size={14} /> };
    default:
      return { text: "reviewed", icon: <EyeIcon size={14} /> };
  }
}

export function CommitRow({ item, owner, repo }: { item: Extract<TimelineItem, { __typename: "PullRequestCommit" }>; owner: string; repo: string }) {
  const c = item.commit;
  return (
    <Link to={paths.commit(owner, repo, c.oid)} className="event" style={{ color: "var(--fg-muted)" }}>
      <span className="event-icon">
        <GitCommitIcon size={14} />
      </span>
      <Avatar src={c.author?.avatarUrl} size={18} />
      <span className="event-text ellipsis" style={{ color: "var(--fg)" }}>
        {c.messageHeadline}
      </span>
      <ChecksIcon state={c.statusCheckRollup?.state} />
      <span className="mono tiny">{c.abbreviatedOid}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Review threads

/** The last few lines of a review comment's diff hunk, for context. */
export function HunkSnippet({ hunk, lines = 4 }: { hunk: string; lines?: number }) {
  const rows = hunk.split("\n").filter((l) => !l.startsWith("@@")).slice(-lines);
  return (
    <div className="diff-body" style={{ borderBottom: "1px solid var(--border-muted)" }}>
      {rows.map((row, i) => {
        const kind = row.startsWith("+") ? "add" : row.startsWith("-") ? "del" : "ctx";
        return (
          <div key={i} className={`dl ${kind}`} style={{ cursor: "default" }}>
            <span className="dl-code">
              <span className="dl-marker">{kind === "add" ? "+" : kind === "del" ? "-" : " "}</span>
              {row.slice(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export interface ThreadActions {
  reply: (thread: ReviewThread, body: string) => Promise<void>;
  setResolved: (thread: ReviewThread, resolved: boolean) => Promise<void>;
}

export function ThreadCard({
  thread,
  actions,
  showContext,
  viewerLogin,
  defaultOpen,
}: {
  thread: ReviewThread;
  actions: ThreadActions;
  showContext: boolean;
  viewerLogin: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? !thread.isResolved);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const first = thread.comments.nodes[0];

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await actions.reply(thread, reply.trim());
      setReply("");
      setReplying(false);
    } catch {
      // The action already reported the error; keep the draft reply.
    } finally {
      setBusy(false);
    }
  };

  const toggleResolved = async () => {
    setBusy(true);
    try {
      await actions.setResolved(thread, !thread.isResolved);
      if (!thread.isResolved) setOpen(false);
    } catch {
      // Reported by the action.
    } finally {
      setBusy(false);
    }
  };

  const line = thread.line ?? thread.originalLine;
  return (
    <div className={`thread${thread.isResolved ? " resolved" : ""}`}>
      <button className="thread-header" style={{ width: "100%", border: 0, textAlign: "left", cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <CommentIcon size={14} />
        <span className="grow ellipsis mono">
          {thread.path}
          {line ? `:${line}` : ""}
        </span>
        {thread.isOutdated && <span className="pill pill-attention">Outdated</span>}
        {thread.isResolved && <span className="pill">Resolved</span>}
        {!open && <span className="muted">{thread.comments.totalCount}</span>}
      </button>
      {open && (
        <>
          {showContext && first && <HunkSnippet hunk={first.diffHunk} />}
          {thread.comments.nodes.map((c) => (
            <div key={c.id} className="thread-comment">
              <div className="row-flex small" style={{ marginBottom: 6 }}>
                <Avatar src={c.author?.avatarUrl} size={20} />
                <span className={`bold${c.author?.login === viewerLogin ? " c-accent" : ""}`}>{c.author?.login ?? "ghost"}</span>
                <span className="muted">
                  <Time iso={c.createdAt} />
                </span>
              </div>
              <Markdown html={c.bodyHTML} />
            </div>
          ))}
          {replying ? (
            <div className="thread-comment stack-v" style={{ gap: 8 }}>
              <textarea
                className="textarea"
                style={{ minHeight: 80 }}
                autoFocus
                placeholder="Reply…"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <div className="row-flex" style={{ justifyContent: "flex-end" }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setReplying(false)}>
                  Cancel
                </button>
                <button className="btn btn-sm btn-primary" disabled={!reply.trim() || busy} onClick={() => void send()}>
                  {busy && <Spinner small />} Reply
                </button>
              </div>
            </div>
          ) : (
            <div className="thread-actions">
              {thread.viewerCanReply && (
                <button className="btn btn-sm grow" onClick={() => setReplying(true)}>
                  Reply…
                </button>
              )}
              {(thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve) && (
                <button className="btn btn-sm" disabled={busy} onClick={() => void toggleResolved()}>
                  {busy ? <Spinner small /> : thread.isResolved ? "Unresolve" : "Resolve"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
