import { ChevronDownIcon, ChevronRightIcon, CopyIcon, KebabHorizontalIcon, LinkExternalIcon, StopIcon, SyncIcon } from "@primer/octicons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ApiError } from "../../lib/api";
import { backend } from "../../lib/backend";
import { parseLog, splitBySteps } from "../../lib/logs";
import { useToast } from "../../lib/toast";
import type { WorkflowStep } from "../../lib/types";
import { actionsQueries, isRunning, useRunMutations } from "../../queries/actions";
import { keys } from "../../queries/keys";
import { LogView } from "../../components/LogView";
import { Screen } from "../../components/Screen";
import { ActionSheet } from "../../components/Sheet";
import { CenterSpinner, ErrorView, Spinner } from "../../components/ui";
import { Elapsed, RunStatusIcon, isFailure, runStatusLabel } from "./status";

const route = getRouteApi("/$owner/$repo/actions/runs/$runId/job/$jobId");

export function JobScreen() {
  const { owner, repo, runId, jobId } = route.useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [fullLog, setFullLog] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const job = useQuery(actionsQueries.job(owner, repo, jobId));
  const annotations = useQuery(actionsQueries.annotations(owner, repo, jobId));
  const { rerunJob, cancel } = useRunMutations(owner, repo);

  const data = job.data;
  const running = !data || isRunning(data.status);
  // GitHub's API only serves a job's log once the job has finished.
  const log = useQuery({ ...actionsQueries.jobLog(owner, repo, jobId), enabled: !!data && !running });
  const lines = useMemo(() => (log.data ? parseLog(log.data.text) : []), [log.data]);
  const byStep = useMemo(() => (data?.steps ? splitBySteps(lines, data.steps) : new Map()), [lines, data?.steps]);
  const url = data?.html_url ?? `https://github.com/${owner}/${repo}/actions/runs/${runId}/job/${jobId}`;
  const problems = (annotations.data ?? []).filter((a) => a.annotation_level === "failure" || a.annotation_level === "warning");

  const isExpanded = (step: WorkflowStep) => expanded[step.number] ?? isFailure(step.conclusion);
  const refresh = () => queryClient.refetchQueries({ queryKey: keys.actions.job(owner, repo, jobId), type: "active" });

  return (
    <Screen
      wide
      title={data?.name ?? `Job ${jobId}`}
      subtitle={data?.workflow_name ? `${data.workflow_name}${data.head_branch ? ` · ${data.head_branch}` : ""}` : `${owner}/${repo}`}
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
              <button className="btn" disabled={rerunJob.isPending} onClick={() => rerunJob.mutate(jobId)}>
                {rerunJob.isPending ? <Spinner small /> : <SyncIcon size={16} />} Re-run job
              </button>
            )}
          </div>
        ) : undefined
      }
      onRefresh={refresh}
    >
      {job.isPending ? (
        <CenterSpinner />
      ) : job.isError ? (
        <ErrorView error={job.error} onRetry={() => void job.refetch()} />
      ) : (
        <>
          <div className="detail-header">
            <div className="row-flex" style={{ gap: 8 }}>
              <RunStatusIcon status={data!.status} conclusion={data!.conclusion} size={20} />
              <strong>{runStatusLabel(data!.status, data!.conclusion)}</strong>
              <span className="muted">
                · <Elapsed start={data!.started_at} end={data!.completed_at} running={running} />
              </span>
            </div>
            {data!.runner_name && <div className="muted small" style={{ marginTop: 6 }}>Runner: {data!.runner_name}</div>}
          </div>
          {problems.length > 0 && (
            <div className="annotations">
              {problems.slice(0, 5).map((a, i) => (
                <div key={i} className={`annotation-card ${a.annotation_level === "failure" ? "danger" : "attention"}`}>
                  {a.title && <div className="bold small">{a.title}</div>}
                  <div className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {a.message}
                  </div>
                  {a.path && a.path !== ".github" && (
                    <div className="mono tiny muted">
                      {a.path}:{a.start_line}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {running && (
            <div className="banner banner-attention">
              Steps update live. GitHub's API publishes the output once the job finishes, so it appears here then.{" "}
              <button className="link-btn" onClick={() => void backend.openUrl(url)}>
                Watch live on GitHub
              </button>
            </div>
          )}
          {log.isError && (
            <div className="banner banner-danger">
              {ApiError.from(log.error).status === 404 ? "The log isn't available (GitHub keeps logs for a limited time)." : "Couldn't load the log."}{" "}
              <button className="link-btn" onClick={() => void log.refetch()}>
                Retry
              </button>
            </div>
          )}
          {log.data?.truncated && <div className="banner">This log is very long; only its end is shown.</div>}
          {fullLog ? (
            <LogView lines={lines} />
          ) : (
            (data!.steps ?? []).map((step) => {
              const open = isExpanded(step);
              const stepLines = byStep.get(step.number);
              const canOpen = !running && log.isSuccess && !!stepLines;
              return (
                <div key={step.number} className="step">
                  <button
                    className="row step-row"
                    disabled={!canOpen}
                    aria-expanded={canOpen ? open : undefined}
                    onClick={() => canOpen && setExpanded((e) => ({ ...e, [step.number]: !open }))}
                  >
                    <span className="row-icon">
                      <RunStatusIcon status={step.status} conclusion={step.conclusion} />
                    </span>
                    <span className="row-body">
                      <span style={{ overflowWrap: "anywhere" }}>{step.name}</span>
                    </span>
                    <span className="muted small">
                      <Elapsed start={step.started_at} end={step.completed_at} running={step.status === "in_progress"} />
                    </span>
                    {canOpen ? open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} /> : null}
                    {!running && log.isPending && step.started_at && <Spinner small />}
                  </button>
                  {canOpen && open && <LogView lines={stepLines} />}
                </div>
              );
            })
          )}
        </>
      )}
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title="Job"
        actions={[
          {
            label: fullLog ? "Show steps" : "Show the whole log",
            icon: <ChevronDownIcon size={18} />,
            hidden: !log.isSuccess,
            onSelect: () => setFullLog(!fullLog),
          },
          {
            label: "Copy log",
            icon: <CopyIcon size={18} />,
            hidden: !log.isSuccess,
            onSelect: () => log.data && void backend.copyText(log.data.text).then(() => toast.show("Log copied")),
          },
          { label: "Open in browser", icon: <LinkExternalIcon size={18} />, onSelect: () => void backend.openUrl(url) },
          { label: "Copy link", icon: <CopyIcon size={18} />, onSelect: () => void backend.copyText(url).then(() => toast.show("Link copied")) },
        ]}
      />
    </Screen>
  );
}
