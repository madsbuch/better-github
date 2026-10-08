import { CheckIcon, CopyIcon, FileIcon, LightBulbIcon, LinkExternalIcon, PencilIcon, TrashIcon } from "@primer/octicons-react";
import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { errorMessage, rest } from "../../lib/api";
import { backend } from "../../lib/backend";
import { anchorKey, suggestionBody } from "../../lib/diff";
import type { DraftComment, useReviewDraft } from "../../lib/drafts";
import { usePrefs } from "../../lib/prefs";
import { nav } from "../../lib/router";
import { paths } from "../../lib/routes";
import { useToast } from "../../lib/toast";
import type { PullDetail, RestPullFile, ReviewThread } from "../../lib/types";
import { DiffFile, type LineTarget } from "../../components/DiffView";
import { ActionSheet, Sheet } from "../../components/Sheet";
import { ThreadCard, type ThreadActions } from "../../components/Timeline";
import { CenterSpinner, ErrorView, Spinner } from "../../components/ui";
import { pullKey, usePatches, useToggleViewed, useViewedState } from "./data";

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
}: {
  owner: string;
  repo: string;
  number: number;
  pr: PullDetail;
  threads: ReviewThread[];
  threadActions: ThreadActions;
  drafts: Drafts;
  viewerLogin: string;
  jumpOpen: boolean;
  onJumpClose: () => void;
}) {
  const prefs = usePrefs();
  const toast = useToast();
  const queryClient = useQueryClient();
  const patches = usePatches(owner, repo, number, pr.headRefOid);
  const viewed = useViewedState(owner, repo, number);
  const toggleViewed = useToggleViewed(owner, repo, number, pr.id);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<{ line: LineTarget; draft?: DraftComment } | null>(null);
  const [fileMenu, setFileMenu] = useState<RestPullFile | null>(null);

  const files = patches.data ?? [];
  const viewedCount = files.filter((f) => viewed.data?.[f.filename] === "VIEWED").length;

  const isCollapsed = useCallback(
    (path: string) => collapsed[path] ?? viewed.data?.[path] === "VIEWED",
    [collapsed, viewed.data],
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
    await rest(`/repos/${owner}/${repo}/pulls/${number}/comments`, {
      method: "POST",
      body: { body, commit_id: pr.headRefOid, path: line.path, line: line.number, side: line.side },
    });
    await queryClient.invalidateQueries({ queryKey: [...pullKey(owner, repo, number), "threads"] });
    toast.show("Comment added", "success");
  };

  const scrollToFile = (path: string) => {
    onJumpClose();
    setCollapsed((c) => ({ ...c, [path]: false }));
    window.setTimeout(() => {
      const el = document.querySelector(`.screen:not(.hidden) .diff-file[data-path="${CSS.escape(path)}"]`);
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
            onToggleViewed={() => {
              const next = viewed.data?.[path] !== "VIEWED";
              void toggleViewed(path, next);
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
            onSelect: () => fileMenu && nav.navigate(paths.blob(owner, repo, pr.headRefOid, fileMenu.filename)),
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
  threads,
  drafts,
  threadActions,
  viewerLogin,
  onEditDraft,
  onDeleteDraft,
  ...rest
}: {
  file: RestPullFile;
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

  const top =
    outdated.length > 0 ? (
      <div style={{ paddingBottom: 10, background: "var(--bg-subtle)" }}>
        {outdated.map((thread) => (
          <ThreadCard key={thread.id} thread={thread} actions={threadActions} showContext viewerLogin={viewerLogin} defaultOpen={false} />
        ))}
      </div>
    ) : undefined;

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
    />
  );
}, sameData);

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
  const toast = useToast();
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
    } catch (e) {
      toast.show(errorMessage(e), "error");
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
