---
name: verify-changes
description: Checks to run before pushing GitHub Commander to main, and how to see the UI without a GitHub account. Use before every push (every push to main publishes a release), after changing GraphQL queries, REST calls, navigation, Rust commands or Android files, or when asked to test, screenshot or debug the app.
---

# Verifying changes

Every push to `main` publishes the APK (see the `release` skill), and CI does not
gate publishing. Run these first, from the repo root:

```sh
npm run typecheck                 # TypeScript (app + node configs)
npm test                          # unit tests + every GraphQL query checked against GitHub's schema
npm run e2e                       # Playwright on the fixture backend (see below)
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

- `npm run e2e` downloads Chromium on first use (`npx playwright install chromium`).
  To use an existing Chromium instead: `PW_CHROMIUM=/path/to/chrome npm run e2e`.
- The Rust checks build the desktop target. On Linux that needs
  `libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev`.
- Android itself only builds in CI (it needs the Android SDK and NDK). For changes
  under `src-tauri/gen/android`, push and watch the Android run.

## Seeing the UI without GitHub

`VITE_MOCK=1 npm run dev` serves the real UI at http://localhost:1420 against
fixtures in `src/dev/mock.ts`. You don't need a network connection or a token.
Add `?signedOut` to the URL to see the login screen. The mock is stripped from
production builds.

The fixtures dispatch GraphQL by **operation name** (`query PullThreads …`) and REST
by path. When adding a query or endpoint, add a fixture there too, or the screen
renders empty in dev and in the e2e smoke tests.

## When touching the GitHub API

- GraphQL documents live in `src/lib/queries.ts`. Add new ones to `ALL_DOCUMENTS`
  so `npm test` validates them against `@octokit/graphql-schema`. GitHub's API isn't
  reachable from every dev environment, and this test catches typos, wrong
  arguments and field conflicts offline.
- Fields with the same name on different union members must have the same type, or
  the query is rejected. Alias one side (`issueState: state` on `Issue` next to
  `PullRequest.state`). Nullability counts too: `Team.avatarUrl` (nullable) can't
  share a selection with `User.avatarUrl` (non-null).
- All calls go through Rust (`gh_rest` / `gh_graphql` in `src-tauri/src`), which
  only talks to `https://api.github.com`. The token never reaches the web view. In
  the frontend, use `rest()` / `graphql()` from `src/lib/api.ts`.
- If you rename a Tauri command or its arguments, update `src/lib/backend.ts`. The
  IPC contract tests in `src-tauri/src/ipc_tests.rs` call commands with the
  frontend's exact argument shapes.

## When touching navigation

The router (`src/lib/router.tsx`) maps screens and bottom sheets onto browser
history, so the Android back button closes sheets first, then pops screens.
Always navigate with `nav.navigate` / `nav.replace` / `nav.resetTo` or `<Link>`,
and open modals with `Sheet` / `ActionSheet` (which register with `useOverlay`).
`e2e/navigation.spec.ts` covers the tricky cases, such as navigating or replacing
from inside a sheet. Keep it passing.
