// A pull request's Spec tab: what it changes in the spec, to be read and
// reviewed as a spec. No code, no JSON: the changed items in the outline's
// order, each as prose with its edits marked, and the same comments and
// viewed marks as in the Files tab, where each item is one file.

import { AlertIcon, CheckCircleFillIcon, CircleIcon, NoteIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { anchorKey } from "../../lib/diff";
import type { DraftComment, useReviewDraft } from "../../lib/drafts";
import { SPEC_DIR, specTrail } from "../../lib/spec";
import type { ItemChange } from "../../lib/specDiff";
import { useToast } from "../../lib/toast";
import type { PullDetail, ReviewThread } from "../../lib/types";
import type { LineTarget } from "../../components/DiffView";
import { SpecChangeCard, SpecChangesSummary } from "../../components/SpecChanges";
import type { ThreadActions } from "../../components/Timeline";
import { CenterSpinner, EmptyState, ErrorView, LoadMore, SkeletonList } from "../../components/ui";
import { pullQueries, useInlineComment, useToggleViewed } from "../../queries/pulls";
import type { PullSpec } from "../../queries/spec";
import { LineCommentSheet, SpecFileCard } from "./FilesTab";

type Filter = "all" | "unviewed" | "weakened";
const takesAway = (item: ItemChange) => item.weakened !== null || item.requirements.some((r) => r.weakened !== null);
const fileOf = (item: ItemChange) => (item.after ?? item.before)?.file ?? null;

/** Cards are shown this many at a time. */
const PAGE = 40;

export function SpecTab({
  owner,
  repo,
  number,
  pr,
  spec,
  threads,
  threadActions,
  drafts,
  viewerLogin,
}: {
  owner: string;
  repo: string;
  number: number;
  pr: PullDetail;
  spec: PullSpec;
  threads: ReviewThread[];
  threadActions: ThreadActions;
  drafts: ReturnType<typeof useReviewDraft>;
  viewerLogin: string;
}) {
  const toast = useToast();
  const patches = useQuery(pullQueries.patches(owner, repo, number, pr.headRefOid));
  const viewed = useQuery(pullQueries.viewed(owner, repo, number));
  const toggleViewed = useToggleViewed(owner, repo, number);
  const inlineComment = useInlineComment(owner, repo, number);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<{ line: LineTarget; draft?: DraftComment } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);

  const files = useMemo(() => new Map((patches.data ?? []).map((file) => [file.filename, file])), [patches.data]);
  const sides = useMemo(() => ({ owner, repo, base: spec.base, head: pr.headRefOid }), [owner, repo, spec.base, pr.headRefOid]);
  const isViewed = (item: ItemChange) => viewed.data?.[fileOf(item) ?? ""] === "VIEWED";
  // How many comments, posted and pending, are on each item's file.
  const discussed = useMemo(() => {
    const counts = new Map<string, number>();
    const count = (path: string) => counts.set(path, (counts.get(path) ?? 0) + 1);
    threads.forEach((thread) => count(thread.path));
    drafts.draft.comments.forEach((draft) => count(draft.path));
    return counts;
  }, [threads, drafts.draft.comments]);

  if (patches.isPending) return <CenterSpinner />;
  if (patches.isError) return <ErrorView error={patches.error} onRetry={() => void patches.refetch()} />;
  if (!spec.touchesSpec) {
    return (
      <EmptyState icon={<NoteIcon size={32} />} title="No spec changes">
        This pull request doesn't change anything in <span className="mono">{SPEC_DIR}</span>.
      </EmptyState>
    );
  }
  if (spec.error) return <ErrorView error={spec.error} onRetry={spec.retry} />;
  const diff = spec.diff;
  if (diff === null) return <SkeletonList />;
  if (diff.items.length === 0) {
    return (
      <EmptyState icon={<NoteIcon size={32} />} title="Nothing changes in what the spec says">
        The files in <span className="mono">{SPEC_DIR}</span> it touches are pictures, or say the same as before.
      </EmptyState>
    );
  }

  const all = diff.items;
  const viewedCount = all.filter(isViewed).length;
  const items = all.filter((item) => filter === "all" || (filter === "unviewed" ? !isViewed(item) : takesAway(item)));
  const isCollapsed = (item: ItemChange) => collapsed[item.id] ?? isViewed(item);
  const show = (id: string) => {
    // It may be filtered out, folded, or further down than what is drawn.
    setFilter("all");
    setCollapsed((current) => ({ ...current, [id]: false }));
    setShown(Math.max(shown, all.findIndex((item) => item.id === id) + 1));
    window.setTimeout(() => document.querySelector(`.screen .spec-change[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" }), 80);
  };
  const filters: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: all.length },
    { value: "unviewed", label: "To read", count: all.length - viewedCount },
    { value: "weakened", label: "Takes away", count: all.filter(takesAway).length },
  ];

  return (
    <div className="spec-tab">
      <SpecChangesSummary diff={diff} onShow={show} />
      {(spec.before.contentsError ?? spec.after.contentsError) !== null && (
        <div className="banner banner-danger">
          <span className="grow">Some items couldn't be read.</span>
          <button className="btn btn-sm" onClick={spec.retry}>
            Retry
          </button>
        </div>
      )}

      {/* What there is to read, in the outline's order, and how far along the review is. */}
      <nav className="spec-tab-contents" aria-label="Changed parts of the spec">
        <div className="spec-tab-progress">
          <span className="bold grow">Changed parts</span>
          <span className={viewedCount === all.length ? "c-success bold small" : "muted small"}>
            {viewedCount}/{all.length} viewed
          </span>
        </div>
        {all.map((item) => {
          const node = item.after ?? item.before;
          if (node === null) return null;
          const trail = specTrail(node).slice(0, -1);
          const comments = discussed.get(fileOf(item) ?? "") ?? 0;
          return (
            <button key={item.id} className="spec-tab-entry" onClick={() => show(item.id)}>
              {isViewed(item) ? <CheckCircleFillIcon size={16} className="c-success" /> : <CircleIcon size={16} className="c-muted" />}
              <span className="grow" style={{ minWidth: 0 }}>
                {trail.length > 0 && <span className="muted small">{trail.map((n) => n.title).join(" / ")} / </span>}
                <span className={isViewed(item) ? "muted" : "bold"}>{node.title}</span>
              </span>
              {takesAway(item) && <AlertIcon size={14} className="c-danger" aria-label="Takes something away" />}
              {comments > 0 && <span className="counter">{comments}</span>}
              <span className="spec-diff-kind" data-kind={item.kind}>
                {item.kind === "added" ? "New" : item.kind === "removed" ? "Removed" : item.kind === "moved" ? "Moved" : "Changed"}
              </span>
            </button>
          );
        })}
      </nav>

      {all.length > 1 && (
        <div className="chips" role="radiogroup" aria-label="Show">
          {filters
            .filter((option) => option.value === "all" || option.count > 0)
            .map((option) => (
              <button
                key={option.value}
                role="radio"
                aria-checked={filter === option.value}
                className={filter === option.value ? "chip active" : "chip"}
                onClick={() => {
                  setFilter(option.value);
                  setShown(PAGE);
                }}
              >
                {option.label} <span className="counter">{option.count}</span>
              </button>
            ))}
        </div>
      )}
      {items.length === 0 && <div className="center muted">Nothing left to read.</div>}

      {items.slice(0, shown).map((item) => {
        const path = fileOf(item);
        const file = path === null ? undefined : files.get(path);
        const toggle = () => setCollapsed((current) => ({ ...current, [item.id]: !isCollapsed(item) }));
        // Not among the pull request's files (a folder's name changed above it, say): shown, without the review tools.
        if (path === null || file === undefined) return <SpecChangeCard key={item.id} change={item} sides={sides} collapsed={isCollapsed(item)} onToggleCollapsed={toggle} reading />;
        return (
          <SpecFileCard
            key={item.id}
            file={file}
            change={item}
            sides={sides}
            reading
            // The verdict and checks of the file are for the Files tab; here the spec is read.
            review={undefined}
            onOpenReview={() => undefined}
            collapsed={isCollapsed(item)}
            onToggleCollapsed={toggle}
            viewed={isViewed(item)}
            onToggleViewed={() => {
              const next = !isViewed(item);
              toggleViewed.mutate({ pullRequestId: pr.id, path, viewed: next });
              setCollapsed((current) => ({ ...current, [item.id]: next }));
            }}
            threads={threads.filter((thread) => thread.path === path)}
            drafts={drafts.draft.comments.filter((draft) => draft.path === path)}
            threadActions={threadActions}
            viewerLogin={viewerLogin}
            selectedKey={target?.line.path === path ? anchorKey(target.line.side, target.line.number) : null}
            onLineSelect={(line) => setTarget({ line })}
            onEditDraft={(draft, line) => setTarget({ line, draft })}
            onDeleteDraft={(draft) => drafts.removeComment(draft.id)}
          />
        );
      })}
      <LoadMore hasMore={items.length > shown} loading={false} onLoadMore={() => setShown(shown + PAGE)} />

      <LineCommentSheet
        target={target}
        onClose={() => setTarget(null)}
        onAddDraft={(line, body, existing) => {
          if (existing) drafts.updateComment(existing.id, body);
          else drafts.addComment({ path: line.path, line: line.number, side: line.side, body });
          toast.show(existing ? "Pending comment updated" : "Added to your review", "success");
        }}
        onCommentNow={async (line, body) => {
          await inlineComment.mutateAsync({ body, commitId: pr.headRefOid, path: line.path, line: line.number, side: line.side });
        }}
      />
    </div>
  );
}
