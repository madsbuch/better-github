import { AppsIcon, ChevronRightIcon, DeviceMobileIcon, LockIcon } from "@primer/octicons-react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../lib/api";
import { findPublisher, hasUpdate, latestBuild, matchApps, pickApk, type AppBuild, type AppMatch } from "../lib/appMatch";
import { appIcon, canManageApps, installedBuild, launchApp, useAppLinks, useInstalledApps, type AppLink, type InstalledApp } from "../lib/apps";
import { useDownload } from "../lib/downloads";
import { to } from "../lib/nav";
import { useIsGuest } from "../lib/session";
import { toast } from "../lib/toast";
import { actionsQueries } from "../queries/actions";
import { appQueries } from "../queries/apps";
import { keys } from "../queries/keys";
import { releaseQueries, type Release, type ReleaseAsset } from "../queries/releases";
import { Screen } from "../components/Screen";
import { EmptyState, ErrorView, SkeletonList, Spinner, Time } from "../components/ui";
import { Elapsed, RunStatusIcon } from "./actions/status";

interface AppEntry extends AppMatch<InstalledApp> {
  link: AppLink | undefined;
  release: Release | undefined;
  releaseError: unknown;
  /** The APK to update to, when the latest release has a newer build. */
  update: ReleaseAsset | undefined;
  /** A build of the app on its way, or the last one failing. */
  build: AppBuild | undefined;
}

/**
 * The apps on this phone that come from the user's repositories, with the
 * newest build from each one's latest release one tap away.
 */
export function AppsScreen() {
  const guest = useIsGuest();
  const supported = canManageApps();
  const installed = useInstalledApps();
  const links = useAppLinks();
  const repos = useQuery({ ...appQueries.repos(), enabled: supported && !guest });
  const matches = useMemo(() => matchApps(installed, links, repos.data ?? []), [installed, links, repos.data]);
  const releases = useQueries({ queries: matches.map((match) => releaseQueries.one(match.owner, match.repo, "latest")) });
  const runs = useQueries({ queries: matches.map((match) => actionsQueries.recentRuns(match.owner, match.repo)) });
  // Tapping "Update all" bumps this; every row with an update starts it.
  const [updateAll, setUpdateAll] = useState(0);

  const entries: AppEntry[] = matches.map((match, index) => {
    const result = releases[index];
    const link = links[match.app.packageName];
    const release = result?.data;
    const asset = release === undefined ? undefined : pickApk(release.assets, match.repo, link?.assetName);
    const update = asset !== undefined && hasUpdate(match.app, asset, installedBuild(link)) ? asset : undefined;
    const recent = runs[index]?.data ?? [];
    const build = latestBuild(recent, findPublisher(recent, asset, release?.tag_name));
    return { ...match, link, release, releaseError: result?.error ?? null, update, build };
  });
  useNewBuilds(entries);
  const byLabel = (a: AppEntry, b: AppEntry) => a.app.label.localeCompare(b.app.label);
  const updates = entries.filter((entry) => entry.update !== undefined).sort(byLabel);
  const current = entries.filter((entry) => entry.update === undefined).sort(byLabel);

  const refresh = () => Promise.all([repos.refetch(), ...releases.map((result) => result.refetch()), ...runs.map((result) => result.refetch())]);

  return (
    <Screen title="Apps" onRefresh={supported && !guest ? refresh : undefined}>
      {!supported ? (
        <EmptyState icon={<AppsIcon size={32} />} title="Apps live on your phone">
          In the Android app, this lists the apps you have installed from your repositories' releases, and updates them.
        </EmptyState>
      ) : guest ? (
        <EmptyState icon={<LockIcon size={32} />} title="Sign in to see your apps">
          Apps are found in the repositories your account can see.
        </EmptyState>
      ) : entries.length === 0 && repos.isPending ? (
        <SkeletonList rows={4} />
      ) : entries.length === 0 && repos.isError ? (
        <ErrorView error={repos.error} onRetry={() => void repos.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={<DeviceMobileIcon size={32} />} title="No apps from your repositories">
          <AppsHint />
        </EmptyState>
      ) : (
        <>
          {updates.length > 0 && (
            <div className="group-header">
              <span style={{ flex: 1 }}>Updates · {updates.length}</span>
              {updates.length > 1 && (
                <button className="btn btn-sm btn-primary" onClick={() => setUpdateAll((value) => value + 1)}>
                  Update all
                </button>
              )}
            </div>
          )}
          {updates.map((entry) =>
            entry.update === undefined ? null : (
              <AppEntryView key={entry.app.packageName} entry={entry}>
                <UpdatableAppRow entry={entry} asset={entry.update} updateAll={updateAll} />
              </AppEntryView>
            ),
          )}
          {current.length > 0 && <div className="group-header">Installed · {current.length}</div>}
          {current.map((entry) => (
            <AppEntryView key={entry.app.packageName} entry={entry}>
              <InstalledAppRow entry={entry} />
            </AppEntryView>
          ))}
          <p className="muted small pad apps-hint">
            <AppsHint />
          </p>
        </>
      )}
    </Screen>
  );
}

/** When a build finishes, its APK is probably on the release by now: look again. */
function useNewBuilds(entries: readonly AppEntry[]) {
  const queryClient = useQueryClient();
  // Builds seen going, by run, with the repository to look at once they're done.
  const building = useRef(new Map<number, { owner: string; repo: string }>());
  const going = entries.flatMap((entry) => (entry.build?.state === "building" ? [{ id: entry.build.run.id, owner: entry.owner, repo: entry.repo }] : []));
  const latest = useRef(going);
  latest.current = going;
  const signature = going.map((build) => build.id.toString()).join(" ");
  useEffect(() => {
    const now = new Set(latest.current.map((build) => build.id));
    for (const [id, { owner, repo }] of building.current) {
      if (now.has(id)) continue;
      building.current.delete(id);
      void queryClient.invalidateQueries({ queryKey: keys.releases.all(owner, repo) });
    }
    for (const build of latest.current) building.current.set(build.id, { owner: build.owner, repo: build.repo });
  }, [signature, queryClient]);
}

/** One app: its row, and how its next build is doing. */
function AppEntryView({ entry, children }: { entry: AppEntry; children: ReactNode }) {
  const build = entry.build;
  return (
    <div className="app-entry">
      {children}
      {build !== undefined && (
        <Link {...to.run(entry.owner, entry.repo, build.run.id)} className="app-build" aria-label={`${build.state === "building" ? "Building" : "Build failed"}: ${entry.app.label}`}>
          <RunStatusIcon status={build.run.status} conclusion={build.run.conclusion} size={14} />
          <span className="row-body ellipsis">
            {build.state === "building" ? (
              <>
                {build.run.status === "in_progress" ? "Building" : "Build queued"} · {build.run.name ?? "workflow"}
                {build.run.status === "in_progress" && (
                  <>
                    {" "}
                    · <Elapsed start={build.run.run_started_at ?? build.run.created_at} end={null} running />
                  </>
                )}
              </>
            ) : (
              <>
                Latest build failed · {build.run.name ?? "workflow"} · <Time iso={build.run.updated_at} />
              </>
            )}
          </span>
          <ChevronRightIcon size={14} />
        </Link>
      )}
    </div>
  );
}

function AppsHint() {
  return (
    <>
      An app shows up here when its repository's latest release has an APK, and the repository's build files name the app or you installed it from a
      release in Better GitHub.
    </>
  );
}

function AppIcon({ packageName }: { packageName: string }) {
  const src = appIcon(packageName);
  return (
    <span className="row-icon app-icon" aria-hidden>
      {src !== "" ? <img src={src} alt="" width={40} height={40} /> : <DeviceMobileIcon size={24} />}
    </span>
  );
}

/** The app's name, where it comes from and how it's doing; opens the latest release. */
function AppSummary({ entry, status }: { entry: AppEntry; status: ReactNode }) {
  const { app, owner, repo } = entry;
  return (
    <Link {...to.latestRelease(owner, repo)} className="row app-row" preload="viewport">
      <AppIcon packageName={app.packageName} />
      <span className="row-body">
        <span className="row-title" style={{ display: "block" }}>
          {app.label}
        </span>
        <span className="row-meta">
          <span className="ellipsis">
            {owner}/{repo}
          </span>
          {app.versionName !== "" && (
            <>
              <span>·</span>
              <span className="nowrap">{app.versionName}</span>
            </>
          )}
        </span>
        {status !== null && (
          <span className="download-status small" role="status">
            {status}
          </span>
        )}
      </span>
    </Link>
  );
}

function InstalledAppRow({ entry }: { entry: AppEntry }) {
  let status: ReactNode = null;
  if (entry.release === undefined && entry.releaseError === null) status = <span className="muted">Checking for updates…</span>;
  else if (entry.releaseError !== null) {
    status = (
      <span className="muted">{ApiError.from(entry.releaseError).status === 404 ? "The repository has no release." : "Couldn't check for updates."}</span>
    );
  } else if (entry.release !== undefined && pickApk(entry.release.assets, entry.repo) === undefined) {
    status = <span className="muted">The latest release has no APK.</span>;
  }
  return (
    <div className="download-row">
      <AppSummary entry={entry} status={status} />
      <button
        className="btn btn-sm"
        aria-label={`Open ${entry.app.label}`}
        onClick={() => {
          if (!launchApp(entry.app.packageName)) toast.show(`Couldn't open ${entry.app.label}.`, "error");
        }}
      >
        Open
      </button>
    </div>
  );
}

function UpdatableAppRow({ entry, asset, updateAll }: { entry: AppEntry; asset: ReleaseAsset; updateAll: number }) {
  const download = useDownload(
    { kind: "asset", owner: entry.owner, repo: entry.repo, assetId: asset.id, browserUrl: asset.browser_download_url },
    { name: asset.name, contentType: asset.content_type },
  );
  // One tap updates: download, then install as soon as the file is complete.
  const [wanted, setWanted] = useState(false);
  const update = () => {
    if (download.busy) return;
    if (download.complete) {
      download.open();
      return;
    }
    setWanted(true);
    download.start();
  };

  useEffect(() => {
    if (!wanted || !download.complete || download.busy) return;
    setWanted(false);
    download.open();
  }, [wanted, download]);

  const latestUpdate = useRef(update);
  latestUpdate.current = update;
  const [seen, setSeen] = useState(updateAll);
  useEffect(() => {
    if (updateAll === seen) return;
    setSeen(updateAll);
    latestUpdate.current();
  }, [updateAll, seen]);

  const status = download.message ?? (
    <>
      New build · <Time iso={asset.updated_at} />
    </>
  );
  return (
    <div className="download-row">
      <AppSummary entry={entry} status={status} />
      <button className="btn btn-sm btn-primary" aria-label={`Update ${entry.app.label}`} onClick={update} disabled={download.busy}>
        {download.busy ? <Spinner small /> : download.retry ? "Retry" : "Update"}
      </button>
    </div>
  );
}
