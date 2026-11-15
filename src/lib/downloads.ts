// Rust resolves GitHub's signed download URL; Android saves the file and opens
// its content URI. Only download IDs are persisted, never the signed URLs.
import { useEffect, useState } from "react";
import { backend, type DownloadTarget } from "./backend";
import { formatBytes } from "./format";
import { toast } from "./toast";
import { useAppMutation } from "../queries/mutation";

export interface DownloadFile {
  name: string;
  contentType: string;
}

type DownloadState = "pending" | "running" | "paused" | "successful" | "failed" | "missing";
interface DownloadStatus {
  status: DownloadState;
  downloadedBytes: number;
  totalBytes: number;
  reason?: string;
}

type OpenResult = "opened" | "permission_required" | "not_ready" | "missing" | "no_handler" | "failed";

export interface AndroidDownloadManager {
  /** Kept for older installed native shells. */
  download(url: string, name: string, mime: string): boolean;
  enqueue?(url: string, name: string, mime: string): string;
  status?(id: string): string;
  open?(id: string): OpenResult;
}

type TrackedManager = Required<AndroidDownloadManager>;
const PREFIX = "ghc.download.";
const STATES: DownloadState[] = ["pending", "running", "paused", "successful", "failed", "missing"];
let generation = 0;

function manager(): TrackedManager | undefined {
  const bridge = window.GhCommanderDownloads;
  return bridge?.enqueue && bridge.status && bridge.open ? bridge as TrackedManager : undefined;
}

function storageKey(target: DownloadTarget): string {
  const resource = target.kind === "asset" ? [target.assetId] : [target.ref, target.format];
  return PREFIX + JSON.stringify([target.kind, target.owner.toLowerCase(), target.repo.toLowerCase(), ...resource]);
}

function storedId(key: string): string | null {
  try {
    const id = localStorage.getItem(key);
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Forget account-specific download references on sign-out; files stay in Downloads. */
export function clearDownloads() {
  generation++;
  try {
    Object.keys(localStorage).filter((key) => key.startsWith(PREFIX)).forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage may be unavailable; downloading still works for the current screen.
  }
}

function readStatus(bridge: TrackedManager, id: string): DownloadStatus {
  const value = JSON.parse(bridge.status(id)) as Partial<DownloadStatus>;
  if (!value || !STATES.includes(value.status as DownloadState)) throw new Error("Invalid download status");
  return {
    status: value.status as DownloadState,
    downloadedBytes: Math.max(0, Number(value.downloadedBytes) || 0),
    totalBytes: Math.max(0, Number(value.totalBytes) || 0),
    reason: typeof value.reason === "string" ? value.reason : undefined,
  };
}

function inProgress(status: DownloadStatus | null): boolean {
  return !!status && ["pending", "running", "paused"].includes(status.status);
}

/** Each asset keeps its own download, including after navigating away or restarting. */
export function useDownload(target: DownloadTarget, file: DownloadFile) {
  const key = storageKey(target);
  const [record, setRecord] = useState(() => ({ key, id: storedId(key) }));
  const id = record.key === key ? record.id : storedId(key);
  const [snapshot, setSnapshot] = useState<{ id: string; value: DownloadStatus } | null>(null);
  const status = snapshot?.id === id ? snapshot.value : null;
  const [hint, setHint] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const bridge = manager();
    setHint(null);
    setStatusError(false);
    if (!id || !bridge) return;
    let timer: number | undefined;
    const check = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      let again = true;
      try {
        const value = readStatus(bridge, id);
        setSnapshot({ id, value });
        setStatusError(false);
        again = inProgress(value);
      } catch {
        setStatusError(true);
      }
      if (again) timer = window.setTimeout(check, 1000);
    };
    check();
    // Recheck completed files on resume too: they may have been moved or deleted.
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [id, key, refresh]);

  const start = useAppMutation({
    mutationFn: async () => {
      const startedIn = generation;
      setHint(null);
      let url: string;
      try {
        url = await backend.downloadUrl(target);
      } catch (error) {
        if (startedIn !== generation) return "cancelled" as const;
        throw error;
      }
      // A URL request can outlive its screen. Navigation is fine, but sign-out
      // must not enqueue an old account's file or restore its saved reference.
      if (startedIn !== generation) return "cancelled" as const;
      const bridge = manager();
      if (bridge) {
        const nextId = bridge.enqueue(url, file.name, file.contentType);
        if (!/^\d+$/.test(nextId)) throw new Error("Couldn't start the download. Please try again.");
        try { localStorage.setItem(key, nextId); } catch { /* Keep the ID in memory if storage is unavailable. */ }
        setRecord({ key, id: nextId });
        setSnapshot({ id: nextId, value: { status: "pending", downloadedBytes: 0, totalBytes: 0 } });
        return "manager" as const;
      }
      if (window.GhCommanderDownloads?.download(url, file.name, file.contentType)) return "manager" as const;
      await backend.openUrl(url);
      return "browser" as const;
    },
    success: (_vars, how) => how === "manager" ? `Downloading ${file.name}…` : null,
  });

  const open = () => {
    const bridge = manager();
    if (!id || !bridge) return;
    let result: OpenResult;
    try { result = bridge.open(id); } catch { result = "failed"; }
    const messages: Record<Exclude<OpenResult, "opened">, string> = {
      permission_required: "Allow Better GitHub to install apps in Android Settings, then return and tap Open again.",
      not_ready: "This download isn't finished yet.",
      missing: "The downloaded file was moved or deleted. Download it again.",
      no_handler: "No installed app can open this file. It is saved in Downloads.",
      failed: "Couldn't open this file. Try again or open it from Downloads.",
    };
    const message = result === "opened" ? null : messages[result] ?? messages.failed;
    setHint(message);
    if (message) toast.show(message, result === "permission_required" ? "info" : "error");
    if (result === "missing") setSnapshot({ id, value: { status: "missing", downloadedBytes: 0, totalBytes: 0 } });
    if (result === "not_ready") setRefresh((value) => value + 1);
  };

  let progress: string | null = null;
  if (status?.status === "pending") progress = "Waiting to download…";
  if (status?.status === "running") progress = status.totalBytes > 0
    ? `Downloading · ${formatBytes(status.downloadedBytes)} of ${formatBytes(status.totalBytes)}`
    : `Downloading · ${formatBytes(status.downloadedBytes)}`;
  if (status?.status === "paused") progress = status.reason || "Download paused. Android will retry automatically.";
  if (status?.status === "successful") progress = "Downloaded · Tap to open";
  if (status?.status === "failed") progress = status.reason || "Download failed. Tap to retry.";
  if (status?.status === "missing") progress = "File no longer available. Tap to download again.";
  if (statusError) progress = "Couldn't check progress. Retrying…";

  return {
    start: () => start.mutate(),
    open,
    busy: start.isPending || inProgress(status) || (!!id && !status && !!manager()),
    complete: status?.status === "successful",
    retry: status?.status === "failed" || status?.status === "missing",
    message: hint ?? progress,
  };
}
