import {
  AlertIcon,
  CheckCircleFillIcon,
  CircleSlashIcon,
  ClockIcon,
  DotFillIcon,
  SkipIcon,
  StopIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { useEffect, useState } from "react";
import { formatDuration } from "../../lib/format";
import { isRunning } from "../../queries/actions";

/** The icon GitHub shows for a run, job or step. */
export function RunStatusIcon({ status, conclusion, size = 16 }: { status: string | null; conclusion: string | null; size?: number }) {
  if (status === "in_progress") return <DotFillIcon size={size} className="c-attention pulse" aria-label="In progress" />;
  if (isRunning(status)) return <ClockIcon size={size} className="c-attention" aria-label="Queued" />;
  switch (conclusion) {
    case "success":
      return <CheckCircleFillIcon size={size} className="c-success" aria-label="Success" />;
    case "failure":
    case "timed_out":
    case "startup_failure":
      return <XCircleFillIcon size={size} className="c-danger" aria-label="Failed" />;
    case "cancelled":
      return <StopIcon size={size} className="c-muted" aria-label="Cancelled" />;
    case "skipped":
      return <SkipIcon size={size} className="c-muted" aria-label="Skipped" />;
    case "action_required":
      return <AlertIcon size={size} className="c-attention" aria-label="Action required" />;
    case null:
    default:
      return <CircleSlashIcon size={size} className="c-muted" aria-label="Neutral" />;
  }
}

export function runStatusLabel(status: string | null, conclusion: string | null): string {
  if (status === "in_progress") return "In progress";
  if (status === "waiting") return "Waiting";
  if (isRunning(status)) return "Queued";
  switch (conclusion) {
    case "success":
      return "Success";
    case "failure":
      return "Failed";
    case "timed_out":
      return "Timed out";
    case "startup_failure":
      return "Startup failure";
    case "cancelled":
      return "Cancelled";
    case "skipped":
      return "Skipped";
    case "action_required":
      return "Action required";
    case null:
      return "Neutral";
    default:
      return conclusion !== "" ? conclusion.replace(/_/g, " ") : "Neutral";
  }
}

export function isFailure(conclusion: string | null): boolean {
  return conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure";
}

/** Jobs GitHub's "re-run failed jobs" picks up: failed ones and cancelled ones. */
export function needsRerun(conclusion: string | null): boolean {
  return isFailure(conclusion) || conclusion === "cancelled";
}

/** How long something ran; ticks every second while it is still running. */
export function Elapsed({ start, end, running }: { start: string | null | undefined; end: string | null | undefined; running: boolean }) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const text = formatDuration(start, running ? now : end);
  return text !== "" ? <span className="nowrap">{text}</span> : null;
}
