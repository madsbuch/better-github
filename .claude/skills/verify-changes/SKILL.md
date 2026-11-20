---
name: verify-changes
description: Checks to run before pushing Better GitHub to main, how to see the UI without a GitHub account, and the rules for routes, query keys, invalidation and preloading. Use before every push (every push to main publishes a release), after changing GraphQL queries, REST calls, routes or links, query keys or mutations, Rust commands or Android files, or when asked to test, screenshot or debug the app.
---

# Verifying changes

Every push to `main` publishes the APK (see the `release` skill), and CI does not
gate publishing. Run these first, from the repo root:

```sh
npm run typecheck                 # TypeScript (app + node configs)
npm run lint                      # oxlint, type-aware: the strictness rules below
npm test                          # unit tests + every GraphQL query checked against GitHub's schema
npm run e2e                       # Playwright on the fixture backend (see below)
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

- `npm run e2e` downloads Chromium on first use (`npx playwright install chromium`).
  To use an existing Chromium instead: `PW_CHROMIUM=/path/to/chrome npm run e2e`
  (in Claude Code cloud sessions: `PW_CHROMIUM=/opt/pw-browsers/chromium`).
- `npx vite build` regenerates `src/routeTree.gen.ts`; commit it with route changes.
  CI fails when the committed copy is stale.
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
by path (Actions: `actionsBody`; releases: `releasesBody`; new pull requests:
`newPullRest`; job logs: `JOB_LOG`). The branch picker reads `ALL_BRANCHES`: 240
branches over three pages, with an old `staging` last, to exercise paging and
ranking. `ROCKET_REVIEW_RULES` is acme/rocket's `.review-rules` on
main: pull request 482 gets one file of each verdict, and pull request 483 also
edits the rules. `ROCKET_SPEC` is acme/rocket's `.spec` folder on main (on
`staging` one item can't be read). After changing the item schema in
`src/lib/spec.ts`, run `npm run spec:schema` and commit `schema/spec.schema.json`.
Android-only bridges (`window.GhCommanderDownloads`)
are faked in e2e with `page.addInitScript` (see `e2e/releases.spec.ts`). When adding a query or
endpoint, add a fixture there too, or the screen renders empty in dev and in the
e2e smoke tests.

## Strict types

The app is strict on types end to end; CI enforces it.

- **Parse at the edge.** Nothing from outside (GitHub responses, Rust command
  results, localStorage, Android bridges) is used before a zod schema has
  checked it. `rest(schema, path)`, `restPage(itemSchema, …)`, `restAll(itemSchema, …)`
  and `graphql(DOCUMENT, vars)` parse for you (`src/lib/api.ts`); `restSend` is for
  calls made only for their effect. Stored JSON goes through `parseJson(schema, text)`
  (`src/lib/schema.ts`). Never `JSON.parse(...) as X`.
- **Types come from schemas.** `export const Foo = z.object(...)` with
  `export type Foo = z.infer<typeof Foo>`. GraphQL result schemas live in
  `src/lib/types.ts` and are paired with their document in `src/lib/queries.ts`
  (`gql(Schema, source)`). Use `nodes(item)` for connection `nodes` and
  `byTypename([...])` for unions/interfaces (unknown `__typename`s pass as
  `{ __typename }`, so handle that case).
- **Schemas can't be stricter than GitHub.** `queries.test.ts` walks every
  document with its schema against GitHub's GraphQL schema: a field GitHub may
  return as null must be `.nullable()`, enums must list every value, and the
  schema may only require fields the document selects. REST schemas are
  narrow (only fields the app reads) and `src/lib/restConformance.*.ts` makes
  `tsc` check GitHub's OpenAPI types satisfy them.
- **No escape hatches.** No `any`, no `as` (except `as const`), no `!`, no
  `@ts-ignore`. tsconfig adds `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- **No coercion.** Conditions must be booleans: compare explicitly
  (`!== null`, `!== ""`, `> 0`) instead of relying on truthiness of strings,
  numbers or nullable values (nullable objects are fine). No `String(x)`/`+x`/`!!x`,
  no `==`, template literals only with strings and numbers.
- **Rust:** `unsafe` is forbidden; clippy denies `as` casts, `unwrap`/`expect`/`panic`
  and slice indexing outside tests (`src-tauri/Cargo.toml`). JSON from GitHub is
  either parsed into typed structs (errors, GraphQL envelope) or passed through
  untouched as `RawValue` for the frontend to parse; no `serde_json::Value`.

## When touching data (TanStack Query)

- Every query key comes from `keys` in `src/queries/keys.ts`, one hierarchy:
  `["repo", owner, repo, "pull", number, ...]` and so on. Owner and repo are
  lowercased there; never build keys by hand.
- Each area has a module in `src/queries/` exporting `queryOptions` /
  `infiniteQueryOptions` factories (`pullQueries.detail(...)`). Screens call
  `useQuery(pullQueries.detail(...))`; loaders and prefetches use the same
  factory, so they share the cache.
- Mutations use `useAppMutation` (`src/queries/mutation.ts`) and declare what they
  change with `invalidates: affects.pull(...)` etc. Add a new kind of change to
  `affects` rather than invalidating ad hoc, and cover it in `keys.test.ts`.
  Optimistic updates go through `optimistic` + `patchQueries`, which returns the
  undo. Errors become toasts automatically.
- Large or short-lived data (diffs, files, logs) sets `meta: { persist: false }`
  so it stays out of the on-device cache (`src/queries/client.ts`).
- GraphQL documents live in `src/lib/queries.ts`, each with its result schema.
  Add new ones to `ALL_DOCUMENTS` so `npm test` validates them (and their
  schemas) against `@octokit/graphql-schema`. GitHub's API isn't
  reachable from every dev environment, and this test catches typos, wrong
  arguments and field conflicts offline.
- Fields with the same name on different union members must have the same type, or
  the query is rejected. Alias one side (`issueState: state` on `Issue` next to
  `PullRequest.state`). Nullability counts too: `Team.avatarUrl` (nullable) can't
  share a selection with `User.avatarUrl` (non-null).
- All calls go through Rust (`gh_rest` / `gh_graphql` / `gh_job_logs` in
  `src-tauri/src`), which only talks to `https://api.github.com`. The token never
  reaches the web view. In the frontend, use `rest()` / `graphql()` from
  `src/lib/api.ts`.
- If you rename a Tauri command or its arguments, update `src/lib/backend.ts`. The
  IPC contract tests in `src-tauri/src/ipc_tests.rs` call commands with the
  frontend's exact argument shapes.

## When touching routes and links (TanStack Router)

- One file per screen in `src/routes/`, named like the URL (`$owner/$repo/pull/$number.tsx`).
  It declares `validateSearch` (with an explicit type, all keys optional),
  `params.parse` for numeric params (return `false` to not match, and keep the
  other params), a `loader` and the screen component.
- Screens read params and search with `getRouteApi("<route id>")`.
- Build links with `to.*` from `src/lib/nav.tsx` (`<Link {...to.pull(o, r, n)}>`),
  never from strings: links are type-checked against the generated route tree.
  github.com URLs map to the same targets in `appLinkForUrl` (`src/lib/links.ts`,
  with tests).
- Navigate programmatically with `useNav()` (`navigate`, `replace` for tabs and
  filters, `back`, `resetTo` for the bottom tabs). It cooperates with sheets: each
  open `Sheet` / `ActionSheet` (via `useOverlay`) adds a history entry (`?o=N`), so
  the Android back button closes sheets first, and navigating from a sheet unwinds
  them first.
- The history is hash-based and reads only the hash (`src/router.tsx`); the page's
  own query string (`?signedOut`, the e2e `?load=N`) never reaches routes.
- When building a target from the current search, list the keys you keep
  (`{ base: search.base, ...next }`) rather than spreading it: the current search
  carries the open sheet's `o`. `useNav` drops `o` as a safety net.

## Preloading (no spinners)

- Loaders call `warm(queryClient, [primary...], { secondary, preload })`
  (`src/queries/warm.ts`): it waits at most 250 ms for the primary data, then lets
  the screen render, and starts secondary data only on real navigations.
- List rows link with `preload="viewport"`, so their screen's data loads as they
  scroll into view; every link also preloads on touch (`defaultPreload: "intent"`).
- Screens with tabs prefetch the other tabs' data on mount.
- Data that depends on other data chains after it in the loader: a pull
  request's diff needs its head commit, so `warmPullDiff` loads it right after
  the details, ahead of time only for diffs up to 100 files and 2,000 lines.
- `e2e/navigation.spec.ts` fails if a spinner or skeleton appears while opening a
  pull request from the inbox, and `e2e/branches.spec.ts` if the branch picker
  opens empty (`watchForLoading` in `e2e/helpers.ts`, which watches screens and
  sheets). Keep them passing; add similar checks for new hot paths. A failure
  names the screen and tab the spinner was on: that's the data to preload. CI
  runs one worker on Chrome's headless shell, which is faster at clicking than
  the full browser; reproduce with
  `PW_CHROMIUM=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell npx playwright test --workers=1`.
- Branch pickers (`BranchSheet`) share one list per repository
  (`branchQueries.list`, every branch, newest first). Screens that show a picker
  load it in advance; the compare screen loads every page while it's open.
- Scroll positions: the scrolling element is `.content[data-scroll-restoration-id="screen"]`;
  the router restores it on back and resets it for new screens.
