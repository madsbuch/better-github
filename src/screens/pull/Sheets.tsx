import { TrashIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";
import { errorMessage } from "../../lib/api";
import type { useReviewDraft } from "../../lib/drafts";
import { useToast } from "../../lib/toast";
import type { MergeMethod, PullDetail, PullResult } from "../../lib/types";
import type { usePullMutations } from "../../queries/pulls";
import { Sheet } from "../../components/Sheet";
import { Spinner } from "../../components/ui";

type Drafts = ReturnType<typeof useReviewDraft>;
type PullMutations = ReturnType<typeof usePullMutations>;
type RepoInfo = NonNullable<PullResult["repository"]>;
type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export function ReviewSheet({
  open,
  onClose,
  pr,
  drafts,
  mutations,
  unviewedHigh,
}: {
  open: boolean;
  onClose: () => void;
  pr: PullDetail;
  drafts: Drafts;
  mutations: PullMutations;
  /** High-risk files (by .review-rules) not marked viewed. */
  unviewedHigh: string[];
}) {
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const busy = mutations.submitReview.isPending;
  const comments = drafts.draft.comments;
  const body = drafts.draft.body;
  const ownPull = pr.viewerDidAuthor;

  useEffect(() => {
    if (open && ownPull) setEvent("COMMENT");
  }, [open, ownPull]);

  const valid = event === "APPROVE" || body.trim().length > 0 || comments.length > 0;
  const unchecked = event === "APPROVE" ? unviewedHigh : [];

  const submit = () =>
    mutations.submitReview.mutate(
      {
        commitId: pr.headRefOid,
        event,
        body,
        comments: comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body })),
      },
      {
        onSuccess: () => {
          drafts.clear();
          onClose();
        },
      },
    );

  const options: { value: ReviewEvent; title: string; detail: string; disabled?: boolean }[] = [
    { value: "COMMENT", title: "Comment", detail: "Submit general feedback without explicit approval." },
    {
      value: "APPROVE",
      title: "Approve",
      detail: ownPull ? "You can't approve your own pull request." : "Give your approval to merge these changes.",
      disabled: ownPull,
    },
    {
      value: "REQUEST_CHANGES",
      title: "Request changes",
      detail: ownPull ? "You can't request changes on your own pull request." : "Feedback that must be addressed before merging.",
      disabled: ownPull,
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Finish your review"
      full
      footer={
        <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
          {busy && <Spinner small />} {unchecked.length > 0 ? "Approve anyway" : "Submit review"}
          {comments.length > 0 ? ` (${comments.length} comment${comments.length === 1 ? "" : "s"})` : ""}
        </button>
      }
    >
      <div className="stack-v">
        <textarea
          className="textarea"
          placeholder="Leave a summary (optional for approvals)"
          value={body}
          onChange={(e) => drafts.setBody(e.target.value)}
        />
        {options.map((option) => (
          <label key={option.value} className={`radio-card${event === option.value ? " selected" : ""}`} style={option.disabled === true ? { opacity: 0.5 } : undefined}>
            <input
              type="radio"
              name="review-event"
              checked={event === option.value}
              disabled={option.disabled}
              onChange={() => setEvent(option.value)}
            />
            <span>
              <span className="bold" style={{ display: "block" }}>
                {option.title}
              </span>
              <span className="muted small">{option.detail}</span>
            </span>
          </label>
        ))}
        {unchecked.length > 0 && (
          <div className="banner banner-danger" style={{ margin: 0 }}>
            <span>
              <span className="bold" style={{ display: "block" }}>
                {unchecked.length === 1 ? "A high-risk file isn't" : `${unchecked.length} high-risk files aren't`} marked viewed
              </span>
              {unchecked.map((path) => (
                <span key={path} className="mono small" style={{ display: "block", overflowWrap: "anywhere" }}>
                  {path}
                </span>
              ))}
            </span>
          </div>
        )}
        {comments.length > 0 && (
          <div>
            <div className="field-label">Pending comments</div>
            <div className="card">
              {comments.map((c) => (
                <div key={c.id} className="kv" style={{ alignItems: "flex-start" }}>
                  <span className="grow">
                    <span className="mono tiny muted" style={{ display: "block", overflowWrap: "anywhere" }}>
                      {c.path}:{c.line}
                    </span>
                    <span className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {c.body.length > 200 ? `${c.body.slice(0, 200)}…` : c.body}
                    </span>
                  </span>
                  <button className="icon-btn sm" aria-label="Remove comment" onClick={() => drafts.removeComment(c.id)}>
                    <TrashIcon size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {comments.length === 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            Tip: pick any line in the Files tab to add inline comments or suggestions to this review.
          </p>
        )}
      </div>
    </Sheet>
  );
}

const METHOD_LABEL: Record<MergeMethod, { title: string; detail: string; confirm: string }> = {
  MERGE: { title: "Create a merge commit", detail: "All commits are added to the base branch via a merge commit.", confirm: "Confirm merge" },
  SQUASH: { title: "Squash and merge", detail: "All commits are combined into one commit on the base branch.", confirm: "Confirm squash and merge" },
  REBASE: { title: "Rebase and merge", detail: "Commits are rebased and added to the base branch.", confirm: "Confirm rebase and merge" },
};

export function MergeSheet({
  open,
  onClose,
  pr,
  repoInfo,
  mutations,
}: {
  open: boolean;
  onClose: () => void;
  pr: PullDetail;
  repoInfo: RepoInfo;
  mutations: PullMutations;
}) {
  const toast = useToast();
  const allowed: MergeMethod[] = [
    ...(repoInfo.mergeCommitAllowed ? (["MERGE"] as const) : []),
    ...(repoInfo.squashMergeAllowed ? (["SQUASH"] as const) : []),
    ...(repoInfo.rebaseMergeAllowed ? (["REBASE"] as const) : []),
  ];
  const initial = allowed.includes(repoInfo.viewerDefaultMergeMethod) ? repoInfo.viewerDefaultMergeMethod : (allowed[0] ?? "MERGE");
  const [method, setMethod] = useState<MergeMethod>(initial);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [bypass, setBypass] = useState(false);
  const busy = mutations.merge.isPending || mutations.enableAutoMerge.isPending;

  useEffect(() => {
    if (!open) return;
    setTitle(method === "SQUASH" ? pr.squashTitle : pr.mergeTitle);
    setMessage(method === "SQUASH" ? pr.squashBody : pr.mergeBody);
  }, [open, method, pr.squashTitle, pr.squashBody, pr.mergeTitle, pr.mergeBody]);

  const canDeleteBranch = !pr.isCrossRepository && pr.viewerCanDeleteHeadRef && !repoInfo.deleteBranchOnMerge;
  const conflicting = pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY";
  const blocked = pr.mergeStateStatus === "BLOCKED" || pr.mergeStateStatus === "BEHIND";
  const canBypass = blocked && pr.viewerCanMergeAsAdmin;
  const mergeDisabled = busy || conflicting || (blocked && !(canBypass && bypass)) || allowed.length === 0;
  const offerAutoMerge = !conflicting && pr.viewerCanEnableAutoMerge && repoInfo.autoMergeAllowed && !pr.autoMergeRequest;

  const merge = () =>
    mutations.merge.mutate(
      {
        method,
        headSha: pr.headRefOid,
        title,
        message,
        deleteBranch: deleteBranch && canDeleteBranch ? pr.headRefName : null,
      },
      {
        onSuccess: (branchError) => {
          if (branchError !== null) toast.show(`Merged, but the branch wasn't deleted: ${errorMessage(branchError)}`, "error");
          onClose();
        },
      },
    );

  const enableAutoMerge = () => mutations.enableAutoMerge.mutate({ pullRequestId: pr.id, method }, { onSuccess: onClose });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Merge pull request"
      full
      footer={
        <div className="stack-v" style={{ gap: 8, width: "100%" }}>
          {offerAutoMerge && (blocked || pr.statusCheckRollup?.state === "PENDING") && (
            <button className="btn btn-block" disabled={busy} onClick={enableAutoMerge}>
              Enable auto-merge ({METHOD_LABEL[method].title.toLowerCase()})
            </button>
          )}
          <button className="btn btn-primary btn-block" disabled={mergeDisabled} onClick={merge}>
            {busy && <Spinner small />} {METHOD_LABEL[method].confirm}
          </button>
        </div>
      }
    >
      <div className="stack-v">
        {conflicting && <div className="banner banner-danger" style={{ margin: 0 }}>This branch has conflicts that must be resolved first.</div>}
        {blocked && !conflicting && (
          <div className="banner banner-attention" style={{ margin: 0 }}>
            {pr.mergeStateStatus === "BEHIND"
              ? "This branch is out-of-date with the base branch."
              : "Merging is blocked: required reviews or checks aren't satisfied yet."}
          </div>
        )}
        {allowed.length === 0 && <div className="banner banner-danger" style={{ margin: 0 }}>No merge methods are enabled for this repository.</div>}
        {allowed.map((m) => (
          <label key={m} className={`radio-card${method === m ? " selected" : ""}`}>
            <input type="radio" name="merge-method" checked={method === m} onChange={() => setMethod(m)} />
            <span>
              <span className="bold" style={{ display: "block" }}>
                {METHOD_LABEL[m].title}
              </span>
              <span className="muted small">{METHOD_LABEL[m].detail}</span>
            </span>
          </label>
        ))}
        {method !== "REBASE" && (
          <>
            <div>
              <label className="field-label" htmlFor="merge-title">
                Commit message
              </label>
              <input id="merge-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Extended description" />
          </>
        )}
        {canDeleteBranch && (
          <label className="checkbox-row">
            <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
            Delete <span className="branch">{pr.headRefName}</span> after merging
          </label>
        )}
        {canBypass && (
          <label className="checkbox-row">
            <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
            Use your administrator privileges to merge anyway
          </label>
        )}
      </div>
    </Sheet>
  );
}

export function TextSheet({
  open,
  onClose,
  title,
  placeholder,
  initial,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  placeholder: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setText(initial ?? "");
  }, [open, initial]);

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(text.trim());
      onClose();
    } catch {
      // onSubmit reports its own errors.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <button
          className="btn btn-primary"
          disabled={text.trim() === "" || busy}
          onClick={() => void submit()}
        >
          {busy && <Spinner small />} {submitLabel}
        </button>
      }
    >
      <textarea className="textarea" style={{ minHeight: 180 }} autoFocus placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
    </Sheet>
  );
}
