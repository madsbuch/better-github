# GitHub Commander

A fast, review-focused GitHub client for Android, built with [Tauri 2](https://tauri.app), React and Rust.

## Features

**Pull requests**
- Inbox with review requests, your PRs, assigned, mentioned and reviewed, with counts, CI status and review state on every row.
- Conversation timeline: comments, reviews with their threads, commits, force-pushes, label and title changes.
- Merge box showing review decision, check status and mergeability, with *Update branch*, *Ready for review* and auto-merge controls.
- **Files**: syntax-highlighted diffs with word-level change highlighting, wrap toggle, jump-to-file, and per-file *Viewed* state synced with GitHub. Viewed files collapse automatically.
- Tap any line to comment, or to **suggest a change** that GitHub can apply in one click. Comments are added to a pending review (saved on the device until you submit) or posted immediately.
- Reply to, resolve and unresolve review threads, both in the timeline and inline in the diff.
- Submit reviews (comment, approve or request changes), merge (merge, squash or rebase, with editable commit message and optional branch deletion), enable or disable auto-merge, close or reopen PRs, convert to draft.
- **Checks**: every check run and status, grouped by outcome, with *Re-run failed jobs* for GitHub Actions.

**Everything else**
- Notifications inbox grouped by repository: filter unread, participating or all; mark done; mark all as read. Opening a notification goes to the matching PR or issue in the app.
- Repositories: yours and starred, with filtering. Each repo shows its README, a code browser with a branch switcher, PRs, issues and commits. You can also star repos.
- File viewer with syntax highlighting, markdown preview and images.
- Issues: timeline, commenting with quote-reply, close as completed or not planned, and reopen.
- Search across repositories, pull requests, issues and people. Links to github.com inside rendered markdown open in the app when it has a screen for them.
- Light and dark themes follow the system. Pull-to-refresh. The Android back button closes sheets first, then goes back through screens. Screens keep their scroll position.

## Signing in

There are two ways to sign in:

1. **Sign in with GitHub** uses GitHub's [OAuth device flow](https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow). The app shows a short code. You confirm it on github.com in an in-app browser tab, and the app receives a token. There is no client secret and no redirect URI, which makes this flow a good fit for an installed mobile app.
2. **Personal access token**: paste a classic token with the `repo`, `read:org`, `notifications` and `read:user` scopes.

### Setting up the OAuth app (one-time)

The device flow needs the client id of an OAuth app that you own:

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App** (<https://github.com/settings/applications/new>).
2. Fill in any name, homepage URL and callback URL. The callback URL is not used.
3. After creating the app, tick **Enable Device Flow** and save.
4. Copy the **Client ID**. You don't need a client secret.

Then do one of the following:

- **Bake it into builds**: set the repository variable `GH_COMMANDER_CLIENT_ID` under *Settings → Secrets and variables → Actions → Variables*. CI picks it up. For local builds, export `GH_COMMANDER_CLIENT_ID` before building.
- **Enter it in the app**: on the login screen, tap *Sign in with GitHub* and paste the client id. You can change it later under *Settings*.

### Security

- The token lives only on the Rust side, in the app's private data directory (the Android app sandbox), and is never exposed to the web view.
- All API calls go through two Rust commands (`gh_rest`, `gh_graphql`) that refuse any host other than `https://api.github.com`.
- Rendered markdown is sanitized with DOMPurify. The content security policy allows only the app's own scripts, no frames, and no network requests from the web view other than images.

## Installing on a phone

Open this link on your phone and install the APK (Android asks you to allow installs from your browser the first time):

**<https://github.com/madsbuch/gh-commander/releases/download/latest/gh-commander.apk>**

Every push to `main` rebuilds the APK and replaces it in the [`latest` release](https://github.com/madsbuch/gh-commander/releases/tag/latest), so the link always serves the newest build. Each build gets a higher Android `versionCode`, so a newer APK installs as an update and keeps your sign-in. Builds of other branches and pull requests are attached to their **Android** workflow run as the `gh-commander-apk` artifact.

### Signing

CI signs release builds with this app's own upload key, from these repository secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE` | the keystore file, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password, also used as the key password |
| `ANDROID_KEY_ALIAS` | the key alias |

For local release builds, put the same values in the git-ignored `src-tauri/gen/android/keystore.properties` (`keyAlias`, `password`, `storeFile`). Keep the keystore: Android only installs updates signed with the same key. Without the secrets, CI signs with a throwaway debug key, and you have to uninstall the old build before installing a new one.

## Development

Requirements: Node 22+, Rust (stable), and for Android: JDK 17+, the Android SDK and NDK ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```sh
npm install

# UI in a desktop browser against fake data (no account needed)
VITE_MOCK=1 npm run dev

# Desktop app
npm run tauri dev

# Android (device or emulator)
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npm run tauri android dev
npm run tauri android build -- --apk
```

In a plain browser (`npm run dev` without `VITE_MOCK`), the app calls the GitHub API directly with a personal access token. The device flow only works inside the app, because github.com doesn't allow cross-origin requests to its OAuth endpoints.

Checks (all run in CI):

```sh
npm run typecheck   # TypeScript
npm test            # unit tests + every GraphQL query validated against GitHub's schema
npm run e2e         # Playwright: navigation, back button, review and merge flows on fixtures
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

`npm run e2e` downloads Chromium on first use (`npx playwright install chromium`). To use a Chromium you already have, set `PW_CHROMIUM=/path/to/chrome`.

### Project layout

```
src/                  React app
  lib/backend.ts      transport: Tauri commands, or fetch in a plain browser
  lib/queries.ts      GraphQL documents (validated against GitHub's schema in tests)
  lib/router.tsx      stack navigator on the History API (Android back button)
  lib/diff.ts         patch parsing and word-level diffs
  screens/            one file per screen; pull/ holds the PR review screens
  dev/mock.ts         fixtures for VITE_MOCK=1
e2e/                  Playwright tests against the fixtures
src-tauri/            Rust side
  src/auth.rs         OAuth device flow
  src/github.rs       authenticated REST/GraphQL proxy, locked to api.github.com
  src/store.rs        session/config persistence
  gen/android/        generated Android project (edge-to-edge insets, signing config)
app-icon/             icon sources; regenerate with `npx tauri icon app-icon/app-icon.json`
```
