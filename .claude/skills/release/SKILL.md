---
name: release
description: Ship a new Android build of GitHub Commander. Use when asked to release, deploy, publish or ship the app, to check whether a build reached the phone download link, or when the "latest" release looks stale or wrong.
---

# Releasing GitHub Commander

There is no manual release step: **every push to `main` publishes.** Work happens
directly on `main` (no feature branches needed).

## What a push to `main` does

`.github/workflows/android.yml` (job "Build APK"):

1. Builds a release APK for arm64 and 32-bit ARM (`--target aarch64 --target armv7`,
   one universal APK).
2. Signs it with the app's own key from the `ANDROID_KEYSTORE`,
   `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` secrets (see the
   `android-signing` skill).
3. Sets `versionCode` = semver code (`major*1000000 + minor*1000 + patch` of
   `src-tauri/tauri.conf.json` `version`) + the workflow run number, so each build
   installs over the previous one as an update.
4. Uploads the APK as the run's `gh-commander-apk` artifact.
5. Only on `main`: force-moves the `latest` tag to the commit and replaces
   `gh-commander.apk` on the single `latest` prerelease (created on first use),
   refreshing its notes with the commit and build number.

Phone download link, always the newest `main` build:
<https://github.com/madsbuch/gh-commander/releases/download/latest/gh-commander.apk>

Pushes to other branches and pull requests build the artifact but never touch the
release. `.github/workflows/ci.yml` (lint, tests, e2e) runs separately and does
**not** gate publishing, so a push with failing tests still ships.

## Steps

1. Run the checks in the `verify-changes` skill. They are the only gate.
2. Commit and `git push origin main`.
3. Watch the **Android** run: `gh run list --workflow Android --branch main`, then
   `gh run watch <id>`. A warm build takes about 6 minutes, a cold one (new
   dependencies or an expired cache) about 13.
4. Confirm: `gh release view latest` shows the new commit in its notes and a fresh
   `gh-commander.apk` asset.

Rapid pushes cancel older in-flight builds (`concurrency: cancel-in-progress`), so
only the newest commit publishes.

## Versions

To bump the visible version, change `version` in `src-tauri/tauri.conf.json`
(also `package.json` and `src-tauri/Cargo.toml` to keep them in step). The
`versionCode` keeps increasing because it includes the run number. Never make it
go down: Android refuses to install a lower `versionCode` over a higher one.

## Troubleshooting

- **Warning "ANDROID_KEYSTORE is not set"** in the "Write signing config" step: the
  secrets are missing, so the APK is signed with a throwaway debug key and can't
  update an installed copy. Set them up with the `android-signing` skill. In a
  correctly configured run the step's env shows `KEYSTORE_B64: ***`.
- **Publish step skipped**: the run wasn't on `main`.
- **Gradle `packageUniversalReleaseResources` fails**: usually an invalid resource
  XML under `src-tauri/gen/android/app/src/main/res`. For example, XML comments must
  not contain `--`.
- **Phone says the app isn't installed / package conflicts**: the installed copy was
  signed with a different key (e.g. an old debug-signed build). Uninstall once, then
  install the release.
- **The download link 404s for a few seconds**: `gh release upload --clobber`
  replaces the asset in place. Retry after the run finishes.
