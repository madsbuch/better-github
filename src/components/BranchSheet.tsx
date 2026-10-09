import { GitBranchIcon, SearchIcon } from "@primer/octicons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { searchBranches, type Branch, type BranchMatch, type Range } from "../lib/branchSearch";
import { useBranches } from "../queries/branches";
import { Sheet } from "./Sheet";
import { EmptyState, ErrorView, SkeletonList, Time } from "./ui";

/** Matches shown at once; typing narrows down the rest. */
const SHOWN = 100;

/**
 * Picks a branch of owner/repo. The list is usually loaded before it opens
 * (the screens showing it preload it); typing ranks every branch, the
 * closest match first, and Enter picks the top one.
 */
export function BranchSheet({
  open,
  onClose,
  owner,
  repo,
  current,
  onSelect,
  title = "Switch branch",
}: {
  open: boolean;
  onClose: () => void;
  owner: string;
  repo: string;
  current: string | undefined;
  onSelect: (ref: string) => void;
  title?: string;
}) {
  const [filter, setFilter] = useState("");
  // Opens with an empty search each time.
  useEffect(() => {
    if (!open) setFilter("");
  }, [open]);
  const list = useBranches(owner, repo, { loadAll: open, query: open ? filter : "" });
  const { defaultBranch } = list;

  const matches = useMemo(() => {
    if (!open) return [];
    const branches: Branch[] = list.branches;
    // The default branch may be old enough not to be loaded yet; it's always offered.
    const all = defaultBranch && !branches.some((b) => b.name === defaultBranch) ? [...branches, { name: defaultBranch, committedDate: null }] : branches;
    const isBranch = !!current && (current === defaultBranch || branches.some((b) => b.name === current));
    const pinned = [defaultBranch, isBranch ? current : null].filter((name): name is string => !!name);
    return searchBranches(all, filter, pinned);
  }, [open, list.branches, defaultBranch, current, filter]);

  // Each change to the search shows its best matches from the top.
  const searchRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    searchRef.current?.closest(".sheet-body")?.scrollTo({ top: 0 });
  }, [filter]);

  const pick = (name: string) => {
    onClose();
    onSelect(name);
  };
  const typed = filter.trim();

  return (
    <Sheet open={open} onClose={onClose} title={title} full>
      <form
        ref={searchRef}
        role="search"
        className="sheet-search"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed && matches[0]) pick(matches[0].branch.name);
        }}
      >
        <div className="search-bar">
          <SearchIcon size={16} />
          <input
            type="search"
            placeholder="Find a branch"
            aria-label="Find a branch"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
        </div>
      </form>
      {list.pending ? (
        <SkeletonList rows={8} />
      ) : list.error && list.loaded === 0 ? (
        <ErrorView error={list.error} onRetry={list.retry} />
      ) : (
        <>
          {matches.slice(0, SHOWN).map((match) => (
            <BranchRow
              key={match.branch.name}
              match={match}
              isDefault={match.branch.name === defaultBranch}
              isCurrent={match.branch.name === current}
              onPick={pick}
            />
          ))}
          {typed && matches.length === 0 && !list.searching && (
            <EmptyState icon={<GitBranchIcon size={32} />} title={`No branches match “${typed}”`} />
          )}
          <SheetNote>
            {matches.length > SHOWN
              ? `${(matches.length - SHOWN).toLocaleString()} more. Type to narrow them down.`
              : list.searching
                ? "Searching all branches…"
                : list.loadingMore
                  ? `Loading branches… ${list.loaded.toLocaleString()} of ${list.total.toLocaleString()}`
                  : null}
          </SheetNote>
        </>
      )}
    </Sheet>
  );
}

function SheetNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="muted small" style={{ textAlign: "center", margin: "12px 16px" }}>
      {children}
    </p>
  );
}

function BranchRow({ match, isDefault, isCurrent, onPick }: { match: BranchMatch; isDefault: boolean; isCurrent: boolean; onPick: (name: string) => void }) {
  const { branch, ranges } = match;
  return (
    <button className="menu-item branch-item" onClick={() => onPick(branch.name)}>
      <GitBranchIcon size={16} />
      <span className="grow" style={{ minWidth: 0 }}>
        <span className={`branch-name mono${isCurrent ? " bold" : ""}`}>
          <Highlighted text={branch.name} ranges={ranges} />
        </span>
        {branch.committedDate && (
          <span className="muted small">
            <Time iso={branch.committedDate} />
          </span>
        )}
      </span>
      {isDefault && <span className="pill">default</span>}
      {isCurrent && <span className="pill pill-accent">current</span>}
    </button>
  );
}

function Highlighted({ text, ranges }: { text: string; ranges: Range[] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
