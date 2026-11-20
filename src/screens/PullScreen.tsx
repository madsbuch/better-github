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
  XIcon,
} from "@primer/octicons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { draftKey, useReviewDraft } from "../lib/drafts";
import { to, useNav, type PullTab } from "../lib/nav";
import { usePrefs } from "../lib/prefs";
import { DiffLayoutButtons } from "../components/DiffView";
import { useViewer } from "../lib/session";
import { useToast } from "../lib/toast";
import type { StatusState, UpdateBranchMethod } from "../lib/types";
import { keys } from "../queries/keys";
import { pullQueries, pullTabQueries, usePullMutations, useThreadActions } from "../queries/pulls";
import { usePullReview } from "../queries/reviewRules";
import { Screen } from "../components/Screen";
import { ActionSheet, Sheet } from "../components/Sheet";
import { CenterSpinner, EmptyState, ErrorView, ScreenTabs } from "../components/ui";
import { ChecksTab, CommitsTab } from "./pull/ChecksAndCommits";
import { Conversation, canMerge } from "./pull/Conversation";
import { FilesTab } from "./pull/FilesTab";
import { MergeSheet, ReviewSheet, TextSheet } from "./pull/Sheets";

const route = getRouteApi("/$owner/$repo/pull/$number");

function checksTabIcon(state: StatusState | undefined) {
  if (state === "SUCCESS") return <CheckIcon size={16} className="c-success" />;
  if (state === "FAILURE" || state === "ERROR") return <XIcon size={16} className="c-danger" />;
  if (state === "PENDING" || state === "EXPECTED") return <DotFillIcon size={16} className="c-attention" />;
  return null;
}

export function PullScreen() {
  const { owner, repo, number } = route.useParams();
  const tab: PullTab = route.useSearch({ select: (s) => s.tab ?? "conversation" });
  const viewer = useViewer();
  const prefs = usePrefs();
  const toast = useToast();
  const nav = useNav();
  const queryClient = useQueryClient();

  const detail = useQuery(pullQueries.detail(owner, repo, number));
  const threads = useQuery(pullQueries.threads(owner, repo, number));
  const threadActions = useThreadActions(owner, repo, number);
  const mutations = usePullMutations(owner, repo, number);
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
  const headSha = pr?.headRefOid;

  // Every tab's data loads in the background, so switching tabs never waits.
  useEffect(() => {
    const tabs = pullTabQueries(owner, repo, number);
    void queryClient.prefetchInfiniteQuery(tabs.timeline);
    void queryClient.prefetchQuery(tabs.threads);
    void queryClient.prefetchQuery(tabs.viewed);
    void queryClient.prefetchQuery(tabs.commits);
    void queryClient.prefetchQuery(tabs.checks);
  }, [queryClient, owner, repo, number]);
  useEffect(() => {
    if (headSha !== undefined && headSha !== "") void queryClient.prefetchQuery(pullQueries.patches(owner, repo, number, headSha));
  }, [queryClient, owner, repo, number, headSha]);

  // Verdicts from the review rules of the branch this merges into.
  const review = usePullReview(owner, repo, number, pr);
  const viewed = useQuery(pullQueries.viewed(owner, repo, number));
  const unviewedHigh = [...review.files]
    .filter(([path, file]) => file.risk === "high" && viewed.data?.[path] !== "VIEWED")
    .map(([path]) => path);

  const setTab = (next: PullTab) => nav.replace(to.pull(owner, repo, number, next));
  // Pulling to refresh reloads everything the screen shows, the review rules too.
  const refresh = () =>
    Promise.all([
      queryClient.refetchQueries({ queryKey: keys.pull.all(owner, repo, number), type: "active" }),
      queryClient.refetchQueries({ queryKey: keys.repo.reviewRulesAll(owner, repo), type: "active" }),
    ]);

  const addComment = async (body: string) => {
    if (pr) await mutations.comment.mutateAsync({ subjectId: pr.id, body });
  };

  const quote = (text: string) => {
    setCommentSeed(text);
    setCommentOpen(true);
  };

  const updateBranch = (method: UpdateBranchMethod) => {
    if (!pr || headSha === undefined || headSha === "") return;
    mutations.updateBranch.mutate(
      { pullRequestId: pr.id, headSha, method, base: pr.baseRefName },
      // GitHub finishes the update in the background; look again in a moment.
      { onSuccess: () => window.setTimeout(() => void refresh(), 3000) },
    );
  };

  const pendingCount = drafts.draft.comments.length;
  const url = `https://github.com/${owner}/${repo}/pull/${number}`;

  return (
    <Screen
      wide={tab === "files"}
      title={pr?.title ?? `Pull request #${number}`}
      subtitle={`${owner}/${repo} #${number}`}
      actions={
        <>
          {tab === "files" && (
            <>
              <DiffLayoutButtons />
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
          onReadyForReview={() => void mutations.readyForReview(pr.id)}
          onUpdateBranch={updateBranch}
          updatingBranch={mutations.updateBranch.isPending}
          onDisableAutoMerge={() => void mutations.disableAutoMerge(pr.id)}
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
          review={review}
        />
      ) : tab === "commits" ? (
        <CommitsTab owner={owner} repo={repo} number={number} />
      ) : (
        <ChecksTab owner={owner} repo={repo} number={number} />
      )}

      {pr && repoInfo && (
        <>
          <ReviewSheet
            open={reviewOpen}
            onClose={() => setReviewOpen(false)}
            pr={pr}
            drafts={drafts}
            mutations={mutations}
            unviewedHigh={unviewedHigh}
          />
          <MergeSheet open={mergeOpen} onClose={() => setMergeOpen(false)} pr={pr} repoInfo={repoInfo} mutations={mutations} />
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
                onSelect: () => void mutations.readyForReview(pr.id),
              },
              {
                label: "Convert to draft",
                icon: <GitPullRequestDraftIcon size={18} />,
                hidden: !(!pr.isDraft && pr.state === "OPEN" && pr.viewerCanUpdate),
                onSelect: () => void mutations.convertToDraft(pr.id),
              },
              {
                label: "Update branch",
                icon: <SyncIcon size={18} />,
                // True whenever the branch is behind, also when GitHub reports BLOCKED.
                hidden: !(pr.state === "OPEN" && pr.viewerCanUpdateBranch),
                onSelect: () => updateBranch(prefs.updateBranchMethod),
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
                onSelect: () => void mutations.reopen(pr.id),
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
                onSelect: () => void mutations.close(pr.id),
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
                    mutations.deleteBranch.mutate(pr.headRefName);
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
