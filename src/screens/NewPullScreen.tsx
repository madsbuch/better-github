import {
  ArrowLeftIcon,
  CheckCircleIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  PersonAddIcon,
  RepoForkedIcon,
  TriangleDownIcon,
  XIcon,
} from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ApiError, errorMessage } from "../lib/api";
import { splitRepo, to, useNav, type CompareSearch } from "../lib/nav";
import { sameRepo, suggestedBody, suggestedTitle } from "../lib/newPull";
import { usePrefs } from "../lib/prefs";
import { useViewer } from "../lib/session";
import { toast } from "../lib/toast";
import type { AssignableUser, RestComparison } from "../lib/types";
import { useBranches } from "../queries/branches";
import { newPullQueries, useCreatePull, type Comparison } from "../queries/newPull";
import { DiffFile } from "../components/DiffView";
import { Markdown } from "../components/Markdown";
import { BranchSheet } from "../components/BranchSheet";
import { CommitRow } from "../components/RepoParts";
import { ReviewerSheet } from "../components/ReviewerSheet";
import { Screen } from "../components/Screen";
import { ActionSheet } from "../components/Sheet";
import { Avatar, DiffStat, EmptyState, ErrorView, ScreenTabs, SkeletonList, Spinner, Time } from "../components/ui";

const route = getRouteApi("/$owner/$repo/compare");

type Pane = "write" | "commits" | "files";

/** Open a pull request: pick the branches, check what goes in, describe it. */
export function NewPullScreen() {
  const { owner, repo } = route.useParams();
  const search = route.useSearch();
  const nav = useNav();
  const baseRepo = `${owner}/${repo}`;
  const headRepo = search.from ?? baseRepo;
  const [headOwner, headName] = splitRepo(headRepo);
  const fromFork = !sameRepo(baseRepo, headRepo);

  const context = useQuery(newPullQueries.context(owner, repo));
  const ctx = context.data;
  const base = search.base ?? ctx?.defaultBranchRef?.name;
  const head = search.head;
  const compare = useQuery({
    ...newPullQueries.compare(owner, repo, base ?? "", { repo: headRepo, branch: head ?? "" }),
    enabled: !!base && !!head,
  });
  const headBranches = useQuery(newPullQueries.repoBranches(headOwner, headName));
  const [sheet, setSheet] = useState<null | "base" | "head" | "repos">(null);
  // Every branch loads while you're here, so both pickers open ready to search.
  useBranches(owner, repo, { loadAll: true });
  useBranches(headOwner, headName, { loadAll: true });

  const update = (next: CompareSearch) =>
    nav.replace(to.compare(owner, repo, { base: search.base, head: search.head, from: search.from, tab: search.tab, ...next }));
  const comparison = compare.data?.comparison;
  const ready = !!comparison && comparison.ahead_by > 0 && !compare.data?.existing;
  const pane: Pane = ready ? (search.tab ?? "write") : "write";

  // Other places this pull request could come from or go to.
  const repoChoices = [
    ...[baseRepo, ...(ctx?.forks.nodes.map((f) => f.nameWithOwner) ?? [])]
      .filter((r) => !sameRepo(r, headRepo))
      .map((r) => ({
        label: `Compare from ${r}`,
        icon: <RepoForkedIcon size={18} />,
        onSelect: () => update({ from: sameRepo(r, baseRepo) ? undefined : r, head: undefined }),
      })),
    ...(ctx?.parent && !fromFork
      ? [
          {
            label: `Open into ${ctx.parent.nameWithOwner}`,
            icon: <GitPullRequestIcon size={18} />,
            onSelect: () => nav.replace(to.compare(...splitRepo(ctx.parent!.nameWithOwner), { head, from: baseRepo })),
          },
        ]
      : []),
  ];

  return (
    <Screen
      title="Open a pull request"
      subtitle={baseRepo}
      header={
        <>
          <div className="compare-bar">
            <button className="btn btn-sm" onClick={() => setSheet("base")} aria-label="Base branch">
              <span className="muted">into</span>
              <span className="mono ellipsis">{base ?? "…"}</span>
              <TriangleDownIcon size={14} />
            </button>
            <ArrowLeftIcon size={14} className="c-muted" />
            <button className="btn btn-sm" onClick={() => setSheet("head")} aria-label="Branch to compare">
              <span className="muted">from</span>
              <span className="mono ellipsis">{head ? `${fromFork ? `${headOwner}:` : ""}${head}` : "…"}</span>
              <TriangleDownIcon size={14} />
            </button>
            {repoChoices.length > 0 && (
              <button className="icon-btn sm" aria-label="Repositories" onClick={() => setSheet("repos")}>
                <RepoForkedIcon size={16} />
              </button>
            )}
          </div>
          {ready && comparison && (
            <ScreenTabs
              value={pane}
              onChange={(tab) => update({ tab: tab === "write" ? undefined : tab })}
              tabs={[
                { value: "write", label: "Pull request" },
                { value: "commits", label: "Commits", count: comparison.total_commits },
                { value: "files", label: "Files", count: comparison.files?.length ?? 0 },
              ]}
            />
          )}
        </>
      }
    >
      {context.isError ? (
        <ErrorView error={context.error} onRetry={() => void context.refetch()} />
      ) : !head ? (
        <ChooseBranch
          branches={(headBranches.data?.refs?.nodes ?? []).filter((b) => fromFork || b.name !== base)}
          loading={headBranches.isPending}
          onPick={(branch) => update({ head: branch })}
          onBrowse={() => setSheet("head")}
        />
      ) : compare.isPending || !base ? (
        <SkeletonList rows={4} />
      ) : compare.isError ? (
        ApiError.from(compare.error).status === 404 ? (
          <EmptyState title="Branch not found">
            {head} or {base} doesn't exist{fromFork ? ` in ${headRepo}` : ""} anymore.
          </EmptyState>
        ) : (
          <ErrorView error={compare.error} onRetry={() => void compare.refetch()} />
        )
      ) : compare.data.existing ? (
        <ExistingPull owner={owner} repo={repo} pull={compare.data.existing} />
      ) : comparison!.ahead_by === 0 ? (
        <EmptyState icon={<CheckCircleIcon size={32} />} title="Nothing to compare">
          {base} already has every commit from {head}. Pick another branch to compare.
        </EmptyState>
      ) : pane === "commits" ? (
        comparison!.commits.map((c) => <CommitRow key={c.sha} owner={headOwner} repo={headName} commit={c} />)
      ) : pane === "files" ? (
        <Files comparison={comparison!} />
      ) : (
        <PullForm
          // A draft per pair of branches, restored when you come back to it.
          key={`${baseRepo}:${base}...${headRepo}:${head}`.toLowerCase()}
          owner={owner}
          repo={repo}
          base={base}
          head={head}
          headRepo={headRepo}
          compared={compare.data}
          template={ctx?.pullRequestTemplates?.[0]?.body ?? null}
        />
      )}

      <BranchSheet
        open={sheet === "base"}
        onClose={() => setSheet(null)}
        owner={owner}
        repo={repo}
        current={base}
        title={`Merge into (${baseRepo})`}
        onSelect={(branch) => update({ base: branch })}
      />
      <BranchSheet
        open={sheet === "head"}
        onClose={() => setSheet(null)}
        owner={headOwner}
        repo={headName}
        current={head}
        title={`Compare (${headRepo})`}
        onSelect={(branch) => update({ head: branch })}
      />
      <ActionSheet open={sheet === "repos"} onClose={() => setSheet(null)} title="Repositories" actions={repoChoices} />
    </Screen>
  );
}

function ChooseBranch({
  branches,
  loading,
  onPick,
  onBrowse,
}: {
  branches: { name: string; target: { committedDate?: string; messageHeadline?: string } | null; associatedPullRequests: { totalCount: number } }[];
  loading: boolean;
  onPick: (branch: string) => void;
  onBrowse: () => void;
}) {
  return (
    <>
      <div className="group-header">Recently updated branches</div>
      {loading ? (
        <SkeletonList rows={3} />
      ) : (
        branches.map((b) => (
          <button key={b.name} className="row" onClick={() => onPick(b.name)}>
            <span className="row-icon">
              <GitBranchIcon size={16} />
            </span>
            <span className="row-body">
              <span className="mono bold" style={{ display: "block", overflowWrap: "anywhere" }}>
                {b.name}
              </span>
              <span className="row-meta">
                {b.target?.committedDate && <Time iso={b.target.committedDate} />}
                {b.associatedPullRequests.totalCount > 0 && <span className="pill">Has an open pull request</span>}
              </span>
              {b.target?.messageHeadline && (
                <span className="muted small ellipsis" style={{ display: "block" }}>
                  {b.target.messageHeadline}
                </span>
              )}
            </span>
          </button>
        ))
      )}
      <div className="center" style={{ paddingTop: 12 }}>
        <button className="btn" onClick={onBrowse}>
          All branches…
        </button>
      </div>
    </>
  );
}

function ExistingPull({ owner, repo, pull }: { owner: string; repo: string; pull: NonNullable<Comparison["existing"]> }) {
  return (
    <div className="pad stack-v">
      <div className="banner" style={{ margin: 0 }}>
        A pull request is already open for these branches.
      </div>
      <Link {...to.pull(owner, repo, pull.number)} className="card row" style={{ color: "inherit" }}>
        <span className="row-icon">
          <GitPullRequestIcon size={16} className="c-success" />
        </span>
        <span className="row-body">
          <span className="bold" style={{ display: "block" }}>
            {pull.title} <span className="muted">#{pull.number}</span>
          </span>
          <span className="muted small">
            opened <Time iso={pull.created_at} /> by {pull.user?.login ?? "ghost"}
          </span>
        </span>
      </Link>
    </div>
  );
}

function Files({ comparison }: { comparison: RestComparison }) {
  const prefs = usePrefs();
  const files = comparison.files ?? [];
  // Long comparisons start collapsed; tap a file to open it.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const startOpen = files.length <= 10;
  return (
    <>
      {files.map((f) => (
        <DiffFile
          key={f.filename}
          file={{
            filename: f.filename,
            previousFilename: f.previous_filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch,
          }}
          wrap={prefs.wrapDiff}
          collapsed={!(open[f.filename] ?? startOpen)}
          onToggleCollapsed={() => setOpen((o) => ({ ...o, [f.filename]: !(o[f.filename] ?? startOpen) }))}
        />
      ))}
    </>
  );
}

// ------------------------------------------------------------------- form

interface FormState {
  title: string;
  body: string;
  draft: boolean;
  reviewers: AssignableUser[];
  /** Typed into (rather than prefilled), so it's worth keeping. */
  edited: boolean;
}

const EMPTY: FormState = { title: "", body: "", draft: false, reviewers: [], edited: false };

function loadDraft(key: string): FormState | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<FormState>), edited: true } : null;
  } catch {
    return null;
  }
}

function PullForm({
  owner,
  repo,
  base,
  head,
  headRepo,
  compared,
  template,
}: {
  owner: string;
  repo: string;
  base: string;
  head: string;
  headRepo: string;
  compared: Comparison;
  template: string | null;
}) {
  const viewer = useViewer();
  const nav = useNav();
  const create = useCreatePull(owner, repo);
  const storageKey = `ghc.new-pull.${owner}/${repo}:${base}...${headRepo}:${head}`.toLowerCase();
  const { comparison } = compared;
  const [form, setForm] = useState<FormState>(
    () =>
      loadDraft(storageKey) ?? {
        ...EMPTY,
        title: suggestedTitle(head, comparison.commits),
        body: suggestedBody(template, comparison.commits),
      },
  );
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [reviewersOpen, setReviewersOpen] = useState(false);
  const preview = useQuery({ ...newPullQueries.markdown(owner, repo, form.body), enabled: mode === "preview" && !!form.body.trim() });

  // Keep what was typed until the pull request is open (or the text is cleared).
  useEffect(() => {
    if (!form.edited) return;
    try {
      const { title, body, draft, reviewers } = form;
      window.localStorage.setItem(storageKey, JSON.stringify({ title, body, draft, reviewers }));
    } catch {
      // Storage unavailable: the draft lives as long as the screen.
    }
  }, [form, storageKey]);

  const change = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch, edited: true }));
  const files = comparison.files ?? [];
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);

  const submit = () =>
    create.mutate(
      { base, head: { repo: headRepo, branch: head }, title: form.title, body: form.body, draft: form.draft, reviewers: form.reviewers.map((u) => u.login) },
      {
        onSuccess: ({ number, reviewersError }) => {
          try {
            window.localStorage.removeItem(storageKey);
          } catch {
            // Nothing to clean up.
          }
          if (reviewersError) toast.show(`Opened, but requesting reviews failed: ${errorMessage(reviewersError)}`, "error");
          // The new pull request takes this screen's place: back returns to where you came from.
          nav.replace(to.pull(owner, repo, number));
        },
      },
    );

  return (
    <div className="pad stack-v new-pull">
      <div className="row-flex small" style={{ flexWrap: "wrap" }}>
        <CheckCircleIcon size={14} className="c-success" />
        <span>
          {comparison.total_commits} commit{comparison.total_commits === 1 ? "" : "s"} · {files.length} file{files.length === 1 ? "" : "s"}
        </span>
        <DiffStat additions={additions} deletions={deletions} />
        {comparison.behind_by > 0 && (
          <span className="c-attention">
            · {comparison.behind_by} commit{comparison.behind_by === 1 ? "" : "s"} behind {base}
          </span>
        )}
      </div>
      <div>
        <label className="field-label" htmlFor="pull-title">
          Title
        </label>
        <input id="pull-title" className="input" value={form.title} onChange={(e) => change({ title: e.target.value })} />
      </div>
      <div>
        <div className="row-flex" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <label className="field-label" htmlFor="pull-body" style={{ margin: 0 }}>
            Description
          </label>
          <span className="row-flex" style={{ gap: 6 }} role="tablist">
            {(["write", "preview"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={`chip${mode === m ? " active" : ""}`} onClick={() => setMode(m)}>
                {m === "write" ? "Write" : "Preview"}
              </button>
            ))}
          </span>
        </div>
        {mode === "write" ? (
          <textarea
            id="pull-body"
            className="textarea"
            style={{ minHeight: 200 }}
            placeholder="Describe the change (Markdown supported)"
            value={form.body}
            onChange={(e) => change({ body: e.target.value })}
          />
        ) : !form.body.trim() ? (
          <p className="muted small">Nothing to preview.</p>
        ) : preview.isPending ? (
          <div className="center">
            <Spinner />
          </div>
        ) : preview.isError ? (
          <ErrorView error={preview.error} onRetry={() => void preview.refetch()} />
        ) : (
          <div className="card pad">
            <Markdown html={preview.data} />
          </div>
        )}
      </div>
      <div>
        <div className="field-label">Reviewers</div>
        <div className="wrap-flex">
          {form.reviewers.map((user) => (
            <span key={user.login} className="chip active">
              <Avatar src={user.avatarUrl} size={16} />
              {user.login}
              <button
                className="icon-btn sm"
                aria-label={`Remove ${user.login}`}
                onClick={() => change({ reviewers: form.reviewers.filter((u) => u.login !== user.login) })}
              >
                <XIcon size={12} />
              </button>
            </span>
          ))}
          <button className="chip" onClick={() => setReviewersOpen(true)}>
            <PersonAddIcon size={14} /> {form.reviewers.length ? "Add" : "Request reviews"}
          </button>
        </div>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={form.draft} onChange={(e) => change({ draft: e.target.checked })} />
        Open as a draft (not ready for review yet)
      </label>
      <button className="btn btn-primary btn-block" disabled={!form.title.trim() || create.isPending} onClick={submit}>
        {create.isPending ? <Spinner small /> : <GitPullRequestIcon size={16} />} {form.draft ? "Create draft pull request" : "Create pull request"}
      </button>
      <ReviewerSheet
        open={reviewersOpen}
        onClose={() => setReviewersOpen(false)}
        owner={owner}
        repo={repo}
        selected={form.reviewers}
        onChange={(reviewers) => change({ reviewers })}
        exclude={viewer.login}
      />
    </div>
  );
}
