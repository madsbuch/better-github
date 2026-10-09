// Development-only fake GitHub backend: `VITE_MOCK=1 npm run dev`.
// Lets the UI be exercised (and screenshotted) without network access or a
// token. Never included in production builds.

import { ApiError, type Backend, type GraphQLEnvelope, type RestRequest, type RestResponse, type SessionInfo } from "../lib/backend";

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

const REPOS = [
  ["acme", "rocket", "Blazing fast uploads for everyone", "Rust", "#dea584", 2410, false],
  ["acme", "web", "The acme.dev website", "TypeScript", "#3178c6", 312, false],
  ["octocat", "dotfiles", "My config files", "Shell", "#89e051", 12, true],
  ["octocat", "gh-commander", "A fast, review-focused GitHub client for Android", "TypeScript", "#3178c6", 87, false],
].map(([owner, name, description, lang, color, stars, isPrivate], i) => ({
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
  headRefOid: "9f3c2a1b7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a",
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

const CHECKS = [
  ["CheckRun", "build (ubuntu-latest)", "COMPLETED", "SUCCESS", "CI"],
  ["CheckRun", "build (windows-latest)", "IN_PROGRESS", null, "CI"],
  ["CheckRun", "clippy", "COMPLETED", "FAILURE", "Lint"],
  ["CheckRun", "docs", "COMPLETED", "SKIPPED", "CI"],
].map(([, name, status, conclusion, workflow], i) => ({
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

const NOTIFICATIONS = [
  ["review_requested", "PullRequest", "Add retry with exponential backoff to the upload client", "acme/rocket", "pulls/482", true],
  ["mention", "Issue", "Crash when uploading files larger than 2 GB", "acme/rocket", "issues/501", true],
  ["comment", "PullRequest", "Fix dark mode contrast on settings page", "acme/web", "pulls/1290", false],
  ["ci_activity", "CheckSuite", "CI workflow run failed for main branch", "acme/web", null, true],
  ["subscribed", "Release", "v2.0.0", "acme/rocket", "releases/1", false],
].map(([reason, type, title, repo, sub, unread], i) => {
  const [owner, name] = (repo as string).split("/");
  return {
    id: String(1000 + i),
    unread,
    reason,
    updated_at: ago(i * 45 + 5),
    subject: { title, type, url: sub ? `https://api.github.com/repos/${repo}/${sub}` : null, latest_comment_url: null },
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
  if (/\/actions\/workflows$/.test(path)) return { total_count: WORKFLOWS.length, workflows: WORKFLOWS };
  const byWorkflow = /\/actions\/workflows\/(\d+)\/runs$/.exec(path);
  if (byWorkflow) {
    const runs = RUNS.filter((r) => r.workflow_id === Number(byWorkflow[1]));
    return { total_count: runs.length, workflow_runs: runs };
  }
  if (/\/actions\/runs$/.test(path)) return { total_count: RUNS.length, workflow_runs: RUNS };
  const jobs = /\/actions\/runs\/(\d+)\/jobs$/.exec(path);
  if (jobs) {
    const list = JOBS.filter((j) => j.run_id === Number(jobs[1]));
    return { total_count: list.length, jobs: list.length ? list : [{ ...JOBS[0], id: Number(jobs[1]) + 100, run_id: Number(jobs[1]) }] };
  }
  const run = /\/actions\/runs\/(\d+)$/.exec(path);
  if (run) return RUNS.find((r) => r.id === Number(run[1])) ?? workflowRun(Number(run[1]), "Fix clippy warnings", "completed", "failure", 50);
  const job = /\/actions\/jobs\/(\d+)$/.exec(path);
  if (job) return JOBS.find((j) => j.id === Number(job[1])) ?? { ...JOBS[0], id: Number(job[1]) };
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
  const more = Array.from({ length: 230 }, (_, i): [string, number] => [`${people[i % 5]}/${topics[i % 12]}-${100 + i}`, 3100 + i * 97]);
  return [...named, ...more].sort((a, b) => a[1] - b[1]).map(([name, minutes]) => ({ name, target: { committedDate: iso(minutes) } }));
})();

function branchesData(op: string, variables: Record<string, unknown>): unknown {
  switch (op) {
    case "RepoBranches": {
      const start = Number(variables.after ?? 0);
      const nodes = ALL_BRANCHES.slice(start, start + 100);
      const end = start + nodes.length;
      return {
        repository: {
          defaultBranchRef: { name: "main" },
          refs: { totalCount: ALL_BRANCHES.length, pageInfo: { hasNextPage: end < ALL_BRANCHES.length, endCursor: String(end) }, nodes },
        },
      };
    }
    case "SearchBranches": {
      const query = String(variables.query).toLowerCase();
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
      const q = String(variables.query ?? "").toLowerCase();
      return { repository: { assignableUsers: { nodes: PEOPLE.filter((p) => p.login.includes(q) || p.name.toLowerCase().includes(q)) } } };
    }
    default:
      return null;
  }
}

/** compare/<base>...<head>: nothing new against itself, else two commits. */
function comparison(spec: string) {
  const [base, head] = decodeURIComponent(spec).split("...");
  if (!head || head.replace(/^[\w-]+:/, "") === base) {
    return { status: "identical", ahead_by: 0, behind_by: 0, total_commits: 0, commits: [], files: [] };
  }
  const commits = [0, 1].map((i) => ({
    sha: `c0ffee${i}`.padEnd(40, "0"),
    commit: {
      message: ["Stream uploads in chunks", "Reuse connections between chunks"][i],
      author: { name: "The Octocat", date: iso(40 - i * 10) },
      committer: { name: "The Octocat", date: iso(40 - i * 10) },
    },
    author: { login: "octocat", avatar_url: viewer.avatarUrl },
  }));
  return { status: "ahead", ahead_by: 2, behind_by: 1, total_commits: 2, commits, files: FILES };
}

const EXISTING_PULL = { number: 482, title: PR_DETAIL.title, created_at: ago(60 * 30), user: { login: "alice" } };

function newPullRest(path: string, method: string, request: RestRequest): unknown {
  if (method === "POST" && /^\/repos\/[^/]+\/[^/]+\/pulls$/.test(path)) {
    return { number: 483, html_url: "https://github.com/acme/rocket/pull/483" };
  }
  if (method === "POST" && path === "/markdown") {
    const text = String((request.body as { text?: string })?.text ?? "");
    return `<p>${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</p>`;
  }
  if (method !== "GET") return undefined;
  const compare = /\/compare\/(.+)$/.exec(path);
  if (compare) return comparison(compare[1]);
  if (/^\/repos\/[^/]+\/[^/]+\/pulls$/.test(path)) {
    return String(request.query?.head ?? "").includes("upload-retries") ? [EXISTING_PULL] : [];
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
  if (/\/releases$/.test(path)) return RELEASES;
  if (/\/releases\/latest$/.test(path)) return RELEASES[0];
  const byTag = /\/releases\/tags\/(.+)$/.exec(path);
  if (byTag) return RELEASES.find((r) => r.tag_name === decodeURIComponent(byTag[1])) ?? NOT_FOUND;
  const byId = /\/releases\/(\d+)$/.exec(path);
  if (byId) return RELEASES.find((r) => r.id === Number(byId[1])) ?? NOT_FOUND;
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
      const q = String(variables.query);
      const nodes = q.includes("is:issue") ? ISSUES : q.includes("author:@me") ? [PULLS[3]] : q.includes("mentions") ? [] : [...PULLS.slice(0, 3), ...ISSUES];
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
          login: variables.login,
          avatarUrl: avatar(9),
          url: `https://github.com/${variables.login}`,
          name: "Acme Inc.",
          description: "We build rockets.",
          location: "Earth",
          repositories: { totalCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: REPOS.slice(0, 2) },
        },
      };
    case "Repo":
      return {
        repository: {
          ...REPOS[0],
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
              nodes: TIMELINE.filter((t) => t.__typename === "PullRequestCommit").map((t) => ({
                id: t.id,
                commit: { ...(t as { commit: object }).commit, additions: 10, deletions: 2 },
              })),
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
            ...ISSUES[0],
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
    default:
      // Mutations: echo something truthy.
      return { ok: true };
  }
}

function restBody(request: RestRequest): unknown {
  const path = request.path.replace(/^https:\/\/api\.github\.com/, "").split("?")[0];
  const method = request.method ?? "GET";
  const newPull = newPullRest(path, method, request);
  if (newPull !== undefined) return newPull;
  if (method !== "GET") return {};
  if (path === "/notifications") {
    const all = request.query?.all === true;
    return all ? NOTIFICATIONS : NOTIFICATIONS.filter((n) => n.unread);
  }
  const actions = actionsBody(path);
  if (actions !== null) return actions;
  const releases = releasesBody(path);
  if (releases !== undefined) return releases;
  if (/\/pulls\/\d+\/files$/.test(path)) return FILES;
  if (/\/readme$/.test(path)) {
    return '<div id="readme" class="md"><article class="markdown-body"><h1>Rocket</h1><p>Blazing fast uploads for everyone.</p><h2>Install</h2><pre><code>cargo add rocket-upload</code></pre><p>See <a href="docs/usage.md">the usage guide</a>.</p></article></div>';
  }
  const commit = /\/commits\/([0-9a-f]+)$/.exec(path);
  if (commit) {
    return {
      sha: commit[1].padEnd(40, "0"),
      commit: { message: "Add retries to upload client\n\nUses exponential backoff.", author: { name: "Alice", date: ago(600) }, committer: { name: "Alice", date: ago(600) } },
      author: { login: "alice", avatar_url: alice.avatarUrl },
      parents: [{ sha: "0f0f0f0f0f0f" }],
      stats: { additions: 17, deletions: 4, total: 21 },
      files: FILES.slice(0, 1),
    };
  }
  if (/\/commits$/.test(path)) {
    return [0, 1, 2].map((i) => ({
      sha: `${i}abcdef1234567`,
      commit: { message: ["Add retries", "Fix typo in README", "Initial commit"][i], author: { name: "Alice", date: ago(i * 600 + 30) }, committer: { date: ago(i * 600 + 30) } },
      author: { login: "alice", avatar_url: alice.avatarUrl },
    }));
  }
  const contents = /\/contents\/?(.*)$/.exec(path);
  if (contents) {
    const p = decodeURIComponent(contents[1]);
    if (p === "" || p === "src") {
      const dir = p ? `${p}/` : "";
      return [
        { type: "dir", name: "src", path: `${dir}src` },
        { type: "file", name: "Cargo.toml", path: `${dir}Cargo.toml` },
        { type: "file", name: "README.md", path: `${dir}README.md` },
        { type: "file", name: "client.rs", path: `${dir}client.rs` },
      ].map((e) => ({ ...e, sha: "x", size: 100, url: "", html_url: "", git_url: "", download_url: null, _links: {} }));
    }
    if (request.accept?.includes("html")) return "<h1>Rocket</h1><p>Rendered markdown preview.</p>";
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
    authSetClientId: (clientId) => delay({ clientId, clientIdSource: clientId ? ("user" as const) : null, scopes: "" }),
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
    rest: async <T,>(request: RestRequest) => {
      const body = restBody(request);
      if (body === NOT_FOUND) throw await delay(new ApiError("Not Found", "api", 404));
      return delay<RestResponse<T>>({ status: 200, body: body as T, link: null });
    },
    graphql: <T,>(query: string, variables?: Record<string, unknown>) =>
      delay<GraphQLEnvelope<T>>({ data: graphqlData(query, variables ?? {}) as T }),
    jobLogs: () => delay({ text: JOB_LOG, truncated: false }),
    downloadUrl: (target) =>
      delay(target.kind === "asset" ? `https://objects.githubusercontent.com/mock/${target.assetId}` : `https://codeload.github.com/mock/${target.ref}.${target.format}`),
    openUrl: async (url) => console.info("[mock] open", url),
    copyText: async (text) => console.info("[mock] copy", text),
  };
}
