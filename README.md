# Better GitHub

A fast GitHub client for Android phones and tablets and for the desktop (macOS, Windows, Linux), built around your repositories with [Tauri 2](https://tauri.app), React and Rust.

## Features

**Repository home**
- The app opens on your repositories, with filtering and a Starred tab. Primary navigation is *Repos · Orgs · You · Settings*.
- **Settings** has its own section, as a menu of pages: Account (sign out, rate limit), Appearance, Code and diffs, GitHub sign-in, Keyboard shortcuts and About. On a phone each page is a screen; from tablet width the menu stays beside the open page. Switching between light and dark cross-fades, unless the device asks for reduced motion.
- **Organizations** has its own section: the organizations you belong to, each with its description and how many repositories it has, opening the organization's page.
- Each repository's Overview puts *Pull requests*, *Releases* and *Builds* up front: review changes, download a release, or inspect and retry a workflow run.
- Account-wide pull requests and notifications remain available under *You*.

**Pull requests**
- **Branch picker** for repositories with many branches: every branch is loaded ahead of time, and typing ranks them, the branch you named first, then names starting with it, then ones containing it. Words can come in any order, separators can be left out ("eng629" finds `eng-629-…`), and Enter picks the top match.
- **Open pull requests**: pick the base and the branch (or a branch of your fork, into its parent), check the commits and the diff, and describe it. Like on github.com, the title comes from the commit or the branch name and the description from the repository's pull request template. There's a Markdown preview, reviewers and a draft option. What you type is kept until the pull request is open. If one is already open for the branches, the app links to it instead.
- Branches you pushed in the last two days that have no pull request get a *Compare & pull request* prompt in the inbox and on the repository's pull requests.
- Inbox with review requests, your PRs, assigned, mentioned and reviewed, with counts, CI status and review state on every row.
- Conversation timeline: comments, reviews with their threads, commits, force-pushes, label and title changes.
- Merge box showing review decision, check status and mergeability, with *Ready for review* and auto-merge controls. Whenever the branch is behind its base, also while merging is blocked for another reason, *Update branch* brings the base in with a merge commit or a rebase (the last one you picked).
- **Files**: syntax-highlighted diffs with word-level change highlighting, wrap toggle, jump-to-file, and per-file *Viewed* state synced with GitHub. Viewed files collapse automatically.
- **Review rules**: with a `.review-rules` file in the repository, every changed file gets a risk verdict (high, medium or low) and a line above its diff that opens what to check in it, grouped by the rule it comes from. The *Review guide* lists every rule that applies to the pull request once, with the files it covers. Files are ordered riskiest first, and approving asks first if a high-risk file isn't marked viewed. See [Review rules](#review-rules).
- **Spec**: with a `.spec` folder in the repository, the app shows what the code is meant to do: an outline of items with their user stories, requirements and pictures. Two branches' specs can be compared item by item, and a pull request that changes the spec links to that comparison. See [Spec](#spec).
- Tap any line to comment, or to **suggest a change** that GitHub can apply in one click. Comments are added to a pending review (saved on the device until you submit) or posted immediately.
- Reply to, resolve and unresolve review threads, both in the timeline and inline in the diff.
- Submit reviews (comment, approve or request changes), merge (merge, squash or rebase, with editable commit message and optional branch deletion), enable or disable auto-merge, close or reopen PRs, convert to draft.
- **Checks**: every check run and status, grouped by outcome, with *Re-run failed jobs* for GitHub Actions. GitHub Actions checks open their job in the app.

**Actions**
- Every repository has an *Actions* tab: workflow runs with their live status, filtered by workflow, running or failed.
- A run shows its jobs, with the first errors of failed jobs right in the list. Re-run all jobs, re-run failed jobs, or cancel.
- A job shows its steps (updating live while it runs) and each step's output: colored, with collapsible groups, errors and warnings highlighted. Failed steps open by themselves. GitHub's API only publishes a job's log once the job has finished, so a running job links to the live log on github.com.

**Releases**
- Every repository has a *Releases* tab, and its Overview shows the latest release. A release shows its notes, tag and assets.
- Tap an asset, or the source code as zip or tar.gz, to download it. Android's download manager saves it with a progress notification; the release page also shows progress and an **Open** action once it finishes. Download references survive navigation and app restarts, so opening the release again doesn't download a second copy. This works for private repositories too.
- Opening an APK launches Android's installer. If Android first asks to allow installs from Better GitHub, grant that permission, return to the release and tap **Open** again. Failed or deleted downloads can be retried, and a separate download button lets you fetch another copy.

**Browse without signing in**
- *Browse without signing in* on the sign-in screen opens a guest mode: add GitHub users and organizations to a list, and the app shows their public repositories, newest first, with a filter per profile.
- Guests can open profiles, a repository's overview and README, code, commits, releases (including downloads) and Actions runs. Pull request and issue lists, search and notifications need GitHub's GraphQL API, which always needs a token, so they appear once you sign in.
- Without a token, GitHub allows 60 requests an hour, so guest mode loads only what you open (no preloading) and keeps data for 10 minutes. Settings shows how many requests are left. The list of profiles stays on the device; signing in leaves guest mode.

**Everything else**
- Notifications inbox grouped by repository: filter unread, participating or all; mark done; mark all as read. Opening a notification goes to the matching PR or issue in the app.
- Repositories: yours and starred, with filtering. Each repo shows its README, a code browser with a branch switcher, PRs, issues, Actions and commits. You can also star repos.
- File viewer with syntax highlighting, markdown preview and images.
- Issues: timeline, commenting with quote-reply, close as completed or not planned, and reopen.
- Search across repositories, pull requests, issues and people. Links to github.com inside rendered markdown open in the app when it has a screen for them.
- Light and dark themes follow the system. Pull-to-refresh. The Android back button closes sheets first, then goes back through screens. Screens keep their scroll position.
- **Tablets**: at window widths of 768px and up, navigation stays in a side rail, including while reviewing a pull request. Code, diffs and logs use the available width; reading views stay comfortably bounded. Sheets become inset dialogs. Rotation and split-screen resizing keep the current screen and unfinished comments intact, switching back to the phone layout in narrow windows.

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

## Spec

A `.spec` folder at the root of a repository says what its code is meant to do.
Every `.json` file in it is one item of the spec, and all of them follow one
schema: [`schema/spec.schema.json`](schema/spec.schema.json). Anything else in
the folder is an asset, such as a picture an item shows. This repository has
one; open it from the repository's Overview, or *Browse spec* in its menu.

```
.spec/
  index.json              the root: what the product is
  uploads/
    index.json            "Uploads", with the items below as its children
    retries.json          "Retries"
  assets/
    backoff.png
```

```json
{
  "$schema": "https://raw.githubusercontent.com/madsbuch/better-github/main/schema/spec.schema.json",
  "title": "Retries",
  "summary": "A failed upload is tried again, with growing pauses.",
  "description": "Networks drop. An upload that fails for a reason that may pass is tried again.",
  "stories": [
    { "id": "US-1", "as": "a commuter sending a file from a train", "want": "the upload to survive the tunnel", "soThat": "I don't have to start it again", "requirements": ["#RET-1"] }
  ],
  "requirements": [
    { "id": "RET-1", "text": "An upload that fails with a 5xx response is retried, up to five times." },
    { "id": "RET-2", "text": "The pause before a retry doubles each time.", "level": "should" }
  ],
  "figures": [{ "src": "assets/backoff.png", "caption": "Pauses double between attempts." }],
  "related": ["#ERR-1"]
}
```

- **The folders are the outline.** An item's id is its path without `.spec/` and
  `.json` (`uploads/retries`). A folder's own item is its `index.json`; a folder
  without one is still a group, named after the folder. Folders nest as deep as
  the product needs.
- Only `title` is required. There is no status: everything in a spec is what
  the product is to do, except what was dropped (below). Planning states such
  as draft or accepted live where the product is managed, and whether the
  product meets a requirement is found out by comparing the two. `order` places an item among its siblings; the
  rest follow by title.
- **User stories** say who wants what, and why: `as`, `want` and optionally
  `soThat`, read as "As ..., I want ..., so that ...". A story can name the
  `requirements` that make it true. Stories and requirements share one set of
  ids. A story has no versions; it is deprecated, with the reason, when nobody
  wants it any more.
- **Named values** are what the product decides once and uses in many places:
  a color, a size, a time, a limit, a piece of wording, a font, a list of
  names. Each has an `id` (`retry.max`, `color.accent`), a `type` and a `value`;
  requirements name it in backticks instead of repeating it, and the app shows
  what it is next to the name. A change to a value records what it was and why.
- **There are no open questions** in a spec: what isn't decided belongs where
  the product is planned, and enters the spec once it is.
- **Requirements** are single statements that can be checked against the code.
  Each has an `id` that is **unique in the whole spec**, not just in its item,
  and doesn't change: code, tests and other items refer to a requirement by
  that id alone, and the comparison follows it when it moves to another item.
  A prefix per item (`RET-1`, `RET-2`) keeps ids apart. An id used twice is
  listed as a problem. `level` is `must` (the default), `should` or `may`.
- **Requirements have versions.** When what a requirement means changes, its
  id stays and its `version` goes up by one; what it said before goes into
  `history` with the `reason` it changed (and optionally the `date`). A
  requirement at version 3 has the history of versions 1 and 2; numbers that
  don't agree are listed as a problem. A wording fix that changes nothing needs
  no new version. `#RET-1@2` refers to one version. The browser shows a
  requirement's version and, on tap, its earlier versions with their reasons.
- **Deprecated means deleted, and kept.** A requirement that is no longer
  wanted stays in its file with a `deprecation` that says why (`reason`, and
  optionally `replacedBy` and `date`). It no longer holds; it is kept so that
  it is known why it went, and so that it doesn't come back unnoticed. Stories,
  values and whole items are deprecated the same way. Deprecated requirements
  are folded away under the live ones and aren't counted among them.
- Text is plain: a blank line starts a paragraph, lines starting with `- ` form
  a list, and `` `backticks` `` mark code.
- `figures` name pictures by their path from `.spec`. `related` lists ids of
  other items (`uploads/errors`) or requirements (`#ERR-1`, or
  `uploads/errors#ERR-1`).
- **Index and search.** The spec's first page lists every requirement, user
  story and named value by id, and everything that was dropped. Its search
  covers all of it and puts the id you typed first; Enter on an exact id opens
  it. Searching everything also shows what was dropped, so an idea that was
  dropped before is seen before it is added again.
- **Several points of view, reconciled afterwards.** A product can be
  specified from more than one angle (what motivates, what the research says),
  each as parts that read on their own, and two can state the same behavior. A
  requirement, story or value says what else it touches with `related`; that is
  written at one end and shown at both. A spec is changed one part at a time.
  Every comparison then lists what is related to a change and wasn't changed
  itself, and both handovers tell the agent to reconcile first: check those,
  find and link what nobody linked, and report contradictions instead of
  settling them.
- **Checking consistency.** Whether a spec agrees with itself can't be proven,
  and the links between entries aren't for people to maintain. The spec's first
  page offers a prompt for a coding agent to read the whole spec, keep the
  `related` pointers, fix what has one answer, and report contradictions for a
  person to decide, ending with a plain best-effort statement.
- **The code cites the spec, not the other way round.** A comment
  `// Spec: RET-1` sits on the code that meets a requirement and above the
  test that proves it. Searching the code base for an id finds what to change
  when that requirement does. In this repository a test fails when a cited id
  isn't in the spec or is deprecated.
- **A spec can specify internals** (an architecture, a data model, a
  protocol), as requirements in words. Code references are not part of the
  format: there is no field that points at files. Items that still carry the
  old `code` list are read without it and listed as a problem that says to
  remove it.
- **Shared parts.** Products can share a part of their spec, such as how
  their devices sync. The part is written once in a spec of its own (for
  example [madsbuch/spec-repo](https://github.com/madsbuch/spec-repo)), and
  each product copies its folder in whole, at the same path. The root item
  records each copy in `imports`: the folder, the repository, the commit and git's
  id for the folder at that commit. A copy that differs from that is listed as a
  problem, because the change belongs in the shared spec. In its import, a
  product can place the part in its outline (`order`), set one of the part's
  named values differently (`values`) and waive what doesn't hold for it
  (`waived`), each with the reason. An import of a missing folder, or a value
  or waiver that isn't in the part, is listed as a problem.
- Unknown keys are errors, so a typo doesn't silently drop a field. A file the
  app can't read, a figure that isn't there or a reference that leads nowhere is
  listed above the outline; everything else still shows.

[`spec-llms.txt`](spec-llms.txt) at the root of this repository describes the
format for coding agents: the layout, an example, the schema, deprecation, and
how to work in a repository that has a spec. Point an agent at
`https://raw.githubusercontent.com/madsbuch/better-github/main/spec-llms.txt`.
Like the schema, it is generated (`npm run spec:schema`) and a test fails when
it is stale.

To have a coding agent write a spec, for a new project or one that already has
code, use *Copy spec prompt* in a repository's menu (or *Copy agent prompt* on a
branch without a spec) and paste it into the agent. The prompt carries the
format, the schema and what makes a good spec. For a repository that has a
spec, it also carries the outline and the problems the app found.

### Comparing two specs

The compare button in the spec browser shows what differs between the specs of
two branches, by meaning rather than by line: which items were added, removed,
moved or changed, and in a changed item which fields, requirements, figures and
lists. Items are matched by id and requirements by their id within the item, so
a reworded requirement shows its old and new text with the differing words
marked, and a figure whose file changed shows both pictures.

Above the changes is a list of what **takes something away** from the spec: a
deleted requirement or item (it should have been deprecated), a deprecation
with its reason, a level lowered from must to should, a status that went back.
A rewritten or shortened history is listed there too. Each is marked on its item, and the changes can be narrowed to those.
A new version of a requirement shows with its why; a requirement whose text or
level changed at the same version is marked for the reviewer to judge. A
requirement that moved to another item is followed by its id and shown as moved.

### Reviewing spec changes in a pull request

In a pull request's Files tab, each spec item's file is shown as what changed in
that item instead of as a JSON diff (the file's menu switches back). The card
has the file's *Viewed* toggle and review verdict. Every changed requirement and
field takes a comment: it goes on the line of the file that part is on, so it is
an ordinary review comment on GitHub, and here it shows at the requirement it is
about. A summary above the files counts what changed in the spec and lists what
takes something away. The changes are measured against the commit the branch started
from, so what happened on the base branch since doesn't show up as the pull
request's doing.

### Reworking a spec

The pencil in the spec browser turns reading into reworking. Each requirement
gets *Revise* and *Deprecate*, each part *Edit this part*, and there are buttons
to add a requirement or a part. The forms do the bookkeeping: a revision that
changes what a requirement means becomes a new version and asks why, a wording
fix doesn't, a deprecation asks why, and a new requirement gets an id nothing
else in the spec has.

The changes are a draft on the device, laid over the spec you are reading,
that survives leaving the app; turning the pencil off shows the repository's
spec again. Nothing is written to the repository until you hand the draft over.
*Review & hand over* shows it like any change to a spec (what changed, what
takes something away) and offers two ways out:

- **Open a pull request.** One commit with the changed spec files, on a new
  branch, into the branch you were reading. Its description says what changed
  and why and tells a coding agent what to do: point your agent at the pull
  request and it adds the implementation to it. The draft is then gone from
  the device.
- **Copy for my agent.** The same as text, with the complete new contents of
  each changed file, for an agent that opens the pull request itself. Once that
  is merged, the draft's changes drop out by themselves.

The pull request also gets a **Spec tab**, between Files and Commits, for
reading the spec changes and nothing else: no code and no JSON. It starts with
the summary and a list of the changed parts in the outline's order, each with a
tick once viewed and a count of its comments. Below, each part is laid out for
reading, with reworded text shown as one sentence that has the old words struck
through and the new ones marked. Comments and viewed marks are the same as in
the Files tab, since each part is one file. *To read* narrows the tab to what
isn't viewed yet.

### Large specs

A spec's size doesn't matter. The app lists the folder's files in one request and
reads their contents in batches of 40, by git object id, only for what is being
looked at: the outline of a 3,000-item spec reads the root and the top-level
folders. A file that is the same on two branches is read once, so comparing two
versions reads only the items that differ. Specs of up to 300 items are read
whole; filtering a larger one reads the rest the first time. Long lists show 100
rows at a time.

The schema file is generated from the one the app reads with
(`src/lib/spec.ts`): run `npm run spec:schema` after changing it. A test fails
when they differ, and another when this repository's own `.spec` has problems.

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

## Installing on a phone or tablet

Open this link on your phone or tablet and install the APK (Android asks you to allow installs from your browser the first time):

**<https://github.com/madsbuch/better-github/releases/download/latest/better-github.apk>**

If GitHub's own app is installed, Android may open github.com links in it instead of downloading the file. Paste the link into your browser's address bar instead. The installed app is called **Better GitHub**, and its navigation reads *Repos · You* — along the bottom on phones and in a side rail on tablets.

Every push to `main` rebuilds the APK and replaces it in the [`latest` release](https://github.com/madsbuch/better-github/releases/tag/latest), so the link always serves the newest build. Each build gets a higher Android `versionCode`, so a newer APK installs as an update and keeps your sign-in. Builds of other branches and pull requests are attached to their **Android** workflow run as the `better-github-apk` artifact.

Better GitHub updates existing GitHub Commander installations in place. The application ID, signing key and stored data are unchanged, and the old `gh-commander.apk` download link continues to serve the current build.

### Signing

CI signs release builds with this app's own upload key, from these repository secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE` | the keystore file, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password, also used as the key password |
| `ANDROID_KEY_ALIAS` | the key alias |

For local release builds, put the same values in the git-ignored `src-tauri/gen/android/keystore.properties` (`keyAlias`, `password`, `storeFile`). Keep the keystore: Android only installs updates signed with the same key. Without the secrets, CI signs with a throwaway debug key, and you have to uninstall the old build before installing a new one.

## Installing on a computer

Every push to `main` also builds the desktop app and publishes it on the same
release, at `https://github.com/madsbuch/better-github/releases/download/latest/<file>`:

| Computer | File |
| --- | --- |
| Mac with Apple silicon (M1 and later) | `better-github-macos-arm64.dmg` |
| Mac with an Intel processor | `better-github-macos-x64.dmg` |
| Windows | `better-github-windows-x64-setup.exe` |
| Linux | `better-github-linux-x86_64.AppImage` or `better-github-linux-amd64.deb` |

On a Mac, open the disk image and drag *Better GitHub* to Applications. The
builds aren't signed with a paid certificate, so the first launch needs a
confirmation: on a Mac in System Settings > Privacy & Security > *Open Anyway*,
on Windows under *More info* > *Run anyway*. To have CI sign and notarize the
Mac builds instead, add the `APPLE_*` secrets described in the `release` skill.

On a desktop the app is used with a mouse and a keyboard:

- The window opens wide, and reopens where and as large as you left it. The
  main sections are in a sidebar, lists and prose stay a readable width, and
  code, diffs and logs use the rest.
- Diffs show the old and the new file side by side from 1100 px wide. A button
  in the top bar (and Settings) switches back to one column.
- Rows, buttons and menus respond to the pointer, and icon buttons show their
  name. A refresh button stands in for pulling down.
- Dialogs and menus take keyboard focus, keep Tab inside, close on Esc, and
  menus move with the arrow keys.

| Shortcut | Does |
| --- | --- |
| `/` or `⌘K` | Search |
| `⌘[` or `⌥←`, `⌘]` or `⌥→` (and the mouse's back and forward buttons) | Back, forward |
| `⌘R` | Refresh the screen's data |
| `⌘1`, `⌘2`, `⌘3` | Repositories, organizations, your profile |
| `⌘,` or `⌘4` | Settings |
| `Esc` | Close the dialog or menu on top |

Elsewhere `Ctrl` takes the place of `⌘` and `Alt` of `⌥`. *Settings › Keyboard
shortcuts* lists them too.

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
  lib/spec.ts         .spec: the item schema, the outline built from the folder, filtering
  lib/desktop.ts      keyboard shortcuts and mouse behavior for desktop windows
  lib/specDiff.ts     what changed between two specs, by item and requirement
  lib/specRework.ts   editing a spec as a draft on the device, and the handover for an agent
  lib/specLines.ts    where a requirement is in its file, to put review comments on its lines
  lib/specPrompt.ts   the prompt for a coding agent to write or improve a spec
  screens/            one file per screen; pull/ and actions/ hold their screens' parts
  dev/mock.ts         fixtures for VITE_MOCK=1
e2e/                  Playwright tests against the fixtures
src-tauri/            Rust side
  src/auth.rs         OAuth device flow
  src/github.rs       authenticated REST/GraphQL proxy, locked to api.github.com; job logs, download links
  src/store.rs        session/config persistence
  gen/android/        generated Android project (edge-to-edge insets, browser tabs, downloads, signing config)
schema/               spec.schema.json, generated from lib/spec.ts (`npm run spec:schema`)
spec-llms.txt         the spec format for coding agents, generated from lib/specPrompt.ts
.spec/                this repository's own spec
app-icon/             icon sources; regenerate with `npx tauri icon app-icon/app-icon.json`
.claude/skills/       procedures: release, android-signing, verify-changes
```
