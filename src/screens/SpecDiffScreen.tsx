import { ArrowLeftIcon, GitBranchIcon, GitCompareIcon, LockIcon, TriangleDownIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { to, useNav } from "../lib/nav";
import { useIsGuest } from "../lib/session";
import { SPEC_DIR } from "../lib/spec";
import type { ItemChange } from "../lib/specDiff";
import { repoQueries } from "../queries/repos";
import { useSpecDiff } from "../queries/spec";
import { BranchSheet } from "../components/BranchSheet";
import { Screen } from "../components/Screen";
import { reconcileFor, SpecChangeCard, SpecChangesSummary, SpecLayoutButton } from "../components/SpecChanges";
import { CenterSpinner, EmptyState, ErrorView, LoadMore, SkeletonList } from "../components/ui";

const route = getRouteApi("/$owner/$repo/spec-diff");

type Filter = "all" | "weakened" | ItemChange["kind"];
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "weakened", label: "Takes away" },
  { value: "added", label: "Added" },
  { value: "changed", label: "Changed" },
  { value: "moved", label: "Moved" },
  { value: "removed", label: "Removed" },
];
const promisesLess = (item: ItemChange) => item.weakened !== null || item.requirements.some((r) => r.weakened !== null);

/** Cards are shown this many at a time: a comparison can touch thousands of items. */
const PAGE = 50;

/** What changed in a repository's spec between two branches, by item and requirement. */
export function SpecDiffScreen() {
  const { owner, repo } = route.useParams();
  const search = route.useSearch();
  const nav = useNav();
  const guest = useIsGuest();
  const [picking, setPicking] = useState<"base" | "head" | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);

  // Only needed for the default branch, when no base is given.
  const detail = useQuery({ ...repoQueries.detail(owner, repo), enabled: search.base === undefined });
  const base = search.base ?? detail.data?.repository?.defaultBranchRef?.name ?? "";
  const head = search.head ?? "";
  const { before, after, diff, error, retry } = useSpecDiff(owner, repo, guest ? "" : base, guest ? "" : head);
  const items = diff === null ? [] : diff.items.filter((item) => filter === "all" || (filter === "weakened" ? promisesLess(item) : item.kind === filter));
  const count = (value: Filter) =>
    diff === null ? 0 : value === "all" ? diff.items.length : value === "weakened" ? diff.items.filter(promisesLess).length : diff.counts.items[value];

  const show = (id: string) => {
    // It may be filtered out, or further down than what's shown.
    setFilter("all");
    setShown(Math.max(shown, (diff?.items.findIndex((item) => item.id === id) ?? 0) + 1));
    window.setTimeout(() => document.querySelector(`.screen .spec-change[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" }), 80);
  };

  return (
    <Screen title="Spec changes" subtitle={`${owner}/${repo}`} onRefresh={async () => retry()} actions={<SpecLayoutButton />}>
      {guest ? (
        <EmptyState icon={<LockIcon size={32} />} title="Sign in to compare specs">
          Reading a repository's {SPEC_DIR} folder needs a GitHub account.
        </EmptyState>
      ) : base === "" ? (
        detail.isError ? (
          <ErrorView error={detail.error} onRetry={() => void detail.refetch()} />
        ) : detail.isPending ? (
          <CenterSpinner />
        ) : (
          <EmptyState title="This repository is empty" />
        )
      ) : (
        <>
          <div className="spec-diff-refs">
            <RefButton label="Base" value={base} onClick={() => setPicking("base")} />
            <ArrowLeftIcon size={16} className="c-muted" />
            <RefButton label="Compare" value={head} onClick={() => setPicking("head")} />
          </div>
          <BranchSheet
            open={picking !== null}
            onClose={() => setPicking(null)}
            owner={owner}
            repo={repo}
            current={picking === "base" ? base : head}
            title={picking === "base" ? "Base: the spec to compare against" : "Compare: the spec with the changes"}
            onSelect={(ref) => nav.replace(picking === "base" ? to.specDiff(owner, repo, ref, search.head) : to.specDiff(owner, repo, search.base, ref))}
          />
          {head === "" ? (
            <EmptyState icon={<GitCompareIcon size={32} />} title="Pick a branch to compare">
              See what its spec changes compared to {base}.
            </EmptyState>
          ) : error ? (
            <ErrorView error={error} onRetry={retry} />
          ) : diff === null ? (
            <SkeletonList />
          ) : before.spec === null && after.spec === null ? (
            <EmptyState title="No spec on either side">
              Neither {base} nor {head} has a <span className="mono">{SPEC_DIR}</span> folder.
            </EmptyState>
          ) : diff.items.length === 0 ? (
            <EmptyState title="The specs are the same">
              {head} changes nothing in the spec of {base}.
            </EmptyState>
          ) : (
            <>
              {(before.spec === null || after.spec === null) && (
                <div className="banner">
                  {before.spec === null ? `${base} has no spec: all of it is new on ${head}.` : `${head} has no spec: all of it is removed.`}
                </div>
              )}
              <SpecChangesSummary diff={diff} onShow={show} reconcile={reconcileFor(diff, before.spec, after.spec, { owner, repo, gitRef: head })} />
              {(before.contentsError ?? after.contentsError) !== null && (
                <div className="banner banner-danger">
                  <span className="grow">Some items couldn't be read.</span>
                  <button className="btn btn-sm" onClick={retry}>
                    Retry
                  </button>
                </div>
              )}
              {diff.items.length > 1 && (
                <div className="chips" role="radiogroup" aria-label="Show">
                  {FILTERS.filter((option) => option.value === "all" || count(option.value) > 0).map((option) => (
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
                      {option.label} <span className="counter">{count(option.value)}</span>
                    </button>
                  ))}
                </div>
              )}
              {items.slice(0, shown).map((item) => (
                <SpecChangeCard key={item.id} change={item} sides={{ owner, repo, base, head }} />
              ))}
              <LoadMore hasMore={items.length > shown} loading={false} onLoadMore={() => setShown(shown + PAGE)} />
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function RefButton({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button className="btn btn-sm spec-diff-ref" onClick={onClick} aria-label={`${label}: ${value !== "" ? value : "pick a branch"}`}>
      <GitBranchIcon size={14} />
      <span className="ellipsis mono">{value !== "" ? value : "Pick a branch"}</span>
      <TriangleDownIcon size={14} />
    </button>
  );
}
