import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { rest, restPage, restSend } from "../lib/api";
import { backend } from "../lib/backend";
import { CheckAnnotation, WorkflowJob, WorkflowJobsPage, WorkflowRun, WorkflowRunsPage, WorkflowsPage } from "../lib/types";
import { affects, keys, type RunFilter } from "./keys";
import { useAppMutation } from "./mutation";

/** Statuses of a run or job that hasn't finished. */
export function isRunning(status: string | null | undefined): boolean {
  return status !== "completed" && status !== null && status !== undefined;
}

const RUNNING_POLL = 5_000;

export const actionsQueries = {
  workflows: (owner: string, repo: string) =>
    queryOptions({
      queryKey: keys.actions.workflows(owner, repo),
      queryFn: () => rest(WorkflowsPage, `/repos/${owner}/${repo}/actions/workflows`, { query: { per_page: 100 } }),
      staleTime: 10 * 60_000,
    }),
  runs: (owner: string, repo: string, filter: RunFilter = {}) =>
    infiniteQueryOptions({
      queryKey: keys.actions.runs(owner, repo, filter),
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        pageParam !== null && pageParam !== ""
          ? restPage(WorkflowRun, pageParam, {}, "workflow_runs")
          : restPage(
              WorkflowRun,
              filter.workflow !== undefined && filter.workflow !== 0
                ? `/repos/${owner}/${repo}/actions/workflows/${filter.workflow.toString()}/runs`
                : `/repos/${owner}/${repo}/actions/runs`,
              { query: { per_page: 30, status: filter.status, branch: filter.branch } },
              "workflow_runs",
            ),
      initialPageParam: null,
      getNextPageParam: (last) => last.next ?? undefined,
      staleTime: 15_000,
      refetchInterval: (query) => (query.state.data?.pages[0]?.items.some((r) => isRunning(r.status)) === true ? 15_000 : false),
    }),
  /** The latest runs of every workflow, newest first: the Apps section tells from them whether a new build is coming. */
  recentRuns: (owner: string, repo: string) =>
    queryOptions({
      queryKey: keys.actions.recentRuns(owner, repo),
      queryFn: async () => (await rest(WorkflowRunsPage, `/repos/${owner}/${repo}/actions/runs`, { query: { per_page: 30 } })).workflow_runs,
      staleTime: 15_000,
      // Often while something runs; otherwise now and then, to notice a build starting.
      refetchInterval: (query) => (query.state.data?.some((run) => isRunning(run.status)) === true ? 15_000 : 60_000),
      // A run that was going when the app closed may be long done; don't show it from the device's cache.
      meta: { persist: false },
    }),
  run: (owner: string, repo: string, runId: number) =>
    queryOptions({
      queryKey: keys.actions.run(owner, repo, runId),
      queryFn: () => rest(WorkflowRun, `/repos/${owner}/${repo}/actions/runs/${runId.toString()}`),
      staleTime: 10_000,
      refetchInterval: (query) => (isRunning(query.state.data?.status) ? RUNNING_POLL : false),
    }),
  /** Jobs of the run's latest attempt. */
  runJobs: (owner: string, repo: string, runId: number) =>
    queryOptions({
      queryKey: keys.actions.runJobs(owner, repo, runId),
      queryFn: async () => (await rest(WorkflowJobsPage, `/repos/${owner}/${repo}/actions/runs/${runId.toString()}/jobs`, { query: { per_page: 100 } })).jobs,
      staleTime: 10_000,
      refetchInterval: (query) => (query.state.data?.some((j) => isRunning(j.status)) === true ? RUNNING_POLL : false),
    }),
  job: (owner: string, repo: string, jobId: number) =>
    queryOptions({
      queryKey: keys.actions.job(owner, repo, jobId),
      queryFn: () => rest(WorkflowJob, `/repos/${owner}/${repo}/actions/jobs/${jobId.toString()}`),
      staleTime: 10_000,
      refetchInterval: (query) => (isRunning(query.state.data?.status) ? RUNNING_POLL : false),
    }),
  /** Only available once the job finished; a finished job's log never changes. */
  jobLog: (owner: string, repo: string, jobId: number) =>
    queryOptions({
      queryKey: keys.actions.jobLog(owner, repo, jobId),
      queryFn: () => backend.jobLogs(owner, repo, jobId),
      staleTime: Infinity,
      gcTime: 10 * 60_000,
      meta: { persist: false },
    }),
  /** Errors and warnings a job reported (a job is a check run). */
  annotations: (owner: string, repo: string, jobId: number) =>
    queryOptions({
      queryKey: keys.actions.annotations(owner, repo, jobId),
      queryFn: () => rest(z.array(CheckAnnotation), `/repos/${owner}/${repo}/check-runs/${jobId.toString()}/annotations`, { query: { per_page: 50 } }),
      staleTime: 5 * 60_000,
    }),
};

export function useRunMutations(owner: string, repo: string) {
  const invalidates = affects.actions(owner, repo);
  const post = (path: string) => restSend(`/repos/${owner}/${repo}/actions/${path}`, { method: "POST" });
  const rerun = useAppMutation({
    mutationFn: (runId: number) => post(`runs/${runId.toString()}/rerun`),
    success: "Re-running all jobs",
    invalidates,
  });
  const rerunFailed = useAppMutation({
    mutationFn: (runIds: number[]) => Promise.all(runIds.map((id) => post(`runs/${id.toString()}/rerun-failed-jobs`))),
    success: (runIds) => (runIds.length > 1 ? `Re-running failed jobs in ${runIds.length.toString()} workflows` : "Re-running failed jobs"),
    invalidates,
  });
  const rerunJob = useAppMutation({
    mutationFn: (jobId: number) => post(`jobs/${jobId.toString()}/rerun`),
    success: "Re-running job",
    invalidates,
  });
  const cancel = useAppMutation({
    mutationFn: (runId: number) => post(`runs/${runId.toString()}/cancel`),
    success: "Cancelling run",
    invalidates,
  });
  return { rerun, rerunFailed, rerunJob, cancel };
}
