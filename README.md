# GitHub Commander

A fast, review-focused GitHub client for Android, built with [Tauri 2](https://tauri.app), React and Rust.

## Features

**Pull requests**
- **Branch picker** for repositories with many branches: every branch is loaded ahead of time, and typing ranks them, the branch you named first, then names starting with it, then ones containing it. Words can come in any order, separators can be left out ("eng629" finds `eng-629-…`), and Enter picks the top match.
- **Open pull requests**: pick the base and the branch (or a branch of your fork, into its parent), check the commits and the diff, and describe it. Like on github.com, the title comes from the commit or the branch name and the description from the repository's pull request template. There's a Markdown preview, reviewers and a draft option. What you type is kept until the pull request is open. If one is already open for the branches, the app links to it instead.
- Branches you pushed in the last two days that have no pull request get a *Compare & pull request* prompt in the inbox and on the repository's pull requests.
- Inbox with review requests, your PRs, assigned, mentioned and reviewed, with counts, CI status and review state on every row.
- Conversation timeline: comments, reviews with their threads, commits, force-pushes, label and title changes.
- Merge box showing review decision, check status and mergeability, with *Ready for review* and auto-merge controls. Whenever the branch is behind its base, also while merging is blocked for another reason, *Update branch* brings the base in with a merge commit or a rebase (the last one you picked).
- **Files**: syntax-highlighted diffs with word-level change highlighting, wrap toggle, jump-to-file, and per-file *Viewed* state synced with GitHub. Viewed files collapse automatically.
- **Review rules**: with a `.review-rules` file in the repository, every changed file gets a risk verdict (high, medium or low) and a line above its diff that opens what to check in it, grouped by the rule it comes from. The *Review guide* lists every rule that applies to the pull request once, with the files it covers. Files are ordered riskiest first, and approving asks first if a high-risk file isn't marked viewed. See [Review rules](#review-rules).
- Tap any line to comment, or to **suggest a change** that GitHub can apply in one click. Comments are added to a pending review (saved on the device until you submit) or posted immediately.
- Reply to, resolve and unresolve review threads, both in the timeline and inline in the diff.
- Submit reviews (comment, approve or request changes), merge (merge, squash or rebase, with editable commit message and optional branch deletion), enable or disable auto-merge, close or reopen PRs, convert to draft.
- **Checks**: every check run and status, grouped by outcome, with *Re-run failed jobs* for GitHub Actions. GitHub Actions checks open their job in the app.

**Actions**
- Every repository has an *Actions* tab: workflow runs with their live status, filtered by workflow, running or failed.
- A run shows its jobs, with the first errors of failed jobs right in the list. Re-run all jobs, re-run failed jobs, or cancel.
- A job shows its steps (updating live while it runs) and each step's output: colored, with collapsible groups, errors and warnings highlighted. Failed steps open by themselves. GitHub's API only publishes a job's log once the job has finished, so a running job links to the live log on github.com.

**Releases**
- Every repository has a *Releases* tab, and its About tab shows the latest release. A release shows its notes, tag and assets.
- Tap an asset, or the source code as zip or tar.gz, to download it. Android's download manager saves it to Downloads with a progress notification, and tapping the notification opens it (an APK installs). This works for private repositories too.

**Everything else**
- Notifications inbox grouped by repository: filter unread, participating or all; mark done; mark all as read. Opening a notification goes to the matching PR or issue in the app.
- Repositories: yours and starred, with filtering. Each repo shows its README, a code browser with a branch switcher, PRs, issues, Actions and commits. You can also star repos.
- File viewer with syntax highlighting, markdown preview and images.
- Issues: timeline, commenting with quote-reply, close as completed or not planned, and reopen.
- Search across repositories, pull requests, issues and people. Links to github.com inside rendered markdown open in the app when it has a screen for them.
- Light and dark themes follow the system. Pull-to-refresh. The Android back button closes sheets first, then goes back through screens. Screens keep their scroll position.

**Fast**
- The app opens on the data it showed last time (cached on the device) and refreshes it in the background.
- Screens preload: list rows load their screen as they scroll into view (a pull request's diff too, when it's not huge), every link starts loading when touched, and a screen loads its other tabs in the background. Navigating rarely shows a spinner; an end-to-end test fails if opening a pull request from the inbox does.

## Review rules

A `.review-rules` file at the root of a repository says how risky a change to
each file is and what to check when reviewing it. In a pull request, every
changed file shows one verdict and all its instructions.

To have a coding agent write or improve the rules, tap *Copy agent prompt* in a
pull request's Files tab, or *Copy review rules prompt* in a repository's menu,
and paste it into the agent. The prompt explains the format and includes the
current rules, if there are any.

The app reads the rules from the branch a pull request merges into, so new rules
apply once they're merged there. When it finds none, the Files tab names the
branch it checked, and says so if the pull request's own branch has a
`.review-rules`.


```
# What to check, and how carefully.

high apps/backend/prisma/**
  - Migrations run on production data: safe while the previous release
    is still running, and reversible.

high packages/lib/auth/**
  - Check every role, and that one customer never sees another's data.

medium apps/*/src/** !apps/*/src/**/*.test.ts
  - Errors tell the user what to do next.

low **/*.test.ts docs/**
  - The test fails if the change it covers is reverted.

low *.lock

unmatched medium
  - No rule covers this file. Consider adding one.
```

- A rule is `low`, `medium` or `high`, then one or more path patterns, then its
  instructions as indented `- ` items. An indented line without a dash continues
  the item above it. A rule without instructions only sets the risk.
- Patterns work like CODEOWNERS: `*` and `?` stay within a folder, `**` spans
  folders, a pattern without a `/` matches at any depth, a leading `/` anchors it
  to the root, and a folder matches everything inside it.
- A file gets the instructions of every rule that matches it, and its verdict is
  the highest risk among them. The order of the rules doesn't matter.
  `!pattern` leaves files out of that one rule; it can't lower another rule's verdict.
- `unmatched <risk>` (and its instructions) applies to files no rule matches.
  Without it, those files are medium.
- A renamed file is judged by both its old and its new path.
- `#` starts a comment. Lines the app can't read are shown above the files and
  left out.
- The rules are always read from the branch the pull request merges into, so a
  pull request can't lower its own verdicts. A change to `.review-rules` itself is
  always high risk.

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
- All API calls go through Rust commands (`gh_rest`, `gh_graphql`, `gh_job_logs`) that refuse any host other than `https://api.github.com`. Job logs follow GitHub's redirect to its log storage only, and the token is not sent there. For downloads, Rust asks GitHub for the file's short-lived signed link (accepted only on `*.githubusercontent.com` and `codeload.github.com`) and hands only that link to Android's download manager.
- To open instantly, the app caches GitHub's answers in its private storage (IndexedDB inside the app sandbox) for up to a day. Diffs, file contents and job logs are never written to disk. Signing out deletes the cache, and every new build starts with a fresh one.
- Rendered markdown is sanitized with DOMPurify. The content security policy allows only the app's own scripts, no frames, and no network requests from the web view other than images.

## Installing on a phone

Open this link on your phone and install the APK (Android asks you to allow installs from your browser the first time):

**<https://github.com/madsbuch/gh-commander/releases/download/latest/gh-commander.apk>**

If GitHub's own app is installed, Android may open github.com links in it instead of downloading the file. Paste the link into your browser's address bar instead. The installed app is called **GitHub Commander**, and its bottom bar reads *Pull requests · Inbox · Repos · You*.

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

Routes live in `src/routes` (one file per screen, named like its URL). `npm run dev` and `vite build` regenerate `src/routeTree.gen.ts`; commit it, CI fails when it's stale. Links are built with `to.*` from `src/lib/nav.tsx` (or TanStack's `<Link to=...>`), so a link to a screen that doesn't exist fails `npm run typecheck`.

### Project layout

```
src/                  React app
  routes/             file-based routes (TanStack Router): URL, search params and preloading per screen
  routeTree.gen.ts    generated from routes/ by the Vite plugin (commit it)
  router.tsx          router setup: hash history, preloading, scroll restoration
  queries/            TanStack Query: keys.ts (every key, and what each change invalidates),
                      one module per area with query options and mutations, warm.ts (preloading)
  lib/nav.tsx         typed link builders (`to.*`), sheets and the back button
  lib/backend.ts      transport: Tauri commands, or fetch in a plain browser
  lib/queries.ts      GraphQL documents (validated against GitHub's schema in tests)
  lib/logs.ts         Actions log parsing: steps, groups, ANSI colors
  lib/diff.ts         patch parsing and word-level diffs
  lib/reviewRules.ts  .review-rules: parsing, path patterns and per-file verdicts
  screens/            one file per screen; pull/ and actions/ hold their screens' parts
  dev/mock.ts         fixtures for VITE_MOCK=1
e2e/                  Playwright tests against the fixtures
src-tauri/            Rust side
  src/auth.rs         OAuth device flow
  src/github.rs       authenticated REST/GraphQL proxy, locked to api.github.com; job logs, download links
  src/store.rs        session/config persistence
  gen/android/        generated Android project (edge-to-edge insets, browser tabs, downloads, signing config)
app-icon/             icon sources; regenerate with `npx tauri icon app-icon/app-icon.json`
.claude/skills/       procedures: release, android-signing, verify-changes
```
