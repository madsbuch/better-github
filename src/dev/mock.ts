// Development-only fake GitHub backend: `VITE_MOCK=1 npm run dev`.
// Lets the UI be exercised (and screenshotted) without network access or a
// token. Never included in production builds.

import { z } from "zod";
import { ApiError, type Backend, type GraphQLEnvelope, type RestRequest, type RestResponse, type SessionInfo } from "../lib/backend";

/** The fixture at `index`; fixtures are fixed, so a missing one is a bug in this file. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`mock fixture ${index.toString()} is missing`);
  return item;
}

/** A regular expression match's group, or "" when it didn't take part. */
const group = (match: RegExpExecArray, index = 1): string => match[index] ?? "";

/** A GraphQL variable that should be a string. */
const str = (value: unknown): string => (typeof value === "string" ? value : "");

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const avatar = (id: number) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="hsl(${(id * 67) % 360} 55% 55%)"/><text x="20" y="26" font-size="16" text-anchor="middle" fill="white" font-family="sans-serif">${String.fromCharCode(65 + (id % 26))}</text></svg>`,
)}`;

const viewer = { login: "octocat", avatarUrl: avatar(1) };
const alice = { login: "alice", avatarUrl: avatar(2) };
const bob = { login: "bob-builds", avatarUrl: avatar(3) };
const bot = { login: "dependabot", avatarUrl: avatar(4) };

const label = (name: string, color: string) => ({ name, color });

function pullItem(n: number, repo: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    __typename: "PullRequest",
    id: `PR_${repo}_${n}`,
    number: n,
    title,
    url: `https://github.com/${repo}/pull/${n}`,
    state: "OPEN",
    isDraft: false,
    createdAt: ago(60 * 30),
    updatedAt: ago(n * 7),
    additions: 120 + n,
    deletions: 30 + n,
    totalCommentsCount: n % 5,
    reviewDecision: "REVIEW_REQUIRED",
    author: alice,
    repository: { nameWithOwner: repo },
    labels: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
    ...extra,
  };
}

const PULLS = [
  pullItem(482, "acme/rocket", "Add retry with exponential backoff to the upload client", {
    labels: { nodes: [label("enhancement", "a2eeef"), label("networking", "5319e7")] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] },
  }),
  pullItem(1290, "acme/web", "Fix dark mode contrast on settings page", {
    author: bob,
    reviewDecision: "APPROVED",
    labels: { nodes: [label("bug", "d73a4a")] },
  }),
  pullItem(77, "octocat/dotfiles", "Bump vite from 7.1.0 to 8.3.4", {
    author: bot,
    reviewDecision: null,
    labels: { nodes: [label("dependencies", "0366d6")] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
  }),
  pullItem(16, "acme/rocket", "WIP: new telemetry pipeline", { isDraft: true, author: viewer, reviewDecision: null }),
];

const ISSUES = [
  {
    __typename: "Issue",
    id: "I_1",
    number: 501,
    title: "Crash when uploading files larger than 2 GB",
    url: "https://github.com/acme/rocket/issues/501",
    issueState: "OPEN",
    stateReason: null,
    createdAt: ago(60 * 50),
    updatedAt: ago(90),
    author: bob,
    repository: { nameWithOwner: "acme/rocket" },
    comments: { totalCount: 4 },
    labels: { nodes: [label("bug", "d73a4a"), label("good first issue", "7057ff")] },
  },
];

const REPO_ROWS: [owner: string, name: string, description: string, lang: string, color: string, stars: number, isPrivate: boolean][] = [
  ["acme", "rocket", "Blazing fast uploads for everyone", "Rust", "#dea584", 2410, false],
  ["acme", "web", "The acme.dev website", "TypeScript", "#3178c6", 312, false],
  ["octocat", "dotfiles", "My config files", "Shell", "#89e051", 12, true],
  ["octocat", "better-github", "A fast, review-focused GitHub client for Android", "TypeScript", "#3178c6", 87, false],
];
const REPOS = REPO_ROWS.map(([owner, name, description, lang, color, stars, isPrivate], i) => ({
  __typename: "Repository",
  id: `R_${i}`,
  name,
  nameWithOwner: `${owner}/${name}`,
  description,
  isPrivate,
  isFork: false,
  isArchived: false,
  stargazerCount: stars,
  pushedAt: ago(i * 300 + 20),
  owner: { login: owner, avatarUrl: avatar(owner === "acme" ? 9 : 1) },
  primaryLanguage: { name: lang, color },
}));

const PATCH_CLIENT = `@@ -12,18 +12,31 @@ use std::time::Duration;
 use crate::error::UploadError;

 const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
+const MAX_RETRIES: u32 = 5;
+const BASE_DELAY_MS: u64 = 250;

 pub struct Client {
     http: reqwest::Client,
-    timeout: Duration,
+    timeout: Duration,
+    retries: u32,
 }

 impl Client {
     pub fn new() -> Self {
-        Self { http: reqwest::Client::new(), timeout: DEFAULT_TIMEOUT }
+        Self { http: reqwest::Client::new(), timeout: DEFAULT_TIMEOUT, retries: MAX_RETRIES }
     }

-    pub async fn upload(&self, body: Vec<u8>) -> Result<(), UploadError> {
-        self.http.post(URL).body(body).send().await?;
-        Ok(())
+    /// Uploads \`body\`, retrying transient failures with exponential backoff.
+    pub async fn upload(&self, body: Vec<u8>) -> Result<(), UploadError> {
+        let mut attempt = 0;
+        loop {
+            match self.http.post(URL).body(body.clone()).send().await {
+                Ok(response) if response.status().is_success() => return Ok(()),
+                Ok(response) if attempt >= self.retries => return Err(UploadError::Status(response.status())),
+                Err(err) if attempt >= self.retries => return Err(err.into()),
+                _ => {}
+            }
+            attempt += 1;
+            tokio::time::sleep(Duration::from_millis(BASE_DELAY_MS << attempt)).await;
+        }
     }
 }`;

const PATCH_README = `@@ -1,5 +1,9 @@
 # Rocket

 Blazing fast uploads.
+
+## Retries
+
+Uploads are retried up to five times with exponential backoff.
 `;

const FILES = [
  { filename: "src/client.rs", status: "modified", additions: 17, deletions: 4, changes: 21, patch: PATCH_CLIENT },
  { filename: "README.md", status: "modified", additions: 4, deletions: 0, changes: 4, patch: PATCH_README },
  { filename: "assets/logo.png", status: "added", additions: 0, deletions: 0, changes: 0 },
];

// acme/rocket's .review-rules on main: one file of each verdict in pull request 482.
const ROCKET_REVIEW_RULES = `# How carefully changes to Rocket need reviewing.

high src/client.rs
  - Retries only repeat requests that are safe to repeat: an upload
    resumes where it stopped, it never starts over.
  - Backoff has a ceiling, so a dead server can't stall the app forever.

medium src/**
  - Errors reach the caller with the server's message, as \`UploadError::Server\`.

low *.md
  - Is it still true?

unmatched medium
  - No rule covers this file. Consider adding one.
`;

// acme/rocket's spec on main: the files of its .spec folder (null for
// pictures). On staging one item has a typo in a key, and so can't be read.
const ROCKET_SPEC: Record<string, unknown> = {
  "index.json": {
    title: "Rocket",
    summary: "Uploads that don't give up.",
    description:
      "Rocket sends files to a server and keeps going when the network doesn't.\n\nThis spec says what it promises:\n- to the programs that call `upload`\n- to the people running `rocket` in a terminal",
  },
  "uploads/index.json": {
    title: "Uploads",
    summary: "Sending a file, whatever the network does.",
    order: 1,
  },
  "uploads/retries.json": {
    title: "Retries",
    summary: "A failed upload is tried again, with growing pauses.",
    order: 1,
    description:
      "Networks drop. An upload that fails for a reason that may pass is tried again instead of failing the caller.\n\nRetrying is safe because:\n- uploads resume, they never start over\n- the server ignores bytes it already has\n\nA retry is never visible to the caller, except as time.\n\nWhat counts as a reason that may pass is decided by the server's answer, not by the client's guess.\n\nRetries stop when the caller cancels.\n\nAn upload that still fails after the last retry fails the caller with the last error.",
    stories: [
      { id: "US-1", as: "a commuter sending a file from a train", want: "the upload to survive the tunnel", soThat: "I don't have to start it again", requirements: ["#R1", "#R2"] },
      { id: "US-2", as: "a developer calling `upload`", want: "to stop an upload that is waiting to retry", requirements: ["#R4"] },
    ],
    requirements: [
      { id: "R1", text: "An upload that fails with a network error or a 5xx response is retried, up to five times." },
      { id: "R2", text: "A retry resumes where the upload stopped. It never sends bytes the server already has.", related: ["#R1"] },
      { id: "R3", text: "The pause before a retry doubles each time, starting at `retry.first-pause` and never exceeding 30 s.", level: "should" },
      { id: "R4", text: "The caller can cancel while a retry is waiting.", level: "may" },
    ],
    values: [
      { id: "retry.max", type: "number", value: 5, unit: "times", description: "How often a failed upload is tried again." },
      { id: "retry.first-pause", type: "duration", value: "250ms" },
      { id: "color.retrying", type: "color", value: "#9a6700", dark: "#d29922", description: "The progress bar while a retry waits." },
      { id: "retry.label", type: "text", value: "Trying again…" },
    ],
    figures: [{ src: "assets/backoff.png", alt: "Pauses of 250 ms, 500 ms, 1 s and 2 s between five attempts", caption: "Pauses double between attempts." }],
    related: ["uploads/errors#E1", "cli"],
  },
  "uploads/errors.json": {
    title: "Errors",
    summary: "What the caller is told when an upload fails for good.",
    order: 2,
    requirements: [
      { id: "E1", text: "When the last retry fails, the caller gets the server's message as `UploadError::Server`." },
      {
        id: "E2",
        text: "No error message contains the upload token.",
        version: 3,
        history: [
          { version: 1, text: "Error messages are written to the log.", level: "should", reason: "Logs were being shared in bug reports, tokens and all.", date: "2026-02-03" },
          { version: 2, text: "Error messages in the log leave out the upload token.", reason: "The token also reached callers through `UploadError`.", date: "2026-06-21" },
        ],
      },
      {
        id: "E3",
        text: "A failed upload writes the server's reply to a log file.",
        deprecation: { reason: "The reply could hold the upload token. `E1` hands the message to the caller instead.", replacedBy: ["#E1"], date: "2026-09-14" },
      },
    ],
  },
  "cli.json": {
    title: "Command line",
    summary: "The `rocket` command.",
    order: 2,
    requirements: [{ id: "C1", text: "`rocket upload <file>` exits with 1 when the upload fails." }],
  },
  "assets/backoff.png": null,
};

// The spec on eng-629-retries (and at pull request 484's head): retries are
// reworded, re-leveled, added and removed, Resuming is new, Command line is
// gone, and the picture changed.
const ROCKET_SPEC_NEXT: Record<string, unknown> = {
  "index.json": ROCKET_SPEC["index.json"],
  "uploads/index.json": ROCKET_SPEC["uploads/index.json"],
  "uploads/retries.json": {
    title: "Retries",
    summary: "A failed upload is tried again, with growing pauses.",
    order: 1,
    description:
      "Networks drop. An upload that fails for a reason that may pass is tried again instead of failing the caller.\n\nRetrying is safe because:\n- uploads resume, they never start over\n- the server ignores bytes it already has\n- a retry waits as long as the server asks\n\nA retry is never visible to the caller, except as time.\n\nWhat counts as a reason that may pass is decided by the server's answer, not by the client's guess.\n\nRetries stop when the caller cancels.\n\nAn upload that still fails after the third retry fails the caller with the first error it met.",
    stories: [
      { id: "US-1", as: "a commuter sending a file from a train", want: "the upload to survive the tunnel", soThat: "my phone can stay in my pocket", requirements: ["#R1", "#R2"] },
      {
        id: "US-2",
        as: "a developer calling `upload`",
        want: "to stop an upload that is waiting to retry",
        deprecation: { reason: "Nobody asked for it once retries took seconds instead of minutes." },
      },
      { id: "US-3", as: "someone running the server", want: "clients to back off when I ask them to", soThat: "a restart isn't met by a stampede", requirements: ["#R5"] },
    ],
    requirements: [
      {
        id: "R1",
        text: "An upload that fails with a network error, a 429 or a 5xx response is retried, up to three times.",
        version: 2,
        history: [
          {
            version: 1,
            text: "An upload that fails with a network error or a 5xx response is retried, up to five times.",
            reason: "Five retries kept phones awake for minutes. A `429` is the server asking for a pause, which is what a retry is.",
          },
        ],
      },
      { id: "R2", text: "A retry resumes where the upload stopped. It never sends bytes the server already has.", related: ["#R1"] },
      { id: "R3", text: "The pause before a retry doubles each time, starting at `retry.first-pause` and never exceeding 30 s." },
      { id: "R5", text: "A `Retry-After` header sets the pause before the next retry." },
    ],
    values: [
      {
        id: "retry.max",
        type: "number",
        value: 3,
        unit: "times",
        description: "How often a failed upload is tried again.",
        history: [{ value: 5, reason: "Five retries kept phones awake for minutes." }],
      },
      { id: "retry.first-pause", type: "duration", value: "250ms" },
      { id: "color.retrying", type: "color", value: "#bf8700", dark: "#d29922", description: "The progress bar while a retry waits." },
      { id: "retry.states", type: "list", value: ["waiting", "retrying", "gave up"] },
    ],
    figures: [{ src: "assets/backoff.png", alt: "Pauses of 250 ms and 500 ms between three attempts", caption: "Pauses double between attempts." }],
    related: ["uploads/errors#E1", "uploads/resume"],
  },
  "uploads/resume.json": {
    title: "Resuming",
    summary: "Picking an upload up where it stopped.",
    order: 3,
    requirements: [{ id: "U1", text: "Before a retry, the client asks the server how many bytes it has." }],
  },
  "uploads/errors.json": ROCKET_SPEC["uploads/errors.json"],
  "assets/backoff.png": null,
};

const BACKOFF_PICTURE_NEXT = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 160" font-family="sans-serif" font-size="14"><rect width="640" height="160" fill="#f6f8fa"/><path d="M30 90H610" stroke="#8c959f" stroke-width="2"/><g fill="#1a7f37"><circle cx="40" cy="90" r="8"/><circle cx="220" cy="90" r="8"/><circle cx="570" cy="90" r="8"/></g><g fill="#57606a" text-anchor="middle"><text x="130" y="70">250 ms</text><text x="395" y="70">500 ms</text></g></svg>',
)}`;

const BACKOFF_PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 160" font-family="sans-serif" font-size="14"><rect width="640" height="160" fill="#f6f8fa"/><path d="M30 90H610" stroke="#8c959f" stroke-width="2"/><g fill="#0969da"><circle cx="40" cy="90" r="8"/><circle cx="90" cy="90" r="8"/><circle cx="170" cy="90" r="8"/><circle cx="310" cy="90" r="8"/><circle cx="570" cy="90" r="8"/></g><g fill="#57606a" text-anchor="middle"><text x="65" y="70">250 ms</text><text x="130" y="120">500 ms</text><text x="240" y="70">1 s</text><text x="440" y="120">2 s</text></g></svg>',
)}`;

/** The head commit of the fixture pull requests. */
const PR_HEAD = "9f3c2a1b7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a";

/** A file's text as it is in the repository. */
const specText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** A stand-in for a git object id: the same for the same contents. */
function oidOf(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  return `${hash.toString(16).padStart(8, "0")}${text.length.toString(16).padStart(8, "0")}`.padEnd(40, "0");
}

// A large spec, to see that size doesn't matter: acme/atlas has 40 areas of
// 75 items each. On its `next` branch three items differ and one is new.
const ATLAS_AREAS = 40;
const ATLAS_ITEMS = 75;
function atlasSpec(next: boolean): Record<string, unknown> {
  const files: Record<string, unknown> = { "index.json": { title: "Atlas", summary: "Maps for everything." } };
  for (let a = 1; a <= ATLAS_AREAS; a++) {
    const area = `area-${a.toString().padStart(2, "0")}`;
    files[`${area}/index.json`] = { title: `Area ${a}`, summary: `Everything about area ${a}.`, order: a };
    for (let i = 1; i <= ATLAS_ITEMS; i++) {
      const edited = next && a === 7 && i <= 3;
      files[`${area}/item-${i.toString().padStart(3, "0")}.json`] = {
        title: `Feature ${a}.${i}`,
        summary: i === 42 ? "The one with the needle in it." : `What feature ${a}.${i} does.`,
        order: i,
        requirements: [
          // Ids are unique in the whole spec: each carries its area and item.
          { id: `F${a}-${i}-A`, text: edited ? `Feature ${a}.${i} answers within 100 ms.` : `Feature ${a}.${i} answers within 200 ms.` },
          { id: `F${a}-${i}-B`, text: `Feature ${a}.${i} keeps working offline.`, level: "should" },
        ],
      };
    }
  }
  if (next) files["area-07/item-new.json"] = { title: "Feature 7.new",  requirements: [{ id: "F7-new-A", text: "It exists." }] };
  return files;
}

/** A catalogue of shared specs (acme/shared-specs): parts that several apps copy into their spec. */
const SHARED_SPECS: Record<string, unknown> = {
  "index.json": { title: "Acme shared specs", summary: "Parts that several Acme apps share." },
  "sync/index.json": {
    title: "Sync",
    summary: "Peer-to-peer sync between the devices of one collection.",
    requirements: [{ id: "SYN-1", text: "Two devices on the same local network sync with each other, without a server." }],
    values: [{ id: "sync.pairing-lifetime", type: "duration", value: "10min" }],
  },
  "sync/pairing.json": { title: "Pairing", order: 1, requirements: [{ id: "SYN-9", text: "A new device joins by scanning a pairing code, which works for `sync.pairing-lifetime`." }] },
  "telemetry/index.json": { title: "Telemetry", summary: "What an app may report about itself.", requirements: [{ id: "TEL-1", text: "No report holds anything the user wrote." }] },
};
/** The tip of every fixture repository's default branch, as the commits API answers for HEAD. */
const TIP = "ba5eba11".padEnd(40, "0");

function rocketWithSync(): Record<string, unknown> {
  const shared = Object.fromEntries(Object.entries(SHARED_SPECS).filter(([path]) => path.startsWith("sync/")));
  const tree = treeOf({ files: shared, pictures: "1" }).find((entry) => entry.path === "sync")?.sha ?? "";
  const root = z.record(z.string(), z.unknown()).parse(ROCKET_SPEC["index.json"]);
  const entry = {
    at: "sync",
    from: "acme/shared-specs",
    commit: TIP,
    tree,
    values: [{ id: "sync.pairing-lifetime", value: "5min", reason: "Pairing happens at a desk." }],
    waived: [{ ref: "#SYN-9", reason: "Rocket pairs with a token instead." }],
  };
  return { ...ROCKET_SPEC, ...shared, "index.json": { ...root, imports: [entry] } };
}

/** Every version of every fixture spec: what `<ref>:.spec` resolves to, by repository. */
const SPEC_VERSIONS: Record<string, { files: Record<string, unknown>; pictures: string } | undefined> = {
  "acme/rocket@main": { files: ROCKET_SPEC, pictures: "1" },
  // The commit pull request 484 branched from.
  "acme/rocket@ba5eba11": { files: ROCKET_SPEC, pictures: "1" },
  // Command line has a typo in a key, and Limits reuses a requirement id of Retries.
  "acme/rocket@staging": {
    files: {
      ...ROCKET_SPEC,
      "cli.json": { title: "Command line", sumary: "The `rocket` command." },
      "uploads/limits.json": { title: "Limits", order: 3, requirements: [{ id: "R1", text: "A file can be up to 5 GB." }] },
    },
    pictures: "1",
  },
  "acme/rocket@eng-629-retries": { files: ROCKET_SPEC_NEXT, pictures: "2" },
  [`acme/rocket@${PR_HEAD}`]: { files: ROCKET_SPEC_NEXT, pictures: "2" },
  "acme/atlas@main": { files: atlasSpec(false), pictures: "1" },
  "acme/atlas@next": { files: atlasSpec(true), pictures: "1" },
  "acme/shared-specs@main": { files: SHARED_SPECS, pictures: "1" },
  // Rocket with the shared sync part pulled in: a value set otherwise, and a requirement it waives.
  "acme/rocket@with-sync": { files: rocketWithSync(), pictures: "1" },
  [`acme/shared-specs@${TIP}`]: { files: SHARED_SPECS, pictures: "1" },
};

/** Contents by object id, filled as trees are listed (like a repository's object store). */
const SPEC_OBJECTS = new Map<string, string>();

/** A version's files as a recursive tree listing, folders included: a folder's id is made from what is in it. */
function specListing(version: { files: Record<string, unknown>; pictures: string }) {
  const listing = treeOf(version);
  for (const entry of listing) if (entry.text !== null) SPEC_OBJECTS.set(entry.sha, entry.text);
  return listing.map(({ text: _text, ...entry }) => entry);
}

/** The listing, with each file's text; nothing is stored. */
function treeOf(version: { files: Record<string, unknown>; pictures: string }) {
  const blobs = Object.entries(version.files).map(([path, value]) => {
    const text = value === null ? null : specText(value);
    const sha = text === null ? oidOf(`${path}@${version.pictures}`) : oidOf(text);
    return { path, mode: "100644", type: "blob", sha, size: text?.length ?? 1000, url: "", text };
  });
  const folders = new Map<string, string[]>();
  for (const blob of blobs) {
    const parts = blob.path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join("/");
      folders.set(folder, [...(folders.get(folder) ?? []), `${blob.path} ${blob.sha}`]);
    }
  }
  return [...blobs, ...[...folders].map(([path, lines]) => ({ path, mode: "040000", type: "tree", sha: oidOf(lines.sort().join("\n")), size: 0, url: "", text: null }))];
}

/** `git diff` of two texts as one hunk with the whole file for context: enough for a fixture. */
function wholeFilePatch(before: string, after: string): { patch: string; additions: number; deletions: number } {
  const [a, b] = [before === "" ? [] : before.trimEnd().split("\n"), after === "" ? [] : after.trimEnd().split("\n")];
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i];
      if (row) row[j] = a[i] === b[j] ? (lcs[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const lines: string[] = [];
  let [i, j, additions, deletions] = [0, 0, 0, 0];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(` ${a[i] ?? ""}`);
      i++;
      j++;
    } else if (j < b.length && (i === a.length || (lcs[i]?.[j + 1] ?? 0) > (lcs[i + 1]?.[j] ?? 0))) {
      lines.push(`+${b[j++] ?? ""}`);
      additions++;
    } else {
      lines.push(`-${a[i++] ?? ""}`);
      deletions++;
    }
  }
  return { patch: `@@ -${a.length === 0 ? 0 : 1},${a.length} +${b.length === 0 ? 0 : 1},${b.length} @@\n${lines.join("\n")}`, additions, deletions };
}

/** The spec files a pull request changes, going from one version of the spec to another. */
function specFileChanges(from: Record<string, unknown>, to: Record<string, unknown>) {
  const changes = [];
  for (const path of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const [before, after] = [from[path], to[path]];
    const status = !(path in from) ? "added" : !(path in to) ? "removed" : "modified";
    if (before === null || after === null) {
      // The fixture's one picture is redrawn.
      if (status === "modified") changes.push({ filename: `.spec/${path}`, status, additions: 0, deletions: 0, changes: 0 });
      continue;
    }
    const [old, current] = [before === undefined ? "" : specText(before), after === undefined ? "" : specText(after)];
    if (old === current) continue;
    const diff = wholeFilePatch(old, current);
    changes.push({ filename: `.spec/${path}`, status, ...diff, changes: diff.additions + diff.deletions });
  }
  return changes;
}

// Pull request 483 also edits the rules.
const RULES_CHANGE = {
  filename: ".review-rules",
  status: "modified",
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: "@@ -10,4 +10,4 @@ medium src/**\n   - Errors reach the caller with the server's message.\n \n-low *.md\n+low *.md src/**\n   - Is it still true?",
};

const PR_DETAIL = {
  id: "PR_acme/rocket_482",
  number: 482,
  title: "Add retry with exponential backoff to the upload client",
  url: "https://github.com/acme/rocket/pull/482",
  state: "OPEN",
  isDraft: false,
  merged: false,
  closed: false,
  locked: false,
  body: "Uploads fail on flaky networks. This adds retries.\n\n- [x] Backoff\n- [ ] Jitter",
  bodyHTML:
    '<p>Uploads fail on flaky networks. This adds retries with exponential backoff to <code>Client::upload</code>.</p><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled> Exponential backoff</li><li class="task-list-item"><input type="checkbox" disabled> Jitter (follow-up)</li></ul><p>Fixes <a class="issue-link" href="https://github.com/acme/rocket/issues/501">#501</a></p>',
  createdAt: ago(60 * 30),
  updatedAt: ago(20),
  mergedAt: null,
  mergedBy: null,
  author: alice,
  authorAssociation: "MEMBER",
  baseRefName: "main",
  headRefName: "alice/upload-retries",
  headRefOid: PR_HEAD,
  isCrossRepository: false,
  headRepository: { nameWithOwner: "acme/rocket" },
  additions: 21,
  deletions: 4,
  changedFiles: 3,
  commits: { totalCount: 3 },
  mergeable: "MERGEABLE",
  mergeStateStatus: "BLOCKED",
  reviewDecision: "REVIEW_REQUIRED",
  isInMergeQueue: false,
  autoMergeRequest: null,
  viewerDidAuthor: false,
  viewerCanUpdate: true,
  viewerCanClose: true,
  viewerCanReopen: false,
  viewerCanDeleteHeadRef: true,
  viewerCanEnableAutoMerge: true,
  viewerCanDisableAutoMerge: false,
  viewerCanMergeAsAdmin: true,
  viewerCanUpdateBranch: true,
  viewerLatestReview: null,
  statusCheckRollup: { state: "PENDING" },
  labels: { nodes: [label("enhancement", "a2eeef"), label("networking", "5319e7")] },
  assignees: { nodes: [alice] },
  milestone: { title: "v2.0" },
  reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", ...viewer } }, { requestedReviewer: { __typename: "Team", name: "core", slug: "core" } }] },
  latestOpinionatedReviews: { nodes: [{ state: "CHANGES_REQUESTED", author: bob }] },
  squashTitle: "Add retry with exponential backoff to the upload client (#482)",
  squashBody: "* Add retries\n* Use exponential backoff\n* Document retries",
  mergeTitle: "Merge pull request #482 from acme/alice/upload-retries",
  mergeBody: "Add retry with exponential backoff to the upload client",
};

const THREADS = [
  {
    id: "T_1",
    path: "src/client.rs",
    line: 40,
    originalLine: 40,
    startLine: null,
    diffSide: "RIGHT",
    isResolved: false,
    isOutdated: false,
    subjectType: "LINE",
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    resolvedBy: null,
    comments: {
      totalCount: 2,
      nodes: [
        {
          id: "C_1",
          databaseId: 1,
          author: bob,
          authorAssociation: "MEMBER",
          body: "Shifting by `attempt` overflows quickly — cap the delay?",
          bodyHTML: "<p>Shifting by <code>attempt</code> overflows quickly — cap the delay?</p>",
          createdAt: ago(200),
          diffHunk: PATCH_CLIENT.split("\n").slice(0, 30).join("\n"),
          url: "https://github.com/acme/rocket/pull/482#discussion_r1",
          outdated: false,
          pullRequestReview: { id: "REV_1" },
        },
        {
          id: "C_2",
          databaseId: 2,
          author: alice,
          authorAssociation: "MEMBER",
          body: "Good catch, will clamp it to 8 seconds.",
          bodyHTML: "<p>Good catch, will clamp it to 8 seconds.</p>",
          createdAt: ago(150),
          diffHunk: "",
          url: "https://github.com/acme/rocket/pull/482#discussion_r2",
          outdated: false,
          pullRequestReview: { id: "REV_2" },
        },
      ],
    },
  },
];

const TIMELINE = [
  {
    __typename: "PullRequestCommit",
    id: "PRC_1",
    commit: {
      oid: "1a2b3c4d5e6f",
      abbreviatedOid: "1a2b3c4",
      messageHeadline: "Add retries to upload client",
      committedDate: ago(60 * 29),
      author: { name: "Alice", avatarUrl: alice.avatarUrl, user: { login: "alice" } },
      statusCheckRollup: { state: "SUCCESS" },
    },
  },
  { __typename: "ReviewRequestedEvent", id: "E_1", actor: alice, createdAt: ago(60 * 28), requestedReviewer: { __typename: "User", login: "bob-builds" } },
  { __typename: "LabeledEvent", id: "E_2", actor: alice, createdAt: ago(60 * 28), label: label("enhancement", "a2eeef") },
  {
    __typename: "PullRequestReview",
    id: "REV_1",
    author: bob,
    authorAssociation: "MEMBER",
    state: "CHANGES_REQUESTED",
    body: "Looks good overall, one concern about the delay.",
    bodyHTML: "<p>Looks good overall, one concern about the delay.</p>",
    submittedAt: ago(200),
    createdAt: ago(200),
    url: "https://github.com/acme/rocket/pull/482#pullrequestreview-1",
    comments: { totalCount: 1, nodes: [{ id: "C_1", replyTo: null }] },
  },
  {
    __typename: "PullRequestReview",
    id: "REV_2",
    author: alice,
    authorAssociation: "MEMBER",
    state: "COMMENTED",
    body: "",
    bodyHTML: "",
    submittedAt: ago(150),
    createdAt: ago(150),
    url: "https://github.com/acme/rocket/pull/482#pullrequestreview-2",
    comments: { totalCount: 1, nodes: [{ id: "C_2", replyTo: { id: "C_1" } }] },
  },
  {
    __typename: "IssueComment",
    id: "IC_1",
    author: viewer,
    authorAssociation: "OWNER",
    body: "Could we also log each retry?",
    bodyHTML: "<p>Could we also log each retry? Something like:</p><pre><code>warn!(attempt, \"upload failed, retrying\");</code></pre>",
    createdAt: ago(100),
    url: "https://github.com/acme/rocket/pull/482#issuecomment-1",
  },
  {
    __typename: "PullRequestCommit",
    id: "PRC_2",
    commit: {
      oid: "2b3c4d5e6f7a",
      abbreviatedOid: "2b3c4d5",
      messageHeadline: "Document retries in README",
      committedDate: ago(60),
      author: { name: "Alice", avatarUrl: alice.avatarUrl, user: { login: "alice" } },
      statusCheckRollup: { state: "PENDING" },
    },
  },
];

const CHECK_ROWS: [typename: string, name: string, status: string, conclusion: string | null, workflow: string][] = [
  ["CheckRun", "build (ubuntu-latest)", "COMPLETED", "SUCCESS", "CI"],
  ["CheckRun", "build (windows-latest)", "IN_PROGRESS", null, "CI"],
  ["CheckRun", "clippy", "COMPLETED", "FAILURE", "Lint"],
  ["CheckRun", "docs", "COMPLETED", "SKIPPED", "CI"],
];
const CHECKS = CHECK_ROWS.map(([, name, status, conclusion, workflow], i) => ({
  __typename: "CheckRun",
  id: `CR_${i}`,
  name,
  status,
  conclusion,
  title: conclusion === "FAILURE" ? "3 errors" : null,
  detailsUrl: `https://github.com/acme/rocket/actions/runs/${9000 + i}/job/${9100 + i}`,
  startedAt: ago(30),
  completedAt: status === "COMPLETED" ? ago(26) : null,
  isRequired: i === 0,
  checkSuite: { app: { name: "GitHub Actions" }, workflowRun: { databaseId: 100 + i, runNumber: 7, workflow: { name: workflow } } },
}));

const NOTIFICATION_ROWS: [reason: string, type: string, title: string, repo: string, sub: string | null, unread: boolean][] = [
  ["review_requested", "PullRequest", "Add retry with exponential backoff to the upload client", "acme/rocket", "pulls/482", true],
  ["mention", "Issue", "Crash when uploading files larger than 2 GB", "acme/rocket", "issues/501", true],
  ["comment", "PullRequest", "Fix dark mode contrast on settings page", "acme/web", "pulls/1290", false],
  ["ci_activity", "CheckSuite", "CI workflow run failed for main branch", "acme/web", null, true],
  ["subscribed", "Release", "v2.0.0", "acme/rocket", "releases/1", false],
];
const NOTIFICATIONS = NOTIFICATION_ROWS.map(([reason, type, title, repo, sub, unread], i) => {
  const [owner = "", name = ""] = repo.split("/");
  return {
    id: (1000 + i).toString(),
    unread,
    reason,
    updated_at: ago(i * 45 + 5),
    subject: { title, type, url: sub !== null ? `https://api.github.com/repos/${repo}/${sub}` : null, latest_comment_url: null },
    repository: { full_name: repo, name, owner: { login: owner, avatar_url: avatar(owner === "acme" ? 9 : 1) } },
  };
});

// ------------------------------------------------------------------ actions

const iso = (minutes: number) => new Date(now - minutes * 60_000).toISOString().replace(/\.\d+Z$/, "Z");

const WORKFLOWS = [
  { id: 11, name: "CI", path: ".github/workflows/ci.yml", state: "active", html_url: "" },
  { id: 12, name: "Release", path: ".github/workflows/release.yml", state: "active", html_url: "" },
];

function workflowRun(id: number, title: string, status: string, conclusion: string | null, minutes: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: "CI",
    display_title: title,
    run_number: id - 8990,
    run_attempt: 1,
    event: "push",
    status,
    conclusion,
    workflow_id: 11,
    path: ".github/workflows/ci.yml",
    head_branch: "main",
    head_sha: "1a2b3c4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d",
    html_url: `https://github.com/acme/rocket/actions/runs/${id}`,
    created_at: iso(minutes),
    updated_at: iso(status === "completed" ? minutes - 4 : 0),
    run_started_at: iso(minutes),
    actor: { login: "alice", avatar_url: alice.avatarUrl },
    head_commit: { message: title },
    pull_requests: [],
    ...extra,
  };
}

const RUNS = [
  workflowRun(9001, "Add retry with exponential backoff", "in_progress", null, 3, { event: "pull_request", head_branch: "alice/upload-retries", pull_requests: [{ number: 482 }] }),
  workflowRun(9002, "Fix clippy warnings", "completed", "failure", 50),
  workflowRun(9000, "Bump tokio", "completed", "success", 240),
  workflowRun(9003, "Release v2.0.0", "completed", "cancelled", 600, { name: "Release", workflow_id: 12, event: "release" }),
];

function step(number: number, name: string, status: string, conclusion: string | null, start: number | null, end: number | null) {
  return { number, name, status, conclusion, started_at: start === null ? null : iso(start), completed_at: end === null ? null : iso(end) };
}

const JOBS = [
  {
    id: 9102,
    run_id: 9002,
    name: "clippy",
    status: "completed",
    conclusion: "failure",
    created_at: iso(50),
    started_at: iso(50),
    completed_at: iso(46),
    html_url: "https://github.com/acme/rocket/actions/runs/9002/job/9102",
    head_sha: "1a2b3c4d",
    head_branch: "main",
    workflow_name: "CI",
    runner_name: "GitHub Actions 7",
    labels: ["ubuntu-latest"],
    steps: [
      step(1, "Set up job", "completed", "success", 50, 50),
      step(2, "Run actions/checkout@v5", "completed", "success", 49, 49),
      step(3, "Run cargo clippy -- -D warnings", "completed", "failure", 48, 47),
      step(4, "Post Run actions/checkout@v5", "completed", "success", 46, 46),
      step(5, "Complete job", "completed", "success", 46, 46),
    ],
  },
  {
    id: 9101,
    run_id: 9001,
    name: "build (windows-latest)",
    status: "in_progress",
    conclusion: null,
    created_at: iso(3),
    started_at: iso(3),
    completed_at: null,
    html_url: "https://github.com/acme/rocket/actions/runs/9001/job/9101",
    head_sha: "1a2b3c4d",
    head_branch: "alice/upload-retries",
    workflow_name: "CI",
    runner_name: "GitHub Actions 3",
    labels: ["windows-latest"],
    steps: [
      step(1, "Set up job", "completed", "success", 3, 3),
      step(2, "Run cargo build", "in_progress", null, 2, null),
      step(3, "Run cargo test", "queued", null, null, null),
    ],
  },
];

const logStamp = (minutes: number, ms = 0) => new Date(now - minutes * 60_000 + ms).toISOString().replace("Z", "0000Z");

const JOB_LOG = [
  `${logStamp(50)} Current runner version: '2.330.0'`,
  `${logStamp(50, 10)} ##[group]Operating System`,
  `${logStamp(50, 20)} Ubuntu 24.04`,
  `${logStamp(50, 30)} ##[endgroup]`,
  `${logStamp(49, 100)} ##[group]Run actions/checkout@v5`,
  `${logStamp(49, 110)} with:`,
  `${logStamp(49, 120)} ##[endgroup]`,
  `${logStamp(49, 200)} [command]/usr/bin/git version`,
  `${logStamp(48, 100)} ##[group]Run cargo clippy -- -D warnings`,
  `${logStamp(48, 110)} \u001b[36;1mcargo clippy -- -D warnings\u001b[0m`,
  `${logStamp(48, 120)} ##[endgroup]`,
  `${logStamp(48, 300)} \u001b[1m\u001b[32m    Checking\u001b[0m rocket-upload v0.4.0`,
  `${logStamp(47, 100)} \u001b[1m\u001b[31merror\u001b[0m\u001b[1m: unused variable: \`delay\`\u001b[0m`,
  `${logStamp(47, 110)}  --> src/client.rs:5:9`,
  `${logStamp(47, 200)} ##[error]Process completed with exit code 101.`,
  `${logStamp(46, 100)} Post job cleanup.`,
  `${logStamp(46, 200)} [command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader`,
  `${logStamp(46, 900)} Cleaning up orphan processes`,
].join("\n");

const ANNOTATIONS = [
  { path: "src/client.rs", start_line: 5, end_line: 5, annotation_level: "failure", title: "clippy", message: "unused variable: `delay`" },
];

function actionsBody(path: string): unknown {
  if (path.endsWith("/actions/workflows")) return { total_count: WORKFLOWS.length, workflows: WORKFLOWS };
  const byWorkflow = /\/actions\/workflows\/(\d+)\/runs$/.exec(path);
  if (byWorkflow) {
    const runs = RUNS.filter((r) => r.workflow_id === Number(group(byWorkflow)));
    return { total_count: runs.length, workflow_runs: runs };
  }
  if (path.endsWith("/actions/runs")) return { total_count: RUNS.length, workflow_runs: RUNS };
  const jobs = /\/actions\/runs\/(\d+)\/jobs$/.exec(path);
  if (jobs) {
    const runId = Number(group(jobs));
    const list = JOBS.filter((j) => j.run_id === runId);
    if (list.length > 0) return { total_count: list.length, jobs: list };
    // Runs without their own jobs get one that ended like the run did.
    const conclusion = RUNS.find((r) => r.id === runId)?.conclusion ?? at(JOBS, 0).conclusion;
    return { total_count: 1, jobs: [{ ...at(JOBS, 0), id: runId + 100, run_id: runId, conclusion }] };
  }
  const run = /\/actions\/runs\/(\d+)$/.exec(path);
  if (run) return RUNS.find((r) => r.id === Number(group(run))) ?? workflowRun(Number(group(run)), "Fix clippy warnings", "completed", "failure", 50);
  const job = /\/actions\/jobs\/(\d+)$/.exec(path);
  if (job) return JOBS.find((j) => j.id === Number(group(job))) ?? { ...at(JOBS, 0), id: Number(group(job)) };
  if (/\/check-runs\/\d+\/annotations$/.test(path)) return ANNOTATIONS;
  return null;
}

// --------------------------------------------------------- new pull requests

const branchTip = (name: string, login: string, minutes: number, openPulls = 0) => ({
  name,
  associatedPullRequests: { totalCount: openPulls },
  target: { oid: `${name.replace(/\W/g, "")}0123456789`, committedDate: iso(minutes), messageHeadline: `Work on ${name}`, author: { user: { login } } },
});

const ROCKET_BRANCHES = {
  nameWithOwner: "acme/rocket",
  defaultBranchRef: { name: "main" },
  parent: null,
  refs: {
    nodes: [
      branchTip("octocat/faster-uploads", "octocat", 25),
      branchTip("alice/upload-retries", "alice", 90, 1),
      branchTip("main", "alice", 240),
      branchTip("release/2.0", "bob-builds", 3000),
    ],
  },
};

// The branch picker's list, newest first: more than one page, with an old
// "staging" branch at the very end and many names that merely contain it.
const ALL_BRANCHES = (() => {
  const named: [string, number][] = [
    ["octocat/faster-uploads", 25],
    ["alice/upload-retries", 90],
    ["main", 240],
    ["dave/authenticom-staging-follow-up", 300],
    ["dave/bump-staging-version", 600],
    ["dave/eng-629-vehicle-inventory-staging", 900],
    ["dave/fix-staging-deployment", 1200],
    ["dave/fix-staging-form-fields", 1500],
    ["release/2.0", 3000],
    ["staging", 60 * 24 * 60],
  ];
  const people = ["alice", "bob", "carol", "dave", "erin"];
  const topics = ["retry", "cache", "upload", "auth", "docs", "metrics", "ui", "deps", "ci", "logging", "search", "perf"];
  const more = Array.from({ length: 230 }, (_, i): [string, number] => [`${at(people, i % 5)}/${at(topics, i % 12)}-${(100 + i).toString()}`, 3100 + i * 97]);
  return [...named, ...more].sort((a, b) => a[1] - b[1]).map(([name, minutes]) => ({ name, target: { committedDate: iso(minutes) } }));
})();

function branchesData(op: string, variables: Record<string, unknown>): unknown {
  switch (op) {
    case "RepoBranches": {
      const start = Number(str(variables.after));
      const nodes = ALL_BRANCHES.slice(start, start + 100);
      const end = start + nodes.length;
      return {
        repository: {
          defaultBranchRef: { name: "main" },
          refs: { totalCount: ALL_BRANCHES.length, pageInfo: { hasNextPage: end < ALL_BRANCHES.length, endCursor: end.toString() }, nodes },
        },
      };
    }
    case "SearchBranches": {
      const query = str(variables.query).toLowerCase();
      return { repository: { refs: { nodes: ALL_BRANCHES.filter((b) => b.name.includes(query)).slice(0, 50) } } };
    }
    default:
      return null;
  }
}

const PEOPLE = [
  { login: "alice", name: "Alice Liddell", avatarUrl: alice.avatarUrl },
  { login: "bob-builds", name: "Bob", avatarUrl: bob.avatarUrl },
  { login: "octocat", name: "The Octocat", avatarUrl: viewer.avatarUrl },
];

function newPullData(op: string, variables: Record<string, unknown>): unknown {
  switch (op) {
    case "RecentBranches":
      return { viewer: { repositories: { nodes: [ROCKET_BRANCHES] } } };
    case "RepoRecentBranches":
      return { repository: ROCKET_BRANCHES };
    case "NewPull":
      return {
        repository: {
          id: "R_0",
          nameWithOwner: "acme/rocket",
          defaultBranchRef: { name: "main" },
          parent: null,
          pullRequestTemplates: [{ filename: ".github/pull_request_template.md", body: "## What changed\n\n## How to test\n" }],
          forks: { nodes: [] },
        },
      };
    case "AssignableUsers": {
      const q = str(variables.query).toLowerCase();
      return { repository: { assignableUsers: { nodes: PEOPLE.filter((p) => p.login.includes(q) || p.name.toLowerCase().includes(q)) } } };
    }
    default:
      return null;
  }
}

/** compare/<base>...<head>: nothing new against itself, else two commits. */
function comparison(spec: string) {
  const [base, head] = decodeURIComponent(spec).split("...");
  if (head === undefined || head === "" || head.replace(/^[\w-]+:/, "") === base) {
    return { status: "identical", ahead_by: 0, behind_by: 0, total_commits: 0, commits: [], files: [], merge_base_commit: { sha: base } };
  }
  const commits = [0, 1].map((i) => ({
    sha: `c0ffee${i}`.padEnd(40, "0"),
    commit: {
      message: at(["Stream uploads in chunks", "Reuse connections between chunks"], i),
      author: { name: "The Octocat", date: iso(40 - i * 10) },
      committer: { name: "The Octocat", date: iso(40 - i * 10) },
    },
    author: { login: "octocat", avatar_url: viewer.avatarUrl },
  }));
  return { status: "ahead", ahead_by: 2, behind_by: 1, total_commits: 2, commits, files: FILES, merge_base_commit: { sha: "ba5eba11" } };
}

const EXISTING_PULL = { number: 482, title: PR_DETAIL.title, created_at: ago(60 * 30), user: { login: "alice" } };

/** What was sent to open pull requests, for tests to read back (window.__specPull). */
const specPullRequests: { path: string; body: unknown }[] = [];
if (typeof window !== "undefined") Object.assign(window, { __specPull: specPullRequests });

function newPullRest(path: string, method: string, request: RestRequest): unknown {
  // Copying a file from another repository, as it is: the copy's id is made from its contents.
  if (method === "POST" && path.endsWith("/git/blobs")) {
    specPullRequests.push({ path, body: request.body });
    const body = z.object({ content: z.string() }).safeParse(request.body);
    return { sha: oidOf(body.success ? atob(body.data.content) : "") };
  }
  // Opening a pull request from a reworked spec: a tree, a commit, a branch.
  if (method === "POST" && /\/git\/(trees|commits|refs)$/.test(path)) {
    specPullRequests.push({ path, body: request.body });
    return { sha: path.endsWith("/trees") ? "7ree".padEnd(40, "0") : "c0ffee5".padEnd(40, "0") };
  }
  if (method === "POST" && /^\/repos\/[^/]+\/[^/]+\/pulls$/.test(path)) {
    specPullRequests.push({ path, body: request.body });
    return { number: 483, html_url: "https://github.com/acme/rocket/pull/483" };
  }
  if (method === "POST" && path === "/markdown") {
    const body = z.object({ text: z.string().optional() }).safeParse(request.body);
    const text = body.success ? (body.data.text ?? "") : "";
    const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
    return `<p>${text.replace(/[&<>]/g, (c) => escapes[c] ?? c)}</p>`;
  }
  if (method !== "GET") return undefined;
  const blob = /\/git\/blobs\/([0-9a-f]+)$/.exec(path);
  if (blob) {
    const text = SPEC_OBJECTS.get(group(blob));
    return text === undefined ? NOT_FOUND : { sha: group(blob), content: btoa(text), encoding: "base64" };
  }
  // The tip of a branch, to start a new one from.
  if (/^\/repos\/[^/]+\/[^/]+\/commits\/[^/]+$/.test(path) && !/\/commits\/[0-9a-f]{7,40}$/.test(path)) return { sha: "ba5eba11".padEnd(40, "0"), commit: { tree: { sha: "7ree0".padEnd(40, "0") } } };
  const compare = /\/compare\/(.+)$/.exec(path);
  if (compare) return comparison(group(compare));
  const tree = /\/git\/trees\/(.+)$/.exec(path);
  if (tree) {
    const version = SPEC_VERSIONS[decodeURIComponent(group(tree)).replace(/^tree:/, "")];
    return version ? { sha: group(tree), url: "", tree: specListing(version), truncated: false } : NOT_FOUND;
  }
  if (/^\/repos\/[^/]+\/[^/]+\/pulls$/.test(path)) {
    const head = request.query?.head;
    return typeof head === "string" && head.includes("upload-retries") ? [EXISTING_PULL] : [];
  }
  return undefined;
}

// ---------------------------------------------------------------- releases

function release(id: number, tag: string, name: string, minutes: number, extra: Record<string, unknown> = {}) {
  const asset = (assetId: number, file: string, size: number, contentType: string, downloads: number) => ({
    id: assetId,
    name: file,
    label: null,
    state: "uploaded",
    content_type: contentType,
    size,
    download_count: downloads,
    created_at: ago(minutes),
    updated_at: ago(minutes),
    browser_download_url: `https://github.com/acme/rocket/releases/download/${tag}/${file}`,
  });
  return {
    id,
    tag_name: tag,
    name,
    draft: false,
    prerelease: false,
    created_at: ago(minutes),
    published_at: ago(minutes),
    html_url: `https://github.com/acme/rocket/releases/tag/${tag}`,
    target_commitish: "main",
    author: { login: "alice", avatar_url: alice.avatarUrl },
    body_html: `<h2>What's new in ${tag}</h2><ul><li>Resumable uploads</li><li>Retries with exponential backoff</li></ul>`,
    assets: [
      asset(id * 10 + 1, `rocket-${tag}.apk`, 12_788_988, "application/vnd.android.package-archive", 341),
      asset(id * 10 + 2, `rocket-${tag}-linux-x86_64.tar.gz`, 4_200_000, "application/gzip", 87),
      asset(id * 10 + 3, "checksums.txt", 192, "text/plain", 12),
    ],
    ...extra,
  };
}

const RELEASES = [
  release(1, "v2.0.0", "Rocket 2.0", 60 * 48),
  release(2, "v2.0.0-rc.1", "2.0 release candidate", 60 * 24 * 9, { prerelease: true }),
  release(3, "v1.4.2", "", 60 * 24 * 40, { assets: [], body_html: "" }),
];

/** A REST body that makes the request fail with 404, as GitHub does. */
const NOT_FOUND = Symbol("not found");

function releasesBody(path: string): unknown {
  if (path.endsWith("/releases")) return RELEASES;
  if (path.endsWith("/releases/latest")) return at(RELEASES, 0);
  const byTag = /\/releases\/tags\/(.+)$/.exec(path);
  if (byTag) return RELEASES.find((r) => r.tag_name === decodeURIComponent(group(byTag))) ?? NOT_FOUND;
  const byId = /\/releases\/(\d+)$/.exec(path);
  if (byId) return RELEASES.find((r) => r.id === Number(group(byId))) ?? NOT_FOUND;
  return undefined;
}

function graphqlData(query: string, variables: Record<string, unknown>): unknown {
  const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
  const newPull = newPullData(op, variables) ?? branchesData(op, variables);
  if (newPull !== null) return newPull;
  switch (op) {
    case "SearchCounts":
      return { c0: { issueCount: 3 }, c1: { issueCount: 1 }, c2: { issueCount: 2 }, c3: { issueCount: 0 }, c4: { issueCount: 5 } };
    case "SearchIssues": {
      const q = str(variables.query);
      const nodes = q.includes("is:issue") ? ISSUES : q.includes("author:@me") ? [at(PULLS, 3)] : q.includes("mentions") ? [] : [...PULLS.slice(0, 3), ...ISSUES];
      return { search: { issueCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes } };
    }
    case "SearchRepos":
      return { search: { repositoryCount: REPOS.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: REPOS } };
    case "SearchUsers":
      return { search: { userCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ __typename: "User", id: "U1", login: "alice", name: "Alice Doe", avatarUrl: alice.avatarUrl, bio: "Rustacean" }] } };
    case "ViewerRepos":
      return { viewer: { repositories: { totalCount: REPOS.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: REPOS } } };
    case "ViewerStarred":
      return { viewer: { starredRepositories: { totalCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: REPOS.slice(0, 2) } } };
    case "ViewerOrgs":
      return {
        viewer: {
          organizations: {
            totalCount: 3,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              { login: "acme", name: "Acme Inc.", avatarUrl: avatar(9), description: "Blazing fast uploads for everyone.", repositories: { totalCount: 42 } },
              { login: "octo-labs", name: null, avatarUrl: avatar(4), description: null, repositories: { totalCount: 1 } },
              { login: "rustaceans", name: "Rustaceans", avatarUrl: avatar(6), description: "People who write Rust.", repositories: { totalCount: 1280 } },
            ],
          },
        },
      };
    case "Viewer":
      return {
        viewer: {
          ...viewer,
          name: "The Octocat",
          bio: "Reviewing pull requests on the go.",
          company: "@acme",
          location: "San Francisco",
          url: "https://github.com/octocat",
          followers: { totalCount: 4120 },
          following: { totalCount: 9 },
          repositories: { totalCount: 8 },
          starredRepositories: { totalCount: 42 },
          organizations: { nodes: [{ login: "acme", name: "Acme Inc.", avatarUrl: avatar(9) }] },
        },
        rateLimit: { limit: 5000, remaining: 4870, resetAt: ago(-40) },
      };
    case "RateLimit":
      return { rateLimit: { limit: 5000, remaining: 4870, resetAt: ago(-40) } };
    case "Owner":
      return {
        repositoryOwner: {
          __typename: "Organization",
          login: str(variables.login),
          avatarUrl: avatar(9),
          url: `https://github.com/${str(variables.login)}`,
          name: "Acme Inc.",
          description: "We build rockets.",
          location: "Earth",
          repositories: { totalCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: REPOS.slice(0, 2) },
        },
      };
    case "Repo":
      return {
        repository: {
          ...at(REPOS, 0),
          url: "https://github.com/acme/rocket",
          homepageUrl: "https://rocket.acme.dev",
          forkCount: 120,
          viewerHasStarred: true,
          viewerPermission: "ADMIN",
          hasIssuesEnabled: true,
          defaultBranchRef: { name: "main" },
          licenseInfo: { spdxId: "MIT", name: "MIT License" },
          parent: null,
          latestRelease: { name: "Rocket 2.0", tagName: "v2.0.0", publishedAt: ago(60 * 48), isPrerelease: false },
          releases: { totalCount: RELEASES.length },
          watchers: { totalCount: 41 },
          pullRequests: { totalCount: 12 },
          issues: { totalCount: 34 },
          repositoryTopics: { nodes: [{ topic: { name: "rust" } }, { topic: { name: "uploads" } }] },
        },
      };
    case "Pull":
      return {
        repository: {
          id: "R_0",
          nameWithOwner: "acme/rocket",
          viewerPermission: "ADMIN",
          mergeCommitAllowed: true,
          squashMergeAllowed: true,
          rebaseMergeAllowed: false,
          autoMergeAllowed: true,
          deleteBranchOnMerge: false,
          viewerDefaultMergeMethod: "SQUASH",
          pullRequest: PR_DETAIL,
        },
      };
    case "PullTimeline":
      return { repository: { pullRequest: { timelineItems: { totalCount: TIMELINE.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: TIMELINE } } } };
    case "PullThreads":
      return { repository: { pullRequest: { reviewThreads: { totalCount: THREADS.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: THREADS } } } };
    case "ReviewRules": {
      // acme/rocket has rules on main. In octocat/drafting only the pull
      // request's own commit has them; other repositories have none.
      const rocket = variables.owner === "acme" && variables.name === "rocket" && variables.expression === "main:.review-rules";
      const drafting = variables.owner === "octocat" && variables.name === "drafting" && variables.expression === `${PR_DETAIL.headRefOid}:.review-rules`;
      return { repository: { object: rocket || drafting ? { text: ROCKET_REVIEW_RULES, isTruncated: false } : null } };
    }
    case "SpecRoot": {
      const ref = str(variables.expression).replace(/:\.spec$/, "");
      // So tests can see which version of a spec was asked for.
      console.info(`[mock] spec-root ${ref}`);
      const version = `${str(variables.owner)}/${str(variables.name)}@${ref}`;
      return { repository: { object: SPEC_VERSIONS[version] ? { oid: `tree:${version}` } : null } };
    }
    case "SpecBlobs": {
      const wanted = Object.entries(variables).filter(([name]) => /^o\d+$/.test(name));
      // So tests can see how much of a spec was read.
      console.info(`[mock] spec-blobs ${new Set(wanted.map(([, oid]) => oid)).size.toString()}`);
      return {
        repository: Object.fromEntries(
          wanted.map(([name, oid]) => {
            const text = SPEC_OBJECTS.get(str(oid));
            return [`b${name.slice(1)}`, text === undefined ? null : { oid, text, isTruncated: false }];
          }),
        ),
      };
    }
    case "PullFiles":
      return {
        repository: {
          pullRequest: {
            files: {
              totalCount: FILES.length,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: FILES.map((f, i) => ({ path: f.filename, additions: f.additions, deletions: f.deletions, changeType: "MODIFIED", viewerViewedState: i === 2 ? "VIEWED" : "UNVIEWED" })),
            },
          },
        },
      };
    case "PullCommits":
      return {
        repository: {
          pullRequest: {
            commits: {
              totalCount: 2,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: TIMELINE.flatMap((t) =>
                t.__typename === "PullRequestCommit" && "commit" in t ? [{ id: t.id, commit: { ...t.commit, additions: 10, deletions: 2 } }] : [],
              ),
            },
          },
        },
      };
    case "PullChecks":
      return {
        repository: {
          pullRequest: {
            headRefOid: PR_DETAIL.headRefOid,
            commits: { nodes: [{ commit: { oid: PR_DETAIL.headRefOid, statusCheckRollup: { state: "FAILURE", contexts: { totalCount: CHECKS.length, nodes: CHECKS } } } }] },
          },
        },
      };
    case "IssueDetail":
      return {
        repository: {
          id: "R_0",
          nameWithOwner: "acme/rocket",
          viewerPermission: "ADMIN",
          issueOrPullRequest: {
            ...at(ISSUES, 0),
            state: "OPEN",
            locked: false,
            body: "Steps to reproduce…",
            bodyHTML: "<p>Uploading a 3 GB file panics:</p><pre><code>thread 'main' panicked at 'capacity overflow'</code></pre>",
            authorAssociation: "CONTRIBUTOR",
            viewerCanUpdate: true,
            viewerCanClose: true,
            viewerCanReopen: true,
            assignees: { nodes: [alice] },
            milestone: null,
            timelineItems: {
              totalCount: 2,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                { __typename: "LabeledEvent", id: "IE1", actor: viewer, createdAt: ago(60 * 40), label: label("bug", "d73a4a") },
                {
                  __typename: "CrossReferencedEvent",
                  id: "IE2",
                  actor: alice,
                  createdAt: ago(60 * 30),
                  source: { __typename: "PullRequest", number: 482, title: PR_DETAIL.title, url: PR_DETAIL.url, prState: "OPEN", repository: { nameWithOwner: "acme/rocket" } },
                },
              ],
            },
          },
        },
      };
    // Mutations whose result the app parses; the others only need an answer.
    case "AddComment":
      return { addComment: { commentEdge: { node: { id: "IC_new" } } } };
    case "ReplyToThread":
      return { addPullRequestReviewThreadReply: { comment: { id: "PRRC_new" } } };
    case "ResolveThread":
      return { resolveReviewThread: { thread: { id: str(variables.threadId), isResolved: true } } };
    case "UnresolveThread":
      return { unresolveReviewThread: { thread: { id: str(variables.threadId), isResolved: false } } };
    case "UpdatePullBranch":
      return { updatePullRequestBranch: { pullRequest: { id: str(variables.pullRequestId), headRefOid: PR_DETAIL.headRefOid } } };
    default:
      // Mutations: echo something truthy.
      return { ok: true };
  }
}

// Guest mode's REST endpoints (src/queries/guest.ts): public data only.
const PROFILES: Record<string, { login: string; [field: string]: unknown }> = {
  acme: { login: "acme", type: "Organization", name: "Acme Inc.", bio: "We build rockets.", location: "Earth", avatar_url: avatar(9), followers: 1200, public_repos: 2 },
  octocat: { login: "octocat", type: "User", name: "The Octocat", bio: "GitHub's mascot", company: "@github", avatar_url: avatar(1), followers: 9000, following: 9, public_repos: 1 },
};

function restRepo(repo: (typeof REPOS)[number]) {
  return {
    node_id: repo.id,
    name: repo.name,
    full_name: repo.nameWithOwner,
    description: repo.description,
    html_url: `https://github.com/${repo.nameWithOwner}`,
    homepage: repo.name === "rocket" ? "https://rocket.acme.dev" : null,
    private: repo.isPrivate,
    fork: false,
    archived: false,
    stargazers_count: repo.stargazerCount,
    forks_count: 12,
    subscribers_count: 40,
    open_issues_count: 3,
    has_issues: true,
    pushed_at: repo.pushedAt,
    default_branch: "main",
    size: 1024,
    language: repo.primaryLanguage.name,
    topics: repo.name === "rocket" ? ["uploads", "rust"] : [],
    license: { spdx_id: "MIT", name: "MIT License" },
    owner: { login: repo.owner.login, avatar_url: repo.owner.avatarUrl },
  };
}

function guestRest(path: string): unknown {
  if (path === "/rate_limit") return { resources: { core: { limit: 60, remaining: 52, reset: Math.floor(now / 1000) + 1800 } } };
  const user = /^\/users\/([^/]+)$/.exec(path);
  if (user) {
    const profile = PROFILES[group(user).toLowerCase()];
    return profile ? { ...profile, html_url: `https://github.com/${profile.login}` } : NOT_FOUND;
  }
  const userRepos = /^\/users\/([^/]+)\/repos$/.exec(path);
  if (userRepos) {
    const login = group(userRepos).toLowerCase();
    if (!PROFILES[login]) return NOT_FOUND;
    return REPOS.filter((r) => !r.isPrivate && r.owner.login === login).map(restRepo);
  }
  const repo = /^\/repos\/([^/]+)\/([^/]+)$/.exec(path);
  if (repo) {
    const found = REPOS.find((r) => r.nameWithOwner.toLowerCase() === `${group(repo)}/${group(repo, 2)}`.toLowerCase() && !r.isPrivate);
    return found ? restRepo(found) : NOT_FOUND;
  }
  if (/^\/repos\/[^/]+\/[^/]+\/branches$/.test(path)) return [{ name: "main" }, { name: "staging" }, { name: "eng-629-retries" }];
  return undefined;
}

function restBody(request: RestRequest): unknown {
  const path = request.path.replace(/^https:\/\/api\.github\.com/, "").split("?")[0] ?? "";
  const method = request.method ?? "GET";
  const newPull = newPullRest(path, method, request);
  if (newPull !== undefined) return newPull;
  if (method !== "GET") return {};
  const guest = guestRest(path);
  if (guest !== undefined) return guest;
  if (path === "/notifications") {
    const all = request.query?.all === true;
    return all ? NOTIFICATIONS : NOTIFICATIONS.filter((n) => n.unread);
  }
  const actions = actionsBody(path);
  if (actions !== null) return actions;
  const releases = releasesBody(path);
  if (releases !== undefined) return releases;
  if (path.endsWith("/pulls/483/files")) return [...FILES, RULES_CHANGE];
  // Pull request 484 also changes the spec, from what's on main to ROCKET_SPEC_NEXT.
  if (path.endsWith("/pulls/484/files")) return [...FILES, ...specFileChanges(ROCKET_SPEC, ROCKET_SPEC_NEXT)];
  if (/\/pulls\/\d+\/files$/.test(path)) return FILES;
  if (path.endsWith("/readme")) {
    return '<div id="readme" class="md"><article class="markdown-body"><h1>Rocket</h1><p>Blazing fast uploads for everyone.</p><h2>Install</h2><pre><code>cargo add rocket-upload</code></pre><p>See <a href="docs/usage.md">the usage guide</a>.</p></article></div>';
  }
  const commit = /\/commits\/([0-9a-f]+)$/.exec(path);
  if (commit) {
    return {
      sha: group(commit).padEnd(40, "0"),
      commit: { message: "Add retries to upload client\n\nUses exponential backoff.", author: { name: "Alice", date: ago(600) }, committer: { name: "Alice", date: ago(600) } },
      author: { login: "alice", avatar_url: alice.avatarUrl },
      parents: [{ sha: "0f0f0f0f0f0f" }],
      stats: { additions: 17, deletions: 4, total: 21 },
      files: FILES.slice(0, 1),
    };
  }
  if (path.endsWith("/commits")) {
    return [0, 1, 2].map((i) => ({
      sha: `${i}abcdef1234567`,
      commit: { message: at(["Add retries", "Fix typo in README", "Initial commit"], i), author: { name: "Alice", date: ago(i * 600 + 30) }, committer: { date: ago(i * 600 + 30) } },
      author: { login: "alice", avatar_url: alice.avatarUrl },
    }));
  }
  const contents = /\/contents\/?(.*)$/.exec(path);
  if (contents) {
    const p = decodeURIComponent(group(contents));
    if (p === "" || p === "src") {
      const dir = p !== "" ? `${p}/` : "";
      return [
        { type: "dir", name: "src", path: `${dir}src` },
        { type: "file", name: "Cargo.toml", path: `${dir}Cargo.toml` },
        { type: "file", name: "README.md", path: `${dir}README.md` },
        { type: "file", name: "client.rs", path: `${dir}client.rs` },
      ].map((e) => ({ ...e, sha: "x", size: 100, url: "", html_url: "", git_url: "", download_url: null, _links: {} }));
    }
    const specRepo = /^\/repos\/([^/]+\/[^/]+)\//.exec(path);
    const refName = request.query?.ref;
    const version = specRepo && typeof refName === "string" ? SPEC_VERSIONS[`${group(specRepo)}@${refName}`] : undefined;
    const specPath = p.startsWith(".spec/") ? p.slice(".spec/".length) : null;
    if (version && specPath !== null && specPath in version.files) {
      const value = version.files[specPath];
      const text = value === null ? "" : specText(value);
      const picture = value === null ? (version.pictures === "1" ? BACKOFF_PICTURE : BACKOFF_PICTURE_NEXT) : null;
      return { type: "file", name: p.split("/").pop(), path: p, size: text.length, encoding: "base64", content: btoa(text), download_url: picture, html_url: "" };
    }
    if (request.accept?.includes("html") === true) return "<h1>Rocket</h1><p>Rendered markdown preview.</p>";
    const source = p.endsWith(".md")
      ? "# Rocket\n\nBlazing fast uploads.\n"
      : 'use std::time::Duration;\n\n/// Uploads with retries.\npub async fn upload(body: Vec<u8>) -> Result<(), Error> {\n    let delay = Duration::from_millis(250);\n    println!("uploading {} bytes", body.len());\n    Ok(())\n}\n';
    return { type: "file", name: p.split("/").pop(), path: p, size: source.length, encoding: "base64", content: btoa(source), download_url: null, html_url: "" };
  }
  return {};
}

const session: SessionInfo = { login: viewer.login, name: "The Octocat", avatarUrl: viewer.avatarUrl, method: "device", scopes: "repo, read:org, notifications, read:user" };

const delay = <T,>(value: T, ms = 120) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

export function createMockBackend(): Backend {
  let signedIn = !new URLSearchParams(window.location.search).has("signedOut");
  return {
    native: true,
    sessionGet: () => delay(signedIn ? session : null),
    authConfig: () => delay({ clientId: "Ov23liMockClientId", clientIdSource: "build" as const, scopes: "repo read:org notifications read:user" }),
    authSetClientId: (clientId) => delay({ clientId, clientIdSource: clientId !== null && clientId !== "" ? ("user" as const) : null, scopes: "" }),
    authDeviceStart: () => delay({ deviceCode: "dc", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 }),
    authDevicePoll: () => delay({ status: "pending" as const }),
    authWithToken: () => {
      signedIn = true;
      return delay(session);
    },
    authLogout: () => {
      signedIn = false;
      return delay(undefined);
    },
    rest: async (request) => {
      const body = restBody(request);
      if (body === NOT_FOUND) throw await delay(new ApiError("Not Found", "api", 404));
      return delay<RestResponse>({ status: 200, body, link: null });
    },
    graphql: (query, variables) => delay<GraphQLEnvelope>({ data: graphqlData(query, variables ?? {}) }),
    jobLogs: () => delay({ text: JOB_LOG, truncated: false }),
    downloadUrl: (target) =>
      delay(target.kind === "asset" ? `https://objects.githubusercontent.com/mock/${target.assetId}` : `https://codeload.github.com/mock/${target.ref}.${target.format}`),
    openUrl: async (url) => console.info("[mock] open", url),
    copyText: async (text) => console.info("[mock] copy", text),
  };
}
