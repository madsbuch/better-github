import { CopyIcon, GitBranchIcon, GitCommitIcon, KebabHorizontalIcon, LinkExternalIcon, StopIcon, SyncIcon } from "@primer/octicons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";
import { backend } from "../../lib/backend";
import { to } from "../../lib/nav";
import { useToast } from "../../lib/toast";
import type { WorkflowJob } from "../../lib/types";
import { actionsQueries, isRunning, useRunMutations } from "../../queries/actions";
import { keys } from "../../queries/keys";
import { Screen } from "../../components/Screen";
import { ActionSheet } from "../../components/Sheet";
import { Avatar, CenterSpinner, EmptyState, ErrorView, Spinner, Time } from "../../components/ui";
import { Elapsed, RunStatusIcon, isFailure, needsRerun, runStatusLabel } from "./status";

const route = getRouteApi("/$owner/$repo/actions/runs/$runId/");

export function RunScreen() {
  const { owner, repo, runId } = route.useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState(false);
  const run = useQuery(actionsQueries.run(owner, repo, runId));
  const jobs = useQuery(actionsQueries.runJobs(owner, repo, runId));
  const { rerun, rerunFailed, cancel } = useRunMutations(owner, repo);

  const data = run.data;
  const running = isRunning(data?.status);
  // GitHub re-runs failed and cancelled jobs, and a run can end "cancelled" while some jobs failed,
  // so look at the jobs too, not just the run's own conclusion.
  const canRerunFailed = needsRerun(data?.conclusion ?? null) || (jobs.data ?? []).some((j) => needsRerun(j.conclusion));
  const url = data?.html_url ?? `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
  const refresh = () => queryClient.refetchQueries({ queryKey: keys.actions.run(owner, repo, runId), type: "active" });

  return (
    <Screen
      title={data?.display_title ?? `Run ${runId}`}
      subtitle={data ? `${data.name ?? ""} #${data.run_number}` : `${owner}/${repo}`}
      actions={
        <button className="icon-btn" aria-label="More" onClick={() => setMenu(true)}>
          <KebabHorizontalIcon size={20} />
        </button>
      }
      footer={
        data ? (
          <div className="bottom-bar">
            {running ? (
              <button className="btn" disabled={cancel.isPending} onClick={() => cancel.mutate(runId)}>
                {cancel.isPending ? <Spinner small /> : <StopIcon size={16} />} Cancel run
              </button>
            ) : (
              <>
                {canRerunFailed && (
                  <button className="btn btn-primary" disabled={rerunFailed.isPending} onClick={() => rerunFailed.mutate([runId])}>
                    {rerunFailed.isPending ? <Spinner small /> : <SyncIcon size={16} />} Re-run failed
                  </button>
                )}
                <button className="btn" disabled={rerun.isPending} onClick={() => rerun.mutate(runId)}>
                  {rerun.isPending ? <Spinner small /> : <SyncIcon size={16} />} Re-run all
                </button>
              </>
            )}
          </div>
        ) : undefined
      }
      onRefresh={refresh}
    >
      {run.isPending ? (
        <CenterSpinner />
      ) : run.isError ? (
        <ErrorView error={run.error} onRetry={() => void run.refetch()} />
      ) : (
        <>
          <div className="detail-header">
            <div className="row-flex" style={{ gap: 8 }}>
              <RunStatusIcon status={run.data.status} conclusion={run.data.conclusion} size={20} />
              <strong>{runStatusLabel(run.data.status, run.data.conclusion)}</strong>
              <span className="muted">
                · <Elapsed start={run.data.run_started_at} end={run.data.updated_at} running={running} />
              </span>
              {(run.data.run_attempt ?? 1) > 1 && <span className="pill">Attempt {run.data.run_attempt}</span>}
            </div>
            <div className="row-flex small muted" style={{ marginTop: 10, flexWrap: "wrap" }}>
              {run.data.actor && <Avatar src={run.data.actor.avatar_url} size={18} />}
              <span>
                {run.data.actor?.login ?? "Someone"} triggered via {run.data.event.replace(/_/g, " ")} <Time iso={run.data.run_started_at ?? run.data.created_at} />
              </span>
            </div>
            <div className="row-flex small" style={{ marginTop: 8, flexWrap: "wrap" }}>
              {run.data.head_branch !== null && run.data.head_branch !== "" && (
                <span className="branch">
                  <GitBranchIcon size={12} /> {run.data.head_branch}
                </span>
              )}
              <Link {...to.commit(owner, repo, run.data.head_sha)} className="pill mono">
                <GitCommitIcon size={12} /> {run.data.head_sha.slice(0, 7)}
              </Link>
              {run.data.pull_requests?.map((pr) => (
                <Link key={pr.number} {...to.pull(owner, repo, pr.number)} className="pill">
                  #{pr.number}
                </Link>
              ))}
            </div>
          </div>
          <div className="group-header">Jobs</div>
          {jobs.isPending ? (
            <CenterSpinner />
          ) : jobs.isError ? (
            <ErrorView error={jobs.error} onRetry={() => void jobs.refetch()} />
          ) : jobs.data.length === 0 ? (
            <EmptyState title="No jobs yet">Jobs appear once the run starts.</EmptyState>
          ) : (
            jobs.data.map((job) => <JobRow key={job.id} owner={owner} repo={repo} runId={runId} job={job} />)
          )}
        </>
      )}
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title="Workflow run"
        actions={[
          { label: "Open in browser", icon: <LinkExternalIcon size={18} />, onSelect: () => void backend.openUrl(url) },
          { label: "Copy link", icon: <CopyIcon size={18} />, onSelect: () => void backend.copyText(url).then(() => toast.show("Link copied")) },
        ]}
      />
    </Screen>
  );
}

function JobRow({ owner, repo, runId, job }: { owner: string; repo: string; runId: number; job: WorkflowJob }) {
  const running = isRunning(job.status);
  const failed = isFailure(job.conclusion);
  // A failed job's first errors, so you often don't need to open the log at all.
  const annotations = useQuery({ ...actionsQueries.annotations(owner, repo, job.id), enabled: failed });
  const errors = (annotations.data ?? []).filter((a) => a.annotation_level === "failure").slice(0, 2);
  const currentStep = running ? job.steps?.find((s) => s.status === "in_progress") : undefined;
  return (
    <Link {...to.job(owner, repo, runId, job.id)} preload="viewport" className="row">
      <span className="row-icon">
        <RunStatusIcon status={job.status} conclusion={job.conclusion} />
      </span>
      <span className="row-body">
        <span className="bold" style={{ display: "block", overflowWrap: "anywhere" }}>
          {job.name}
        </span>
        <span className="muted small">
          {currentStep ? `${currentStep.name} · ` : `${runStatusLabel(job.status, job.conclusion)} · `}
          <Elapsed start={job.started_at} end={job.completed_at} running={running} />
        </span>
        {errors.map((a, i) => (
          <span key={i} className="annotation small" style={{ display: "block" }}>
            {a.message}
          </span>
        ))}
      </span>
    </Link>
  );
}
