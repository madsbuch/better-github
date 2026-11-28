// The apps installed on the phone, and installing APKs so that Better GitHub
// is their installer (Apps.kt, `window.GhCommanderApps`). Only Android has the
// bridge; elsewhere the Apps section isn't offered.
import { useEffect, useState } from "react";
import { z } from "zod";
import type { InstalledBuild } from "./appMatch";
import { parseJson } from "./schema";
import { toast } from "./toast";

export interface AndroidApps {
  /** JSON: `InstalledApp[]`. */
  installed: () => string;
  /** A PNG data URL, or "". */
  icon: (packageName: string) => string;
  launch: (packageName: string) => boolean;
  /** JSON: `InstallStart`. */
  install: (downloadId: string) => string;
  /** JSON: `InstallStatus`. */
  installStatus: (id: string) => string;
}

export const InstalledApp = z.object({
  packageName: z.string(),
  label: z.string(),
  versionName: z.string(),
  versionCode: z.number(),
  lastUpdated: z.number(),
});
export type InstalledApp = z.infer<typeof InstalledApp>;

const InstallStart = z.object({
  result: z.enum(["started", "permission_required", "not_ready", "missing", "failed"]),
  id: z.string().optional(),
});

const InstallStatus = z.object({
  status: z.enum(["preparing", "installing", "waiting", "installed", "failed", "cancelled", "missing"]),
  packageName: z.string().optional(),
  versionName: z.string().optional(),
  versionCode: z.number().optional(),
  message: z.string().optional(),
});
type InstallStatus = z.infer<typeof InstallStatus>;

/** Fired when apps were installed, so lists re-read what's on the device. */
const CHANGED = "ghc:apps-changed";

export function appsBridge(): AndroidApps | undefined {
  const bridge = window.GhCommanderApps;
  if (bridge === undefined) return undefined;
  const complete = [bridge.installed, bridge.icon, bridge.launch, bridge.install, bridge.installStatus].every((method) => typeof method === "function");
  return complete ? bridge : undefined;
}

/** Whether this device can list and install apps (the Android app, from the version that added Apps). */
export function canManageApps(): boolean {
  return appsBridge() !== undefined;
}

/** The apps on the device, newest first by when they were last updated; `[]` when they can't be read. */
export function readInstalledApps(): InstalledApp[] {
  const bridge = appsBridge();
  if (bridge === undefined) return [];
  let text: string;
  try {
    text = bridge.installed();
  } catch {
    return [];
  }
  return parseJson(z.array(InstalledApp), text) ?? [];
}

/** The installed apps, re-read when the app returns to the foreground (an install may have finished meanwhile). */
export function useInstalledApps(): InstalledApp[] {
  const [apps, setApps] = useState(readInstalledApps);
  useEffect(() => {
    const read = () => {
      if (!document.hidden) setApps(readInstalledApps());
    };
    window.addEventListener("focus", read);
    window.addEventListener(CHANGED, read);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.removeEventListener("focus", read);
      window.removeEventListener(CHANGED, read);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  return apps;
}

const icons = new Map<string, string>();

/** An app's launcher icon as a data URL; "" when there's none. Read once per package. */
export function appIcon(packageName: string): string {
  const cached = icons.get(packageName);
  if (cached !== undefined) return cached;
  let icon = "";
  try {
    const value = appsBridge()?.icon(packageName) ?? "";
    if (value.startsWith("data:image/png;base64,")) icon = value;
  } catch {
    // No icon; the screen shows a placeholder.
  }
  icons.set(packageName, icon);
  return icon;
}

export function launchApp(packageName: string): boolean {
  try {
    return appsBridge()?.launch(packageName) === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- installs remembered

/** An app installed through Better GitHub: where it came from. */
export const AppLink = z.object({
  owner: z.string(),
  repo: z.string(),
  assetId: z.number(),
  assetName: z.string(),
  versionCode: z.number(),
});
export type AppLink = z.infer<typeof AppLink>;

const LINKS = "ghc.apps.links";

/** Installs made here, by package name. Account data: cleared on sign-out. */
export function appLinks(): Record<string, AppLink> {
  try {
    return parseJson(z.record(z.string(), AppLink), localStorage.getItem(LINKS)) ?? {};
  } catch {
    return {};
  }
}

function rememberInstall(packageName: string, link: AppLink) {
  try {
    localStorage.setItem(LINKS, JSON.stringify({ ...appLinks(), [packageName]: link }));
  } catch {
    // Without storage, the app is still found from its repository's build files.
  }
}

export function clearAppLinks() {
  try {
    localStorage.removeItem(LINKS);
  } catch {
    // Storage may be unavailable; nothing was kept then.
  }
}

export function useAppLinks(): Record<string, AppLink> {
  const [links, setLinks] = useState(appLinks);
  useEffect(() => {
    const read = () => setLinks(appLinks());
    window.addEventListener(CHANGED, read);
    return () => window.removeEventListener(CHANGED, read);
  }, []);
  return links;
}

/** What installed `link` means for comparing builds later. */
export function installedBuild(link: AppLink | undefined): InstalledBuild | undefined {
  return link === undefined ? undefined : { assetId: link.assetId, versionCode: link.versionCode };
}

// ---------------------------------------------------------------- installing

/** The release asset being installed. */
export interface InstallSource {
  owner: string;
  repo: string;
  assetId: number;
  assetName: string;
}

export type InstallStartResult = "started" | "permission_required" | "not_ready" | "missing" | "failed";

/** Installations still running, by asset, so a screen opened again picks its progress back up. */
const running = new Map<number, string>();

const ACTIVE = new Set<InstallStatus["status"]>(["preparing", "installing", "waiting"]);

function statusMessage(status: InstallStatus): string | null {
  switch (status.status) {
    case "preparing":
      return "Preparing to install…";
    case "installing":
      return "Installing…";
    case "waiting":
      return "Confirm the installation in Android's dialog.";
    case "installed":
      return "Installed.";
    case "cancelled":
      return "Installation cancelled.";
    case "failed":
      return status.message !== undefined && status.message !== "" ? status.message : "Android couldn't install it.";
    case "missing":
      return null;
  }
}

/**
 * Installs completed APK downloads of `source` with PackageInstaller, follows
 * the installation and remembers which repository the app came from.
 * `available` is false on devices (or older app versions) without the bridge.
 */
export function useApkInstall(source: InstallSource | null) {
  const owner = source?.owner ?? null;
  const repo = source?.repo ?? null;
  const assetId = source?.assetId ?? null;
  const assetName = source?.assetName ?? null;
  const [token, setToken] = useState<string | null>(() => (assetId === null ? null : running.get(assetId) ?? null));
  const [status, setStatus] = useState<InstallStatus | null>(null);

  useEffect(() => {
    const bridge = appsBridge();
    if (token === null || bridge === undefined || owner === null || repo === null || assetId === null || assetName === null) return;
    let timer: number | undefined;
    let stopped = false;
    const check = () => {
      window.clearTimeout(timer);
      if (stopped) return;
      let next: InstallStatus | null = null;
      try {
        next = parseJson(InstallStatus, bridge.installStatus(token));
      } catch {
        next = null;
      }
      next ??= { status: "failed", message: "Couldn't follow the installation." };
      setStatus(next);
      if (ACTIVE.has(next.status)) {
        timer = window.setTimeout(check, 700);
        return;
      }
      stopped = true;
      running.delete(assetId);
      const packageName = next.packageName;
      if (next.status === "installed" && packageName !== undefined) {
        rememberInstall(packageName, {
          owner,
          repo,
          assetId,
          assetName,
          versionCode: next.versionCode ?? 0,
        });
        const app = readInstalledApps().find((item) => item.packageName === packageName);
        toast.show(`Installed ${app?.label ?? assetName}`);
      }
      window.dispatchEvent(new Event(CHANGED));
    };
    check();
    // Returning from Android's dialog: look right away rather than at the next tick.
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [token, owner, repo, assetId, assetName]);

  const install = (downloadId: string): InstallStartResult => {
    const bridge = appsBridge();
    if (bridge === undefined || source === null) return "failed";
    let start: z.infer<typeof InstallStart> | null = null;
    try {
      start = parseJson(InstallStart, bridge.install(downloadId));
    } catch {
      start = null;
    }
    if (start === null) return "failed";
    if (start.result === "started") {
      if (start.id === undefined || start.id === "") return "failed";
      running.set(source.assetId, start.id);
      setStatus({ status: "preparing" });
      setToken(start.id);
    }
    return start.result;
  };

  return {
    available: appsBridge() !== undefined && source !== null,
    install,
    busy: status !== null && ACTIVE.has(status.status),
    installed: status?.status === "installed",
    message: status === null ? null : statusMessage(status),
  };
}
