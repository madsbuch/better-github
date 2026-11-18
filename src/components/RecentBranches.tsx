import { GitBranchIcon, GitPullRequestIcon, XIcon } from "@primer/octicons-react";
import { Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { z } from "zod";
import { splitRepo, to } from "../lib/nav";
import { sameRepo, type RecentBranch } from "../lib/newPull";
import { parseJson } from "../lib/schema";
import { Time } from "./ui";

// Prompts the user dismissed, by repository, branch and tip commit, so a new
// push to the branch brings its prompt back.
const KEY = "ghc.dismissed-branches";
const listeners = new Set<() => void>();
let dismissed: string[] = load();

function load(): string[] {
  try {
    return parseJson(z.array(z.string()), window.localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

function dismiss(id: string) {
  dismissed = [...dismissed, id].slice(-100);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(dismissed));
  } catch {
    // In-memory only.
  }
  listeners.forEach((l) => l());
}

function useDismissed(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => dismissed,
  );
}

const promptId = (b: RecentBranch) => `${b.head.repo}:${b.head.branch}@${b.oid}`.toLowerCase();

/** "Compare & pull request" for branches the viewer pushed lately. */
export function RecentBranchPrompts({ branches, showRepo = true, limit = 3 }: { branches: RecentBranch[]; showRepo?: boolean; limit?: number }) {
  const hidden = useDismissed();
  const visible = branches.filter((b) => !hidden.includes(promptId(b))).slice(0, limit);
  if (visible.length === 0) return null;
  return (
    <div className="branch-prompts">
      {visible.map((b) => (
        <BranchPrompt key={promptId(b)} branch={b} showRepo={showRepo} onDismiss={() => dismiss(promptId(b))} />
      ))}
    </div>
  );
}

function BranchPrompt({ branch, showRepo, onDismiss }: { branch: RecentBranch; showRepo: boolean; onDismiss: () => void }) {
  const [owner, repo] = splitRepo(branch.baseRepo);
  const fromFork = !sameRepo(branch.baseRepo, branch.head.repo);
  return (
    <div className="branch-prompt">
      <div className="row-flex" style={{ gap: 6 }}>
        <GitBranchIcon size={14} className="c-muted" />
        <span className="mono bold ellipsis">{branch.head.branch}</span>
        <span className="muted small nowrap">
          · <Time iso={branch.committedDate} />
        </span>
        <span className="grow" />
        <button className="icon-btn sm" aria-label={`Dismiss ${branch.head.branch}`} onClick={onDismiss}>
          <XIcon size={14} />
        </button>
      </div>
      {showRepo && (
        <div className="muted small ellipsis">
          {fromFork ? `${branch.head.repo} → ${branch.baseRepo}` : branch.baseRepo}
        </div>
      )}
      {branch.headline !== "" && <div className="small ellipsis">{branch.headline}</div>}
      <Link
        {...to.compare(owner, repo, { base: branch.base ?? undefined, head: branch.head.branch, from: fromFork ? branch.head.repo : undefined })}
        preload="viewport"
        className="btn btn-sm btn-primary"
      >
        <GitPullRequestIcon size={14} /> Compare &amp; pull request
      </Link>
    </div>
  );
}
