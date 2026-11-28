import { describe, expect, it } from "vitest";
import { appReleaseTag, findPublisher, hasUpdate, latestBuild, matchApps, packageIdsFromFiles, pickApk, type BuildRun } from "./appMatch";
import { APP_BUILD_FILES, APP_IDS } from "./queries";

describe("packageIdsFromFiles", () => {
  it("reads Gradle's applicationId, in Kotlin and Groovy", () => {
    expect(packageIdsFromFiles(['android {\n  defaultConfig {\n    applicationId = "io.github.me.app"\n  }\n}'])).toEqual(["io.github.me.app"]);
    expect(packageIdsFromFiles(["defaultConfig {\n  applicationId 'com.example.polish'\n}"])).toEqual(["com.example.polish"]);
  });

  it("reads Tauri's identifier, as Android spells it", () => {
    expect(packageIdsFromFiles(['{ "productName": "Learn", "identifier": "dk.me.learn-polish" }'])).toEqual(["dk.me.learn_polish"]);
    expect(packageIdsFromFiles(['{ "identifier": "io.github.madsbuch.ghcommander" }'])).toEqual(["io.github.madsbuch.ghcommander"]);
  });

  it("reads Expo's package and Capacitor's appId", () => {
    expect(packageIdsFromFiles(['{ "expo": { "android": { "package": "com.me.expo" } } }'])).toEqual(["com.me.expo"]);
    expect(packageIdsFromFiles(['{ "appId": "com.me.cap" }', "const config = { appId: 'com.me.capts' };"])).toEqual(["com.me.cap", "com.me.capts"]);
  });

  it("ignores what isn't a package name", () => {
    expect(packageIdsFromFiles(['{ "name": "app", "package": "lodash" }', 'applicationId = "1bad.name"', ""])).toEqual([]);
  });
});

describe("pickApk", () => {
  const asset = (name: string) => ({ name });

  it("keeps the APK installed before", () => {
    expect(pickApk([asset("better-github.apk"), asset("gh-commander.apk")], "better-github", "gh-commander.apk")?.name).toBe("gh-commander.apk");
  });

  it("prefers a universal build named after the repository, never a debug build", () => {
    expect(pickApk([asset("app-debug.apk"), asset("notes.dmg"), asset("app-release.apk")], "notes")?.name).toBe("app-release.apk");
    expect(pickApk([asset("gh-commander.apk"), asset("better-github.apk")], "better-github", "gone.apk")?.name).toBe("better-github.apk");
    expect(pickApk([asset("app-arm64-v8a.apk"), asset("app-universal.apk")], "x")?.name).toBe("app-universal.apk");
    expect(pickApk([asset("notes.dmg")], "notes")).toBeUndefined();
  });
});

describe("hasUpdate", () => {
  const installedAt = Date.parse("2026-11-20T10:00:00Z");
  const app = { versionCode: 1000042, lastUpdated: installedAt };

  it("is an update when the APK was uploaded after the app was installed", () => {
    expect(hasUpdate(app, { id: 7, updated_at: "2026-11-21T10:00:00Z" })).toBe(true);
    expect(hasUpdate(app, { id: 7, updated_at: "2026-11-19T10:00:00Z" })).toBe(false);
  });

  it("knows the build it installed, whatever the clocks say", () => {
    const asset = { id: 7, updated_at: "2026-11-21T10:00:00Z" };
    expect(hasUpdate(app, asset, { assetId: 7, versionCode: 1000042 })).toBe(false);
    // Installed again some other way since: back to comparing times.
    expect(hasUpdate(app, asset, { assetId: 7, versionCode: 1000041 })).toBe(true);
    expect(hasUpdate(app, asset, { assetId: 6, versionCode: 1000042 })).toBe(true);
  });
});

describe("matchApps", () => {
  const apps = [{ packageName: "a.one" }, { packageName: "a.two" }, { packageName: "bank.app" }];

  it("pairs apps with the repository that installed or declares them", () => {
    const repos = [
      { owner: "me", name: "two", packageIds: ["a.two"] },
      { owner: "fork", name: "two", packageIds: ["a.two"] },
      { owner: "me", name: "one", packageIds: ["a.one"] },
    ];
    const links = { "a.one": { owner: "elsewhere", repo: "one" } };
    expect(matchApps(apps, links, repos).map((m) => [m.app.packageName, `${m.owner}/${m.repo}`])).toEqual([
      ["a.one", "elsewhere/one"],
      ["a.two", "me/two"],
    ]);
  });
});

describe("AppIds", () => {
  it("reads every build file into one of the fields its schema has (f0 to f8)", () => {
    expect(APP_BUILD_FILES).toHaveLength(9);
    APP_BUILD_FILES.forEach((path, i) => expect(APP_IDS.source).toContain(`f${i.toString()}: object(expression: "HEAD:${path}")`));
  });
});

describe("builds", () => {
  const at = (minutesAgo: number) => new Date(Date.parse("2026-11-28T12:00:00Z") - minutesAgo * 60_000).toISOString();
  const run = (id: number, workflow: number, name: string, startedAgo: number, extra: Partial<BuildRun> = {}): BuildRun => ({
    id,
    workflow_id: workflow,
    name,
    path: `.github/workflows/${name.toLowerCase()}.yml`,
    event: "push",
    status: "completed",
    conclusion: "success",
    head_branch: "main",
    created_at: at(startedAgo),
    run_started_at: at(startedAgo),
    updated_at: at(startedAgo - 5),
    ...extra,
  });
  const apk = { updated_at: at(118) };

  it("knows the publishing workflow by the run that was going when the APK was uploaded", () => {
    const runs = [run(4, 1, "CI", 10), run(3, 2, "Mobile", 121, { updated_at: at(119) }), run(2, 1, "CI", 121)];
    expect(findPublisher(runs, apk, "latest")).toEqual({ workflowId: 2, branch: "main" });
    // Released from a tag: the next build comes from another tag.
    expect(findPublisher([run(3, 2, "Mobile", 121, { head_branch: "v1.2.0" })], apk, "v1.2.0")).toEqual({ workflowId: 2, branch: null });
  });

  it("falls back to a workflow named for Android, APKs or releases, never a pull request's", () => {
    expect(findPublisher([run(9, 5, "Android", 1, { event: "pull_request" }), run(8, 3, "CI", 2), run(7, 4, "Release", 900)], apk, "latest")).toEqual({ workflowId: 4, branch: null });
    expect(findPublisher([run(8, 3, "CI", 2)], undefined, undefined)).toBeUndefined();
  });

  it("is building while the publisher's latest run on its branch goes, and says when it failed", () => {
    const publisher = { workflowId: 2, branch: "main" };
    const going = run(5, 2, "Mobile", 3, { status: "in_progress", conclusion: null });
    const elsewhere = run(6, 2, "Mobile", 1, { status: "in_progress", conclusion: null, head_branch: "try-this" });
    expect(latestBuild([elsewhere, going, run(3, 2, "Mobile", 121)], publisher)).toEqual({ state: "building", run: going });
    expect(latestBuild([elsewhere, run(3, 2, "Mobile", 121)], publisher)).toBeUndefined();
    const failed = run(5, 2, "Mobile", 30, { conclusion: "failure" });
    expect(latestBuild([failed, run(3, 2, "Mobile", 121)], publisher)).toEqual({ state: "failed", run: failed });
    expect(latestBuild([run(5, 2, "Mobile", 30, { conclusion: "cancelled" })], publisher)).toBeUndefined();
    expect(latestBuild([going], undefined)).toBeUndefined();
  });
});

describe("appReleaseTag", () => {
  const release = (tagName: string, files: string[], isDraft = false) => ({ tagName, isDraft, releaseAssets: { nodes: files.map((name) => ({ name })) } });

  it("takes GitHub's latest release when it has an APK", () => {
    expect(appReleaseTag(release("v2", ["app.apk"]), [release("latest", ["app.apk"])])).toBe("v2");
  });

  it("otherwise the newest release with one: a rolling prerelease, never a draft", () => {
    expect(appReleaseTag(null, [release("latest", ["app.apk", "app.dmg"])])).toBe("latest");
    expect(appReleaseTag(release("v1", ["site.zip"]), [release("next", ["app.apk"], true), release("nightly", ["app.apk"])])).toBe("nightly");
    expect(appReleaseTag(release("v1", ["site.zip"]), [release("next", ["app.apk"], true)])).toBeUndefined();
    expect(appReleaseTag(null, [])).toBeUndefined();
  });
});
