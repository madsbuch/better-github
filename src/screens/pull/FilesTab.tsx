import { CheckIcon, CopyIcon, FileIcon, LightBulbIcon, LinkExternalIcon, PencilIcon, TrashIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { errorMessage } from "../../lib/api";
import { backend } from "../../lib/backend";
import { anchorKey, suggestionBody } from "../../lib/diff";
import type { DraftComment, useReviewDraft } from "../../lib/drafts";
import { to, useNav } from "../../lib/nav";
import { usePrefs } from "../../lib/prefs";
import { useToast } from "../../lib/toast";
import { riskRank, RULES_FILE, type FileReview, type Risk } from "../../lib/reviewRules";
import type { FileViewedState, PullDetail, RestPullFile, ReviewThread } from "../../lib/types";
import { DiffFile, type LineTarget } from "../../components/DiffView";
import { ReviewNotes, RiskBadge } from "../../components/ReviewRules";
import { ActionSheet, Sheet } from "../../components/Sheet";
import { ThreadCard, type ThreadActions } from "../../components/Timeline";
import { CenterSpinner, ErrorView, Spinner } from "../../components/ui";
import { pullQueries, useInlineComment, useToggleViewed } from "../../queries/pulls";
import { useCopyRulesPrompt, useRecheckReviewRules, type PullReview } from "../../queries/reviewRules";

type Drafts = ReturnType<typeof useReviewDraft>;

export function FilesTab({
  owner,
  repo,
  number,
  pr,
  threads,
  threadActions,
  drafts,
  viewerLogin,
  jumpOpen,
  onJumpClose,
  review,
}: {
  owner: string;
  repo: string;
  number: number;
  pr: PullDetail;
  /** Verdicts from .review-rules. */
  review: PullReview;
  threads: ReviewThread[];
  threadActions: ThreadActions;
  drafts: Drafts;
  viewerLogin: string;
  jumpOpen: boolean;
  onJumpClose: () => void;
}) {
  const prefs = usePrefs();
  const toast = useToast();
  const nav = useNav();
  const patches = useQuery(pullQueries.patches(owner, repo, number, pr.headRefOid));
  useRecheckReviewRules(owner, repo, pr.baseRefName);
  const viewed = useQuery(pullQueries.viewed(owner, repo, number));
  const toggleViewed = useToggleViewed(owner, repo, number);
  const inlineComment = useInlineComment(owner, repo, number);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<{ line: LineTarget; draft?: DraftComment } | null>(null);
  const [fileMenu, setFileMenu] = useState<RestPullFile | null>(null);

  const verdicts = review.files;
  // Riskiest first, a change to the rules themselves before all; otherwise GitHub's order.
  const files = useMemo(() => {
    const changed = patches.data ?? [];
    if (verdicts.size === 0) return changed;
    const rank = (f: RestPullFile) => {
      if (f.filename === RULES_FILE || f.previous_filename === RULES_FILE) return 3;
      const risk = verdicts.get(f.filename)?.risk;
      return risk ? riskRank(risk) : -1;
    };
    return [...changed].sort((a, b) => rank(b) - rank(a));
  }, [patches.data, verdicts]);
  const viewedCount = files.filter((f) => viewed.data?.[f.filename] === "VIEWED").length;

  // Viewed and low-risk files start collapsed.
  const isCollapsed = useCallback(
    (path: string) => collapsed[path] ?? (viewed.data?.[path] === "VIEWED" || verdicts.get(path)?.risk === "low"),
    [collapsed, viewed.data, verdicts],
  );

  const threadsByFile = useMemo(() => {
    const map = new Map<string, ReviewThread[]>();
    for (const t of threads) {
      const list = map.get(t.path) ?? [];
      list.push(t);
      map.set(t.path, list);
    }
    return map;
  }, [threads]);

  const draftsByFile = useMemo(() => {
    const map = new Map<string, DraftComment[]>();
    for (const d of drafts.draft.comments) {
      const list = map.get(d.path) ?? [];
      list.push(d);
      map.set(d.path, list);
    }
    return map;
  }, [drafts.draft.comments]);

  const commentNow = async (line: LineTarget, body: string) => {
    await inlineComment.mutateAsync({ body, commitId: pr.headRefOid, path: line.path, line: line.number, side: line.side });
  };

  const scrollToFile = (path: string) => {
    onJumpClose();
    setCollapsed((c) => ({ ...c, [path]: false }));
    window.setTimeout(() => {
      const el = document.querySelector(`.screen .diff-file[data-path="${CSS.escape(path)}"]`);
      el?.scrollIntoView({ block: "start" });
    }, 80);
  };

  if (patches.isPending) return <CenterSpinner />;
  if (patches.isError) return <ErrorView error={patches.error} onRetry={() => void patches.refetch()} />;

  return (
    <>
      <div className="row-flex small" style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-muted)" }}>
        <span className="grow muted">
          {files.length} file{files.length === 1 ? "" : "s"}
          {pr.changedFiles > files.length ? ` (of ${pr.changedFiles})` : ""} ·{" "}
          <span className="diffstat">
            <span className="add">+{pr.additions}</span>
            <span className="del">−{pr.deletions}</span>
          </span>
        </span>
        <span className={viewedCount === files.length && files.length > 0 ? "c-success bold" : "muted"}>
          {viewedCount}/{files.length} viewed
        </span>
      </div>
      <ReviewSummary owner={owner} repo={repo} review={review} files={files} viewed={viewed.data} baseRef={pr.baseRefName} />
      {files.map((file) => {
        const path = file.filename;
        return (
          <FileWithComments
            key={path}
            file={file}
            wrap={prefs.wrapDiff}
            collapsed={isCollapsed(path)}
            onToggleCollapsed={() => setCollapsed((c) => ({ ...c, [path]: !isCollapsed(path) }))}
            viewed={viewed.data?.[path] === "VIEWED"}
            review={verdicts.get(path)}
            onToggleViewed={() => {
              const next = viewed.data?.[path] !== "VIEWED";
              toggleViewed.mutate({ pullRequestId: pr.id, path, viewed: next });
              setCollapsed((c) => ({ ...c, [path]: next }));
            }}
            onMenu={() => setFileMenu(file)}
            threads={threadsByFile.get(path)}
            drafts={draftsByFile.get(path)}
            threadActions={threadActions}
            viewerLogin={viewerLogin}
            selectedKey={target?.line.path === path ? anchorKey(target.line.side, target.line.number) : null}
            onLineSelect={(line) => setTarget({ line })}
            onEditDraft={(draft, line) => setTarget({ line, draft })}
            onDeleteDraft={(draft) => drafts.removeComment(draft.id)}
          />
        );
      })}
      {files.length === 0 && <div className="center">No files changed.</div>}

      <LineCommentSheet
        target={target}
        onClose={() => setTarget(null)}
        onAddDraft={(line, body, existing) => {
          if (existing) drafts.updateComment(existing.id, body);
          else drafts.addComment({ path: line.path, line: line.number, side: line.side, body });
          toast.show(existing ? "Pending comment updated" : "Added to your review", "success");
        }}
        onCommentNow={commentNow}
      />

      <Sheet open={jumpOpen} onClose={onJumpClose} title="Jump to file" full>
        {files.map((file) => {
          const isViewed = viewed.data?.[file.filename] === "VIEWED";
          const count = (threadsByFile.get(file.filename)?.length ?? 0) + (draftsByFile.get(file.filename)?.length ?? 0);
          return (
            <button key={file.filename} className="menu-item" style={{ paddingLeft: 4, minHeight: 46 }} onClick={() => scrollToFile(file.filename)}>
              {isViewed ? <CheckIcon size={16} className="c-success" /> : <FileIcon size={16} />}
              <span className={`grow mono small ${isViewed ? "muted" : ""}`} style={{ overflowWrap: "anywhere" }}>
                {file.filename}
              </span>
              {count > 0 && <span className="counter">{count}</span>}
              {verdicts.get(file.filename) && <RiskBadge risk={verdicts.get(file.filename)!.risk} />}
              <span className="diffstat">
                <span className="add">+{file.additions}</span>
                <span className="del">−{file.deletions}</span>
              </span>
            </button>
          );
        })}
      </Sheet>

      <ActionSheet
        open={fileMenu !== null}
        onClose={() => setFileMenu(null)}
        title="File"
        actions={[
          {
            label: "View file",
            icon: <FileIcon size={18} />,
            hidden: fileMenu?.status === "removed",
            onSelect: () => fileMenu && nav.navigate(to.blob(owner, repo, pr.headRefOid, fileMenu.filename)),
          },
          {
            label: "Copy path",
            icon: <CopyIcon size={18} />,
            onSelect: () => fileMenu && void backend.copyText(fileMenu.filename).then(() => toast.show("Path copied")),
          },
          {
            label: "Open diff in browser",
            icon: <LinkExternalIcon size={18} />,
            onSelect: () => void backend.openUrl(`${pr.url}/files`),
          },
        ]}
      />
    </>
  );
}

/**
 * Re-render a file only when its data changes. Callback props are recreated
 * on every parent render but only close over state setters and values that
 * are also passed as props, so ignoring them is safe.
 */
function sameData(prev: Record<string, unknown>, next: Record<string, unknown>): boolean {
  for (const key of Object.keys(next)) {
    if (typeof next[key] === "function") continue;
    if (!Object.is(prev[key], next[key])) return false;
  }
  return true;
}

const FileWithComments = memo(function FileWithComments({
  file,
  review,
  threads,
  drafts,
  threadActions,
  viewerLogin,
  onEditDraft,
  onDeleteDraft,
  ...rest
}: {
  file: RestPullFile;
  review: FileReview | undefined;
  wrap: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  viewed: boolean;
  onToggleViewed: () => void;
  onMenu: () => void;
  threads: ReviewThread[] | undefined;
  drafts: DraftComment[] | undefined;
  threadActions: ThreadActions;
  viewerLogin: string;
  selectedKey: string | null;
  onLineSelect: (line: LineTarget) => void;
  onEditDraft: (draft: DraftComment, line: LineTarget) => void;
  onDeleteDraft: (draft: DraftComment) => void;
}) {
  const { inline, outdated } = useMemo(() => {
    const groups = new Map<string, ReactNode[]>();
    const add = (key: string, node: ReactNode) => {
      const list = groups.get(key) ?? [];
      list.push(node);
      groups.set(key, list);
    };
    const outdated: ReviewThread[] = [];
    for (const thread of threads ?? []) {
      if (thread.isOutdated || thread.line === null || thread.subjectType === "FILE") {
        outdated.push(thread);
        continue;
      }
      add(
        anchorKey(thread.diffSide, thread.line),
        <ThreadCard key={thread.id} thread={thread} actions={threadActions} showContext={false} viewerLogin={viewerLogin} />,
      );
    }
    for (const draft of drafts ?? []) {
      add(
        anchorKey(draft.side, draft.line),
        <DraftCard
          key={draft.id}
          draft={draft}
          onEdit={() =>
            onEditDraft(draft, {
              path: draft.path,
              side: draft.side,
              number: draft.line,
              line: { kind: draft.side === "LEFT" ? "del" : "ctx", text: "", oldNo: null, newNo: null },
            })
          }
          onDelete={() => onDeleteDraft(draft)}
        />,
      );
    }
    const inline = new Map<string, ReactNode>();
    for (const [key, nodes] of groups) inline.set(key, <>{nodes}</>);
    return { inline, outdated };
  }, [threads, drafts, threadActions, viewerLogin, onEditDraft, onDeleteDraft]);

  const top = useMemo(
    () => (
      <>
        {review && <ReviewNotes review={review} />}
        {outdated.length > 0 && (
          <div style={{ paddingBottom: 10, background: "var(--bg-subtle)" }}>
            {outdated.map((thread) => (
              <ThreadCard key={thread.id} thread={thread} actions={threadActions} showContext viewerLogin={viewerLogin} defaultOpen={false} />
            ))}
          </div>
        )}
      </>
    ),
    [review, outdated, threadActions, viewerLogin],
  );

  return (
    <DiffFile
      {...rest}
      file={{
        filename: file.filename,
        previousFilename: file.previous_filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      }}
      inline={inline}
      top={top}
      badge={review && <RiskBadge risk={review.risk} />}
    />
  );
}, sameData);

/** The verdicts at a glance, and anything wrong with the rules. */
function ReviewSummary({
  owner,
  repo,
  review,
  files,
  viewed,
  baseRef,
}: {
  owner: string;
  repo: string;
  review: PullReview;
  files: RestPullFile[];
  viewed: Record<string, FileViewedState> | undefined;
  baseRef: string;
}) {
  const groups = (["high", "medium", "low"] as Risk[])
    .map((risk) => {
      const paths = files.filter((f) => review.files.get(f.filename)?.risk === risk).map((f) => f.filename);
      return { risk, total: paths.length, viewed: paths.filter((path) => viewed?.[path] === "VIEWED").length };
    })
    .filter((group) => group.total > 0);
  const warnings = review.rules?.warnings ?? [];
  const copyPrompt = useCopyRulesPrompt();
  const promptButton = (
    <button className="btn btn-sm" onClick={() => void copyPrompt(owner, repo, baseRef)}>
      <CopyIcon size={14} /> Copy agent prompt
    </button>
  );

  return (
    <>
      {groups.length > 0 && (
        <div className="review-summary">
          {groups.map((group) => (
            <span key={group.risk}>
              <RiskBadge risk={group.risk} />{" "}
              <span className={group.viewed === group.total ? "c-success small" : "muted small"}>
                {group.viewed}/{group.total} viewed
              </span>
            </span>
          ))}
          {review.rules && <span className="review-summary-action">{promptButton}</span>}
        </div>
      )}
      {review.loaded && !review.rules && !review.changesRules && (
        // Verdicts use the rules of the branch this merges into; say which one was checked.
        <div className="review-summary">
          {review.headHasRules ? (
            <span className="grow muted small">
              This pull request's branch has a {RULES_FILE}, but {baseRef} doesn't. Verdicts use the rules on {baseRef}, the branch it
              merges into, so they apply once the file is there.
            </span>
          ) : (
            <>
              <span className="grow muted small">
                No {RULES_FILE} on {baseRef}, the branch this merges into. A coding agent can write one for you.
              </span>
              {promptButton}
            </>
          )}
        </div>
      )}
      {review.changesRules && (
        <div className="banner banner-attention">
          {review.rules
            ? `This pull request changes ${RULES_FILE}. The verdicts here use the rules on ${baseRef}; the changes apply once it's merged.`
            : `This pull request adds ${RULES_FILE}. Its rules apply once it's merged.`}
        </div>
      )}
      {(warnings.length > 0 || review.truncated) && (
        <div className="banner banner-attention">
          <span>
            {review.truncated ? `${RULES_FILE} is too large; GitHub only sent part of it. ` : ""}
            {warnings.length > 0 && `Some lines of ${RULES_FILE} on ${baseRef} are left out:`}
            {warnings.slice(0, 3).map((w) => (
              <span key={w.line} className="small" style={{ display: "block" }}>
                Line {w.line}: {w.message}
              </span>
            ))}
            {warnings.length > 3 && <span className="small">And {warnings.length - 3} more.</span>}
          </span>
        </div>
      )}
      {review.error && (
        <div className="banner banner-danger">
          <span className="grow">
            Couldn't load {RULES_FILE}: {errorMessage(review.error)}
          </span>
          <button className="btn btn-sm" onClick={review.retry}>
            Retry
          </button>
        </div>
      )}
    </>
  );
}

function DraftCard({ draft, onEdit, onDelete }: { draft: DraftComment; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="draft-comment">
      <div className="comment-header">
        <span className="pill pill-attention">Pending</span>
        <span className="grow" />
        <button className="icon-btn sm" aria-label="Edit pending comment" onClick={onEdit}>
          <PencilIcon size={16} />
        </button>
        <button className="icon-btn sm" aria-label="Delete pending comment" onClick={onDelete}>
          <TrashIcon size={16} />
        </button>
      </div>
      <div className="comment-body" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {draft.body}
      </div>
    </div>
  );
}

function LineCommentSheet({
  target,
  onClose,
  onAddDraft,
  onCommentNow,
}: {
  target: { line: LineTarget; draft?: DraftComment } | null;
  onClose: () => void;
  onAddDraft: (line: LineTarget, body: string, existing?: DraftComment) => void;
  onCommentNow: (line: LineTarget, body: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBody(target?.draft?.body ?? "");
  }, [target]);

  if (!target) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const { line, draft } = target;
  const canSuggest = line.side === "RIGHT" && !draft;

  const commentNow = async () => {
    setBusy(true);
    try {
      await onCommentNow(line, body.trim());
      onClose();
    } catch {
      // The mutation reports the error; keep the sheet open to retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${draft ? "Edit comment" : "Comment"} · line ${line.number}`}
      footer={
        <>
          {!draft && (
            <button className="btn" disabled={!body.trim() || busy} onClick={() => void commentNow()}>
              {busy && <Spinner small />} Comment now
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={!body.trim() || busy}
            onClick={() => {
              onAddDraft(line, body.trim(), draft);
              onClose();
            }}
          >
            {draft ? "Save" : "Add to review"}
          </button>
        </>
      }
    >
      <div className="mono small muted" style={{ marginBottom: 8, overflowWrap: "anywhere" }}>
        {line.path}
      </div>
      {line.line.text !== "" && (
        <div className="diff-body wrap" style={{ border: "1px solid var(--border-muted)", borderRadius: 6, marginBottom: 12 }}>
          <div className={`dl ${line.line.kind}`} style={{ cursor: "default" }}>
            <span className="dl-code">
              <span className="dl-marker">{line.line.kind === "add" ? "+" : line.line.kind === "del" ? "-" : " "}</span>
              {line.line.text}
            </span>
          </div>
        </div>
      )}
      <textarea
        className="textarea"
        autoFocus
        placeholder="Leave a comment (Markdown supported)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        style={{ minHeight: 140 }}
      />
      {canSuggest && (
        <button
          className="btn btn-sm"
          style={{ marginTop: 10 }}
          onClick={() => setBody((b) => (b ? `${b.replace(/\s*$/, "")}\n\n` : "") + suggestionBody([line.line.text]))}
        >
          <LightBulbIcon size={14} /> Suggest a change
        </button>
      )}
    </Sheet>
  );
}
