import { useMemo } from "react";
import { backend } from "./backend";
import { to, useNav, type LinkTarget } from "./nav";

// First path segments on github.com that are not users or organizations.
const RESERVED = new Set([
  "about", "account", "apps", "blog", "codespaces", "collections", "contact", "customer-stories",
  "dashboard", "enterprise", "events", "explore", "features", "gist", "github", "issues",
  "login", "logout", "marketplace", "new", "notifications", "orgs", "organizations", "pricing",
  "pulls", "readme", "search", "security", "settings", "site", "sponsors", "stars", "topics",
  "trending", "users", "watching",
]);

const int = (value: string | undefined) => (value && /^\d{1,15}$/.test(value) ? Number(value) : null);

/**
 * Maps a github.com (or api.github.com) URL to an in-app screen, or returns
 * null when the app has no screen for it and it should open in a browser.
 */
export function appLinkForUrl(href: string): LinkTarget | null {
  let url: URL;
  try {
    url = new URL(href, "https://github.com");
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname === "api.github.com") return appLinkForApiUrl(url);
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;

  const segments = url.pathname.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (segments.length === 0) return to.inbox();
  const [owner, repo, kind, id, ...rest] = segments;

  if (segments.length === 1) {
    if (owner === "notifications") return to.notifications();
    if (owner === "pulls") return to.inbox();
    if (RESERVED.has(owner.toLowerCase())) return null;
    return to.user(owner);
  }
  if (RESERVED.has(owner.toLowerCase())) return null;
  // GitHub serves e.g. https://github.com/owner/repo.git as the repo page.
  const name = repo.replace(/\.git$/, "");
  if (segments.length === 2) return to.repo(owner, name);

  switch (kind) {
    case "pull": {
      const number = int(id);
      if (number === null) return null;
      const tab = rest[0] === "files" ? "files" : rest[0] === "commits" ? "commits" : rest[0] === "checks" ? "checks" : undefined;
      return to.pull(owner, name, number, tab);
    }
    case "pulls":
      return segments.length === 3 ? to.repo(owner, name, { tab: "pulls" }) : null;
    case "issues": {
      if (segments.length === 3) return to.repo(owner, name, { tab: "issues" });
      const number = int(id);
      return number !== null && rest.length === 0 ? to.issue(owner, name, number) : null;
    }
    case "commit":
      return id && /^[0-9a-f]{7,40}$/i.test(id) ? to.commit(owner, name, id) : null;
    case "commits":
      return segments.length <= 4 ? to.repo(owner, name, { tab: "commits" }) : null;
    case "tree":
      return to.tree(owner, name, id, rest.join("/") || undefined);
    case "blob":
      return id && rest.length ? to.blob(owner, name, id, rest.join("/")) : null;
    case "actions":
      return actionsLink(owner, name, segments.slice(3));
    default:
      return null;
  }
}

/** github.com/<o>/<r>/actions[/runs/<id>[/attempts/<n>][/job/<id>]] */
function actionsLink(owner: string, repo: string, rest: string[]): LinkTarget | null {
  if (rest.length === 0 || rest[0] === "workflows") return to.repo(owner, repo, { tab: "actions" });
  if (rest[0] !== "runs") return null;
  const runId = int(rest[1]);
  if (runId === null) return null;
  const tail = rest[2] === "attempts" ? rest.slice(4) : rest.slice(2);
  if (tail.length === 0) return to.run(owner, repo, runId);
  const jobId = tail[0] === "job" ? int(tail[1]) : null;
  return jobId !== null ? to.job(owner, repo, runId, jobId) : null;
}

function appLinkForApiUrl(url: URL): LinkTarget | null {
  const parts = url.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  if (parts[0] !== "repos" || parts.length < 3) return null;
  const [, owner, repo, kind, id, sub] = parts;
  if (parts.length === 3) return to.repo(owner, repo);
  if (parts.length === 5 && kind === "pulls" && int(id) !== null) return to.pull(owner, repo, int(id)!);
  if (parts.length === 5 && kind === "issues" && int(id) !== null) return to.issue(owner, repo, int(id)!);
  if (parts.length === 5 && kind === "commits" && /^[0-9a-f]{4,40}$/i.test(id)) return to.commit(owner, repo, id);
  if (parts.length === 6 && kind === "actions" && id === "runs" && int(sub) !== null) return to.run(owner, repo, int(sub)!);
  return null;
}

/** Converts an api.github.com resource URL into its github.com page. */
export function htmlUrlForApiUrl(apiUrl: string): string {
  try {
    const url = new URL(apiUrl);
    if (url.hostname !== "api.github.com") return apiUrl;
    const path = url.pathname
      .replace(/^\/repos\//, "/")
      .replace(/\/pulls\/(\d+)$/, "/pull/$1")
      .replace(/\/commits\/([0-9a-f]+)$/i, "/commit/$1")
      .replace(/\/releases\/\d+$/, "/releases");
    return `https://github.com${path}`;
  } catch {
    return apiUrl;
  }
}

/** Opens a URL in the app when there's a screen for it, otherwise in a browser tab. */
export function useOpenLink() {
  const nav = useNav();
  return useMemo(
    () => (url: string) => {
      const target = appLinkForUrl(url);
      if (target) nav.navigate(target);
      else void backend.openUrl(url);
    },
    [nav],
  );
}
