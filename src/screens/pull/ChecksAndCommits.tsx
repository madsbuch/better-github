import {
  AlertIcon,
  CheckCircleFillIcon,
  CircleSlashIcon,
  ClockIcon,
  DotFillIcon,
  SkipIcon,
  StopIcon,
  SyncIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { backend } from "../../lib/backend";
import { formatDuration } from "../../lib/format";
import { appLinkForUrl } from "../../lib/links";
import { to } from "../../lib/nav";
import type { CheckRunNode, StatusContextNode } from "../../lib/types";
import { useRunMutations } from "../../queries/actions";
import { pullQueries } from "../../queries/pulls";
import { Avatar, CenterSpinner, ChecksIcon, EmptyState, ErrorView, Spinner, Time } from "../../components/ui";

export function CommitsTab({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  const commits = useQuery(pullQueries.commits(owner, repo, number));
  if (commits.isPending) return <CenterSpinner />;
  if (commits.isError) return <ErrorView error={commits.error} onRetry={() => void commits.refetch()} />;
  if (commits.data.length === 0) return <EmptyState title="No commits" />;
  return (
    <>
      {commits.data.map(({ id, commit }) => (
        <Link key={id} {...to.commit(owner, repo, commit.oid)} className="row">
          <span className="row-icon" style={{ paddingTop: 0 }}>
            <Avatar src={commit.author?.avatarUrl} size={28} />
          </span>
          <span className="row-body">
            <span className="row-title" style={{ display: "block", fontWeight: 500 }}>
              {commit.messageHeadline}
            </span>
            <span className="row-meta">
              <span className="ellipsis">{commit.author?.user?.login ?? commit.author?.name}</span>
              <span>·</span>
              <Time iso={commit.committedDate} />
              <span className="grow" />
              <ChecksIcon state={commit.statusCheckRollup?.state} />
              <span className="mono">{commit.abbreviatedOid}</span>
            </span>
          </span>
        </Link>
      ))}
    </>
  );
}

type Outcome = "failure" | "pending" | "success" | "skipped";

interface CheckView {
  id: string;
  name: string;
  detail: string;
  outcome: Outcome;
  icon: ReactNode;
  url: string | null;
  required: boolean;
  runId: number | null;
}

function viewCheckRun(run: CheckRunNode): CheckView {
  const workflow = run.checkSuite.workflowRun?.workflow.name;
  const name = workflow ? `${workflow} / ${run.name}` : run.checkSuite.app ? `${run.checkSuite.app.name} / ${run.name}` : run.name;
  const duration = formatDuration(run.startedAt, run.completedAt);
  let outcome: Outcome;
  let icon: ReactNode;
  let detail: string;
  if (run.status !== "COMPLETED") {
    outcome = "pending";
    icon = run.status === "IN_PROGRESS" ? <DotFillIcon size={16} className="c-attention" /> : <ClockIcon size={16} className="c-attention" />;
    detail = run.status === "IN_PROGRESS" ? "In progress" : run.status === "WAITING" ? "Waiting" : "Queued";
  } else {
    switch (run.conclusion) {
      case "SUCCESS":
        outcome = "success";
        icon = <CheckCircleFillIcon size={16} className="c-success" />;
        detail = `Successful${duration ? ` in ${duration}` : ""}`;
        break;
      case "FAILURE":
      case "TIMED_OUT":
      case "STARTUP_FAILURE":
        outcome = "failure";
        icon = <XCircleFillIcon size={16} className="c-danger" />;
        detail = `${run.conclusion === "TIMED_OUT" ? "Timed out" : "Failing"}${duration ? ` after ${duration}` : ""}`;
        break;
      case "CANCELLED":
        outcome = "failure";
        icon = <StopIcon size={16} className="c-muted" />;
        detail = "Cancelled";
        break;
      case "ACTION_REQUIRED":
        outcome = "failure";
        icon = <AlertIcon size={16} className="c-attention" />;
        detail = "Action required";
        break;
      case "SKIPPED":
        outcome = "skipped";
        icon = <SkipIcon size={16} className="c-muted" />;
        detail = "Skipped";
        break;
      default:
        outcome = "skipped";
        icon = <CircleSlashIcon size={16} className="c-muted" />;
        detail = run.conclusion ? run.conclusion.toLowerCase().replace(/_/g, " ") : "Neutral";
    }
  }
  if (run.title && outcome !== "success") detail = `${detail} — ${run.title}`;
  return {
    id: run.id,
    name,
    detail,
    outcome,
    icon,
    url: run.detailsUrl,
    required: run.isRequired,
    runId: run.checkSuite.workflowRun?.databaseId ?? null,
  };
}

function viewStatus(status: StatusContextNode): CheckView {
  const map: Record<StatusContextNode["state"], [Outcome, ReactNode]> = {
    SUCCESS: ["success", <CheckCircleFillIcon size={16} className="c-success" />],
    FAILURE: ["failure", <XCircleFillIcon size={16} className="c-danger" />],
    ERROR: ["failure", <XCircleFillIcon size={16} className="c-danger" />],
    PENDING: ["pending", <DotFillIcon size={16} className="c-attention" />],
    EXPECTED: ["pending", <ClockIcon size={16} className="c-attention" />],
  };
  const [outcome, icon] = map[status.state];
  return {
    id: status.id,
    name: status.context,
    detail: status.description ?? status.state.toLowerCase(),
    outcome,
    icon,
    url: status.targetUrl,
    required: status.isRequired,
    runId: null,
  };
}

const ORDER: Outcome[] = ["failure", "pending", "success", "skipped"];
const HEADINGS: Record<Outcome, string> = {
  failure: "Failing",
  pending: "In progress",
  success: "Successful",
  skipped: "Skipped & neutral",
};

export function ChecksTab({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  const checks = useQuery(pullQueries.checks(owner, repo, number));
  const { rerunFailed } = useRunMutations(owner, repo);

  if (checks.isPending) return <CenterSpinner />;
  if (checks.isError) return <ErrorView error={checks.error} onRetry={() => void checks.refetch()} />;

  const rollup = checks.data.repository?.pullRequest?.commits.nodes[0]?.commit.statusCheckRollup;
  const views = (rollup?.contexts.nodes ?? []).map((node) =>
    node.__typename === "CheckRun" ? viewCheckRun(node) : viewStatus(node),
  );
  if (views.length === 0) {
    return <EmptyState title="No checks">No status checks have been reported for the latest commit.</EmptyState>;
  }

  const failedRuns = [...new Set(views.filter((v) => v.outcome === "failure" && v.runId).map((v) => v.runId!))];
  const counts = Object.fromEntries(ORDER.map((o) => [o, views.filter((v) => v.outcome === o).length])) as Record<Outcome, number>;


  return (
    <>
      <div className="row-flex small" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-muted)", flexWrap: "wrap" }}>
        <span className="grow">
          {counts.failure > 0 && <span className="c-danger bold">{counts.failure} failing </span>}
          {counts.pending > 0 && <span className="c-attention bold">{counts.pending} in progress </span>}
          <span className="muted">
            {counts.success} successful{counts.skipped ? `, ${counts.skipped} skipped` : ""}
          </span>
        </span>
        {failedRuns.length > 0 && (
          <button className="btn btn-sm" disabled={rerunFailed.isPending} onClick={() => rerunFailed.mutate(failedRuns)}>
            {rerunFailed.isPending ? <Spinner small /> : <SyncIcon size={14} />} Re-run failed
          </button>
        )}
      </div>
      {ORDER.filter((o) => counts[o] > 0).map((outcome) => (
        <div key={outcome}>
          <div className="group-header">{HEADINGS[outcome]}</div>
          {views
            .filter((v) => v.outcome === outcome)
            .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name))
            .map((v) => (
              <CheckRow key={v.id} check={v} />
            ))}
        </div>
      ))}
    </>
  );
}

/** GitHub Actions checks open their job (steps and log) in the app; others open their page. */
function CheckRow({ check: v }: { check: CheckView }) {
  const body = (
    <>
      <span className="row-icon">{v.icon}</span>
      <span className="row-body">
        <span className="bold" style={{ display: "block", overflowWrap: "anywhere" }}>
          {v.name}
        </span>
        <span className="muted small" style={{ overflowWrap: "anywhere" }}>
          {v.detail}
        </span>
      </span>
      {v.required && <span className="pill">Required</span>}
    </>
  );
  const link = v.url ? appLinkForUrl(v.url) : null;
  if (link) {
    return (
      <Link {...link} preload="viewport" className="row">
        {body}
      </Link>
    );
  }
  return (
    <button className="row" disabled={!v.url} onClick={() => v.url && void backend.openUrl(v.url)}>
      {body}
    </button>
  );
}
