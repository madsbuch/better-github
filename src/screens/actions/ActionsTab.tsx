import { GitBranchIcon, PlayIcon } from "@primer/octicons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { to, useNav, type RunStatusFilter } from "../../lib/nav";
import type { WorkflowRun } from "../../lib/types";
import { actionsQueries, isRunning } from "../../queries/actions";
import { Avatar, EmptyState, ErrorView, LoadMore, Segmented, SkeletonList, Time } from "../../components/ui";
import { Elapsed, RunStatusIcon } from "./status";

const EVENTS: Record<string, string> = {
  push: "Push",
  pull_request: "Pull request",
  pull_request_target: "Pull request",
  workflow_dispatch: "Manual",
  schedule: "Scheduled",
  release: "Release",
  merge_group: "Merge queue",
};

/** A repository's workflow runs, newest first, with workflow and status filters. */
export function ActionsTab({
  owner,
  repo,
  workflow,
  status,
}: {
  owner: string;
  repo: string;
  workflow?: number | undefined;
  status?: RunStatusFilter | undefined;
}) {
  const nav = useNav();
  const workflows = useQuery(actionsQueries.workflows(owner, repo));
  const runs = useInfiniteQuery(actionsQueries.runs(owner, repo, { workflow, status }));
  const items = runs.data?.pages.flatMap((p) => p.items) ?? [];
  const active = (workflows.data?.workflows ?? []).filter((w) => w.state === "active");
  // 0 is not a workflow id: it means no filter, like a missing one.
  const noWorkflow = workflow === undefined || workflow === 0;
  const filter = (next: { workflow?: number | undefined; status?: RunStatusFilter | undefined }) =>
    nav.replace(to.repo(owner, repo, { tab: "actions", workflow, status, ...next }));

  return (
    <>
      <Segmented
        value={status ?? "all"}
        onChange={(value) => filter({ status: value === "all" ? undefined : value })}
        options={[
          { value: "all", label: "All runs" },
          { value: "in_progress", label: "Running" },
          { value: "failure", label: "Failed" },
        ]}
      />
      {active.length > 1 && (
        <div className="chips" role="tablist" aria-label="Workflows">
          <button role="tab" aria-selected={noWorkflow} className={`chip${noWorkflow ? " active" : ""}`} onClick={() => filter({ workflow: undefined })}>
            All workflows
          </button>
          {active.map((w) => (
            <button
              key={w.id}
              role="tab"
              aria-selected={workflow === w.id}
              className={`chip${workflow === w.id ? " active" : ""}`}
              onClick={() => filter({ workflow: w.id })}
            >
              {w.name}
            </button>
          ))}
        </div>
      )}
      {runs.isPending ? (
        <SkeletonList />
      ) : runs.isError ? (
        <ErrorView error={runs.error} onRetry={() => void runs.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<PlayIcon size={32} />} title="No workflow runs">
          {status === "in_progress" ? "Nothing is running right now." : status === "failure" ? "No failed runs." : "This repository hasn't run any workflows."}
        </EmptyState>
      ) : (
        <>
          {items.map((run) => (
            <RunRow key={run.id} owner={owner} repo={repo} run={run} />
          ))}
          <LoadMore hasMore={runs.hasNextPage} loading={runs.isFetchingNextPage} onLoadMore={() => void runs.fetchNextPage()} />
        </>
      )}
    </>
  );
}

function RunRow({ owner, repo, run }: { owner: string; repo: string; run: WorkflowRun }) {
  const running = isRunning(run.status);
  return (
    <Link {...to.run(owner, repo, run.id)} preload="viewport" className="row">
      <span className="row-icon">
        <RunStatusIcon status={run.status} conclusion={run.conclusion} />
      </span>
      <span className="row-body">
        <span className="row-meta">
          <span className="ellipsis">
            {run.name} #{run.run_number}
          </span>
          <span>·</span>
          <span className="nowrap">
            <Time iso={run.run_started_at ?? run.created_at} />
          </span>
        </span>
        <span className="row-title" style={{ display: "block" }}>
          {run.display_title}
        </span>
        <span className="row-stats">
          {run.head_branch !== null && run.head_branch !== "" && (
            <span className="branch ellipsis" style={{ maxWidth: "50%" }}>
              <GitBranchIcon size={12} /> {run.head_branch}
            </span>
          )}
          <span>{EVENTS[run.event] ?? run.event.replace(/_/g, " ")}</span>
          <Elapsed start={run.run_started_at} end={run.updated_at} running={running} />
        </span>
      </span>
      {run.actor && (
        <span className="row-trailing">
          <Avatar src={run.actor.avatar_url} size={24} alt={run.actor.login} />
        </span>
      )}
    </Link>
  );
}
