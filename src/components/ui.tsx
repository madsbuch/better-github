import {
  AlertIcon,
  CheckIcon,
  DotFillIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  IssueClosedIcon,
  IssueOpenedIcon,
  SkipIcon,
  XIcon,
} from "@primer/octicons-react";
import { useEffect, useRef, type ReactNode } from "react";
import { errorMessage } from "../lib/api";
import { fullDate, labelTextColor, timeAgo } from "../lib/format";
import type { IssueState, IssueStateReason, Label, PullState, ReviewDecision, StatusState } from "../lib/types";

export function Avatar({ src, size = 20, square = false, alt = "" }: { src?: string | null; size?: number; square?: boolean; alt?: string }) {
  if (!src) return <span className={`avatar${square ? " square" : ""}`} style={{ width: size, height: size, display: "inline-block" }} />;
  const url = withSize(src, size);
  return (
    <img
      className={`avatar${square ? " square" : ""}`}
      src={url}
      width={size}
      height={size}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

/** Requests an appropriately sized avatar from GitHub's avatar CDN. */
function withSize(src: string, size: number): string {
  if (!src.includes("avatars.githubusercontent.com")) return src;
  const px = Math.ceil(size * Math.min(window.devicePixelRatio || 2, 3));
  return `${src}${src.includes("?") ? "&" : "?"}s=${px}`;
}

export function Time({ iso }: { iso: string | null | undefined }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} title={fullDate(iso)}>
      {timeAgo(iso)}
    </time>
  );
}

export function LabelPill({ label }: { label: Label }) {
  const bg = `#${label.color}`;
  return (
    <span className="label" style={{ background: bg, color: labelTextColor(label.color) }}>
      {label.name}
    </span>
  );
}

export function Labels({ labels }: { labels: Label[] | undefined | null }) {
  if (!labels?.length) return null;
  return (
    <div className="wrap-flex" style={{ marginTop: 6 }}>
      {labels.map((l) => (
        <LabelPill key={l.name} label={l} />
      ))}
    </div>
  );
}

export type PullVisualState = "open" | "draft" | "merged" | "closed";

export function pullVisualState(state: PullState, isDraft: boolean): PullVisualState {
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return isDraft ? "draft" : "open";
}

export function PullStateIcon({ state, size = 16 }: { state: PullVisualState; size?: number }) {
  switch (state) {
    case "merged":
      return <GitMergeIcon size={size} className="c-done" aria-label="Merged" />;
    case "closed":
      return <GitPullRequestClosedIcon size={size} className="c-danger" aria-label="Closed" />;
    case "draft":
      return <GitPullRequestDraftIcon size={size} className="c-muted" aria-label="Draft" />;
    default:
      return <GitPullRequestIcon size={size} className="c-success" aria-label="Open" />;
  }
}

export function IssueStateIcon({ state, reason, size = 16 }: { state: IssueState; reason?: IssueStateReason; size?: number }) {
  if (state === "OPEN") return <IssueOpenedIcon size={size} className="c-success" aria-label="Open" />;
  if (reason === "NOT_PLANNED" || reason === "DUPLICATE") return <SkipIcon size={size} className="c-muted" aria-label="Closed as not planned" />;
  return <IssueClosedIcon size={size} className="c-done" aria-label="Closed" />;
}

export function StateBadge({ kind }: { kind: PullVisualState | "issue-open" | "issue-closed" | "issue-skipped" }) {
  switch (kind) {
    case "merged":
      return (
        <span className="state-badge state-merged">
          <GitMergeIcon size={14} /> Merged
        </span>
      );
    case "closed":
      return (
        <span className="state-badge state-closed">
          <GitPullRequestClosedIcon size={14} /> Closed
        </span>
      );
    case "draft":
      return (
        <span className="state-badge state-draft">
          <GitPullRequestDraftIcon size={14} /> Draft
        </span>
      );
    case "open":
      return (
        <span className="state-badge state-open">
          <GitPullRequestIcon size={14} /> Open
        </span>
      );
    case "issue-open":
      return (
        <span className="state-badge state-open">
          <IssueOpenedIcon size={14} /> Open
        </span>
      );
    case "issue-closed":
      return (
        <span className="state-badge state-completed">
          <IssueClosedIcon size={14} /> Closed
        </span>
      );
    case "issue-skipped":
      return (
        <span className="state-badge state-draft">
          <SkipIcon size={14} /> Closed
        </span>
      );
  }
}

/** Combined CI status for a commit. */
export function ChecksIcon({ state, size = 14 }: { state: StatusState | null | undefined; size?: number }) {
  switch (state) {
    case "SUCCESS":
      return <CheckIcon size={size} className="c-success" aria-label="Checks passed" />;
    case "FAILURE":
    case "ERROR":
      return <XIcon size={size} className="c-danger" aria-label="Checks failed" />;
    case "PENDING":
    case "EXPECTED":
      return <DotFillIcon size={size} className="c-attention" aria-label="Checks pending" />;
    default:
      return null;
  }
}

export function ReviewDecisionPill({ decision }: { decision: ReviewDecision }) {
  if (decision === "APPROVED")
    return (
      <span className="pill pill-success">
        <CheckIcon size={12} /> Approved
      </span>
    );
  if (decision === "CHANGES_REQUESTED")
    return (
      <span className="pill pill-danger">
        <AlertIcon size={12} /> Changes requested
      </span>
    );
  if (decision === "REVIEW_REQUIRED") return <span className="pill pill-attention">Review required</span>;
  return null;
}

export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="diffstat">
      <span className="add">+{additions}</span>
      <span className="del">−{deletions}</span>
    </span>
  );
}

export function Spinner({ small = false }: { small?: boolean }) {
  return <span className={`spinner${small ? " sm" : ""}`} role="progressbar" aria-label="Loading" />;
}

export function CenterSpinner() {
  return (
    <div className="center">
      <Spinner />
    </div>
  );
}

export function SkeletonList({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton" style={{ width: 18, height: 18, borderRadius: 9 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="skeleton" style={{ width: "40%", height: 10 }} />
            <div className="skeleton" style={{ width: `${70 + ((i * 37) % 25)}%`, height: 14 }} />
            <div className="skeleton" style={{ width: "30%", height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="center">
      <AlertIcon size={28} />
      <h2>Couldn't load this</h2>
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="center">
      {icon}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Triggers `onLoadMore` when scrolled into view (infinite lists). */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean | undefined;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onLoadMore);
  callback.current = onLoadMore;

  useEffect(() => {
    const element = ref.current;
    if (!element || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) callback.current();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore]);

  if (!hasMore) return null;
  return (
    <div className="load-more" ref={ref}>
      {loading ? (
        <Spinner />
      ) : (
        <button className="btn btn-sm" onClick={onLoadMore}>
          Load more
        </button>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; count?: number | null }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="chips" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          className={`chip${option.value === value ? " active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && option.count !== null && <span className="counter">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function ScreenTabs<T extends string>({
  value,
  tabs,
  onChange,
}: {
  value: T;
  tabs: { value: T; label: string; icon?: ReactNode; count?: number | null }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={tab.value === value}
          className={tab.value === value ? "active" : ""}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && tab.count !== null && <span className="counter">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
