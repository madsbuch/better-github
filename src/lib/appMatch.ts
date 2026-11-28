// Which installed apps come from which repositories, and whether a release has
// a newer build of one. Pure functions: the bridge and the queries live in
// apps.ts and queries/apps.ts.

/** An Android package name: two or more dot-separated identifiers. */
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

// Where repositories declare their Android application id. The id is the
// installed app's package name. Tauri's `identifier` may hold hyphens, which
// Tauri turns into underscores for Android.
const DECLARATIONS = [
  /\bapplicationId\s*(?:=\s*)?["']([\w.-]+)["']/g, // Gradle (Kotlin or Groovy)
  /"identifier"\s*:\s*"([\w.-]+)"/g, // tauri.conf.json
  /"package"\s*:\s*"([\w.-]+)"/g, // Expo's app.json
  /\bappId["']?\s*:\s*["']([\w.-]+)["']/g, // Capacitor
];

/** The Android package names the given build files declare. */
export function packageIdsFromFiles(texts: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const text of texts) {
    for (const pattern of DECLARATIONS) {
      for (const match of text.matchAll(pattern)) {
        const id = match[1];
        if (id === undefined) continue;
        for (const candidate of [id, id.replace(/-/g, "_")]) {
          if (PACKAGE.test(candidate)) ids.add(candidate);
        }
      }
    }
  }
  return [...ids];
}

export function isApk(name: string): boolean {
  return /\.apk$/i.test(name);
}

/**
 * The APK to install from a release's assets: the one installed before when it's still there,
 * otherwise the likeliest universal build (not a debug build, preferably named after the repository).
 */
export function pickApk<A extends { name: string }>(assets: readonly A[], repo: string, previous?: string): A | undefined {
  const apks = assets.filter((asset) => isApk(asset.name));
  const same = previous === undefined ? undefined : apks.find((asset) => asset.name === previous);
  if (same !== undefined) return same;
  const name = repo.toLowerCase();
  const score = (asset: A) => {
    const lower = asset.name.toLowerCase();
    let value = 0;
    if (lower.includes("universal")) value += 2;
    if (lower.includes(name)) value += 1;
    if (lower.includes("debug")) value -= 5;
    return value;
  };
  let best: A | undefined;
  for (const apk of apks) if (best === undefined || score(apk) > score(best)) best = apk;
  return best;
}

export interface InstalledVersion {
  versionCode: number;
  /** When the app was last installed or updated on the device (ms since 1970). */
  lastUpdated: number;
}

/** What was installed through Better GitHub, remembered per package. */
export interface InstalledBuild {
  assetId: number;
  versionCode: number;
}

/**
 * Whether `asset` is a newer build than the installed app. Many repositories
 * replace the APK on a rolling release instead of tagging versions, so the
 * build is compared by upload time: an APK uploaded after the app was last
 * installed is an update. A build installed here is up to date by identity,
 * whatever the clocks say, until the app changes some other way.
 */
export function hasUpdate(app: InstalledVersion, asset: { id: number; updated_at: string }, installed?: InstalledBuild): boolean {
  if (installed !== undefined && installed.assetId === asset.id && installed.versionCode === app.versionCode) return false;
  const uploaded = Date.parse(asset.updated_at);
  return Number.isFinite(uploaded) && uploaded > app.lastUpdated;
}

/** An installed app and the repository it comes from. */
export interface AppMatch<A> {
  app: A;
  owner: string;
  repo: string;
}

/**
 * Pairs installed apps with repositories: an install made here names its
 * repository; otherwise the first repository (most recently pushed) whose build
 * files declare the app's package name.
 */
export function matchApps<A extends { packageName: string }>(
  apps: readonly A[],
  links: Readonly<Record<string, { owner: string; repo: string } | undefined>>,
  repos: readonly { owner: string; name: string; packageIds: readonly string[] }[],
): AppMatch<A>[] {
  const declared = new Map<string, { owner: string; name: string }>();
  for (const repo of repos) {
    for (const id of repo.packageIds) if (!declared.has(id)) declared.set(id, repo);
  }
  const matches: AppMatch<A>[] = [];
  for (const app of apps) {
    const link = links[app.packageName];
    if (link !== undefined) {
      matches.push({ app, owner: link.owner, repo: link.repo });
      continue;
    }
    const repo = declared.get(app.packageName);
    if (repo !== undefined) matches.push({ app, owner: repo.owner, repo: repo.name });
  }
  return matches;
}

/** The fields of a workflow run that tell which workflow builds an app, and how its latest build is doing. */
export interface BuildRun {
  id: number;
  workflow_id: number;
  name?: string | null | undefined;
  path: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string | undefined;
}

/** The workflow that publishes an app's APK, and the branch it publishes from (null: any). */
export interface Publisher {
  workflowId: number;
  branch: string | null;
}

const running = (run: BuildRun) => run.status !== "completed" && run.status !== null;
/** Uploading the APK can come a little after the run's last recorded update. */
const UPLOAD_SLACK = 2 * 60_000;

/**
 * Which workflow publishes the APK, from recent runs (newest first): the run that was going
 * when the APK was uploaded, or else a workflow named for Android, APKs or releases.
 * Pull request runs never publish. A tag-triggered publisher builds from any ref.
 */
export function findPublisher(runs: readonly BuildRun[], asset: { updated_at: string } | undefined, tag: string | undefined): Publisher | undefined {
  const candidates = runs.filter((run) => run.event !== "pull_request");
  const uploaded = asset === undefined ? Number.NaN : Date.parse(asset.updated_at);
  if (Number.isFinite(uploaded)) {
    const publishing = candidates.find((run) => {
      const start = Date.parse(run.run_started_at ?? run.created_at);
      return start <= uploaded && uploaded <= Date.parse(run.updated_at) + UPLOAD_SLACK;
    });
    if (publishing !== undefined) {
      const fromTag = publishing.head_branch === null || publishing.head_branch === tag || publishing.event === "release";
      return { workflowId: publishing.workflow_id, branch: fromTag ? null : publishing.head_branch };
    }
  }
  for (const pattern of [/android|apk/i, /release|publish|deploy/i]) {
    const named = candidates.find((run) => pattern.test(`${run.name ?? ""} ${run.path}`));
    if (named !== undefined) return { workflowId: named.workflow_id, branch: null };
  }
  return undefined;
}

export type AppBuild = { state: "building"; run: BuildRun } | { state: "failed"; run: BuildRun };

/** The publisher's latest run, when it's still going or it failed; nothing when it succeeded or was cancelled. */
export function latestBuild(runs: readonly BuildRun[], publisher: Publisher | undefined): AppBuild | undefined {
  if (publisher === undefined) return undefined;
  const latest = runs.find(
    (run) => run.workflow_id === publisher.workflowId && run.event !== "pull_request" && (publisher.branch === null || run.head_branch === publisher.branch),
  );
  if (latest === undefined) return undefined;
  if (running(latest)) return { state: "building", run: latest };
  if (latest.conclusion === "failure" || latest.conclusion === "timed_out" || latest.conclusion === "startup_failure") return { state: "failed", run: latest };
  return undefined;
}
