import { describe, expect, it } from "vitest";
import { hasUpdate, matchApps, packageIdsFromFiles, pickApk } from "./appMatch";
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
