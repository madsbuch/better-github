import {
  CheckIcon,
  CommentIcon,
  CopyIcon,
  DotFillIcon,
  EyeIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  KebabHorizontalIcon,
  ListUnorderedIcon,
  LinkExternalIcon,
  SyncIcon,
  TrashIcon,
  UnwrapIcon,
  WrapIcon,
  XIcon,
} from "@primer/octicons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { encodePath, errorMessage, graphql, rest } from "../lib/api";
import { backend } from "../lib/backend";
import { draftKey, useReviewDraft } from "../lib/drafts";
import { setPref, usePrefs } from "../lib/prefs";
import { ADD_COMMENT, CLOSE_PULL, CONVERT_TO_DRAFT, DISABLE_AUTO_MERGE, READY_FOR_REVIEW, REOPEN_PULL } from "../lib/queries";
import { nav, useScreen } from "../lib/router";
import { paths } from "../lib/routes";
import { useViewer } from "../lib/session";
import { useToast } from "../lib/toast";
import type { StatusState } from "../lib/types";
import { Screen } from "../components/Screen";
import { ActionSheet, Sheet } from "../components/Sheet";
import { CenterSpinner, EmptyState, ErrorView, ScreenTabs } from "../components/ui";
import { ChecksTab, CommitsTab } from "./pull/ChecksAndCommits";
import { Conversation, canMerge } from "./pull/Conversation";
import { FilesTab } from "./pull/FilesTab";
import { MergeSheet, ReviewSheet, TextSheet } from "./pull/Sheets";
import { pullKey, usePullDetail, useThreadActions, useThreads } from "./pull/data";

type Tab = "conversation" | "files" | "commits" | "checks";
const TABS: Tab[] = ["conversation", "files", "commits", "checks"];

function checksTabIcon(state: StatusState | undefined) {
  if (state === "SUCCESS") return <CheckIcon size={16} className="c-success" />;
  if (state === "FAILURE" || state === "ERROR") return <XIcon size={16} className="c-danger" />;
  if (state === "PENDING" || state === "EXPECTED") return <DotFillIcon size={16} className="c-attention" />;
  return null;
}

export function PullScreen() {
  const { route } = useScreen();
  const { owner, repo } = route.params;
  const number = Number(route.params.number);
  const tab = (TABS.includes(route.query.get("tab") as Tab) ? route.query.get("tab") : "conversation") as Tab;
  const viewer = useViewer();
  const prefs = usePrefs();
  const toast = useToast();
  const queryClient = useQueryClient();

  const detail = usePullDetail(owner, repo, number);
  const threads = useThreads(owner, repo, number);
  const threadActions = useThreadActions(owner, repo, number);
  const drafts = useReviewDraft(draftKey(owner, repo, number));

  const [menu, setMenu] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentSeed, setCommentSeed] = useState("");
  const [jumpOpen, setJumpOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const repoInfo = detail.data?.repository ?? null;
  const pr = repoInfo?.pullRequest ?? null;
  const key = pullKey(owner, repo, number);

  const setTab = (next: Tab) => nav.replace(paths.pull(owner, repo, number, next === "conversation" ? undefined : next));
  const refresh = () => queryClient.refetchQueries({ queryKey: key, type: "active" });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["search-issues"] });
  };

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      toast.show(label, "success");
      invalidate();
    } catch (e) {
      toast.show(errorMessage(e), "error");
    }
  };

  const addComment = async (body: string) => {
    if (!pr) return;
    try {
      await graphql(ADD_COMMENT, { subjectId: pr.id, body });
      toast.show("Comment added", "success");
      void queryClient.invalidateQueries({ queryKey: [...key, "timeline"] });
    } catch (e) {
      toast.show(errorMessage(e), "error");
      throw e;
    }
  };

  const quote = (text: string) => {
    setCommentSeed(text);
    setCommentOpen(true);
  };

  const updateBranch = () =>
    run("Branch update started", () =>
      rest(`/repos/${owner}/${repo}/pulls/${number}/update-branch`, { method: "PUT", body: { expected_head_sha: pr?.headRefOid } }),
    );

  const pendingCount = drafts.draft.comments.length;
  const url = `https://github.com/${owner}/${repo}/pull/${number}`;

  return (
    <Screen
      title={pr?.title ?? `Pull request #${number}`}
      subtitle={`${owner}/${repo} #${number}`}
      actions={
        <>
          {tab === "files" && (
            <>
              <button className="icon-btn" aria-label="Toggle line wrap" onClick={() => setPref("wrapDiff", !prefs.wrapDiff)}>
                {prefs.wrapDiff ? <UnwrapIcon size={18} /> : <WrapIcon size={18} />}
              </button>
              <button className="icon-btn" aria-label="Jump to file" onClick={() => setJumpOpen(true)}>
                <ListUnorderedIcon size={18} />
              </button>
            </>
          )}
          <button className="icon-btn" aria-label="More" onClick={() => setMenu(true)}>
            <KebabHorizontalIcon size={20} />
          </button>
        </>
      }
      header={
        <ScreenTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "conversation", label: "Conversation" },
            { value: "files", label: "Files", count: pr?.changedFiles },
            { value: "commits", label: "Commits", count: pr?.commits.totalCount },
            { value: "checks", label: "Checks", icon: checksTabIcon(pr?.statusCheckRollup?.state) },
          ]}
        />
      }
      footer={
        pr && repoInfo ? (
          <div className="bottom-bar">
            <button className="btn" onClick={() => quote("")}>
              <CommentIcon size={16} /> Comment
            </button>
            <button className="btn" onClick={() => setReviewOpen(true)}>
              <EyeIcon size={16} /> Review
              {pendingCount > 0 && <span className="counter" style={{ background: "var(--attention-bg)", color: "var(--attention)" }}>{pendingCount}</span>}
            </button>
            {canMerge(repoInfo, pr) && !pr.autoMergeRequest && (
              <button className="btn btn-primary" onClick={() => setMergeOpen(true)}>
                <GitMergeIcon size={16} /> Merge
              </button>
            )}
          </div>
        ) : undefined
      }
      onRefresh={refresh}
    >
      {detail.isPending ? (
        <CenterSpinner />
      ) : detail.isError ? (
        <ErrorView error={detail.error} onRetry={() => void detail.refetch()} />
      ) : !pr || !repoInfo ? (
        <EmptyState icon={<GitPullRequestIcon size={32} />} title="Pull request not found" />
      ) : tab === "conversation" ? (
        <Conversation
          owner={owner}
          repo={repo}
          number={number}
          pr={pr}
          threads={threads.data ?? []}
          threadActions={threadActions}
          viewerLogin={viewer.login}
          onQuote={quote}
          onShowChecks={() => setTab("checks")}
          onReadyForReview={() => void run("Marked ready for review", () => graphql(READY_FOR_REVIEW, { pullRequestId: pr.id }))}
          onUpdateBranch={() => void updateBranch()}
          onDisableAutoMerge={() => void run("Auto-merge disabled", () => graphql(DISABLE_AUTO_MERGE, { pullRequestId: pr.id }))}
        />
      ) : tab === "files" ? (
        <FilesTab
          owner={owner}
          repo={repo}
          number={number}
          pr={pr}
          threads={threads.data ?? []}
          threadActions={threadActions}
          drafts={drafts}
          viewerLogin={viewer.login}
          jumpOpen={jumpOpen}
          onJumpClose={() => setJumpOpen(false)}
        />
      ) : tab === "commits" ? (
        <CommitsTab owner={owner} repo={repo} number={number} />
      ) : (
        <ChecksTab owner={owner} repo={repo} number={number} />
      )}

      {pr && repoInfo && (
        <>
          <ReviewSheet open={reviewOpen} onClose={() => setReviewOpen(false)} owner={owner} repo={repo} pr={pr} drafts={drafts} />
          <MergeSheet open={mergeOpen} onClose={() => setMergeOpen(false)} owner={owner} repo={repo} pr={pr} repoInfo={repoInfo} />
          <TextSheet
            open={commentOpen}
            onClose={() => setCommentOpen(false)}
            title="Add a comment"
            placeholder="Leave a comment (Markdown supported)"
            initial={commentSeed}
            submitLabel="Comment"
            onSubmit={addComment}
          />
          <ActionSheet
            open={menu}
            onClose={() => setMenu(false)}
            title="Pull request"
            actions={[
              {
                label: "Ready for review",
                icon: <EyeIcon size={18} />,
                hidden: !(pr.isDraft && pr.state === "OPEN" && pr.viewerCanUpdate),
                onSelect: () => void run("Marked ready for review", () => graphql(READY_FOR_REVIEW, { pullRequestId: pr.id })),
              },
              {
                label: "Convert to draft",
                icon: <GitPullRequestDraftIcon size={18} />,
                hidden: !(!pr.isDraft && pr.state === "OPEN" && pr.viewerCanUpdate),
                onSelect: () => void run("Converted to draft", () => graphql(CONVERT_TO_DRAFT, { pullRequestId: pr.id })),
              },
              {
                label: "Update branch",
                icon: <SyncIcon size={18} />,
                hidden: !(pr.state === "OPEN" && pr.mergeStateStatus === "BEHIND" && pr.viewerCanUpdateBranch),
                onSelect: () => void updateBranch(),
              },
              { label: "Open in browser", icon: <LinkExternalIcon size={18} />, onSelect: () => void backend.openUrl(tab === "conversation" ? url : `${url}/${tab}`) },
              { label: "Copy link", icon: <CopyIcon size={18} />, onSelect: () => void backend.copyText(url).then(() => toast.show("Link copied")) },
              {
                label: "Copy branch name",
                icon: <GitBranchIcon size={18} />,
                onSelect: () => void backend.copyText(pr.headRefName).then(() => toast.show("Branch name copied")),
              },
              {
                label: "Reopen pull request",
                icon: <GitPullRequestIcon size={18} />,
                hidden: !(pr.state === "CLOSED" && pr.viewerCanReopen),
                onSelect: () => void run("Pull request reopened", () => graphql(REOPEN_PULL, { pullRequestId: pr.id })),
              },
              {
                label: "Delete branch",
                icon: <TrashIcon size={18} />,
                danger: true,
                hidden: !(pr.state !== "OPEN" && pr.viewerCanDeleteHeadRef && !pr.isCrossRepository),
                onSelect: () => setConfirmDelete(true),
              },
              {
                label: "Close pull request",
                icon: <GitPullRequestClosedIcon size={18} />,
                danger: true,
                hidden: !(pr.state === "OPEN" && pr.viewerCanClose),
                onSelect: () => void run("Pull request closed", () => graphql(CLOSE_PULL, { pullRequestId: pr.id })),
              },
            ]}
          />
          <Sheet
            open={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            title="Delete branch?"
            footer={
              <>
                <button className="btn" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger-solid"
                  onClick={() => {
                    setConfirmDelete(false);
                    void run("Branch deleted", () =>
                      rest(`/repos/${owner}/${repo}/git/refs/heads/${encodePath(pr.headRefName)}`, { method: "DELETE" }),
                    );
                  }}
                >
                  Delete
                </button>
              </>
            }
          >
            <p style={{ margin: 0 }}>
              This deletes <span className="branch">{pr.headRefName}</span> from {owner}/{repo}. You can restore it from the pull
              request on GitHub.
            </p>
          </Sheet>
        </>
      )}
    </Screen>
  );
}
