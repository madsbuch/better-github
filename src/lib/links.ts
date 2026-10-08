import { paths } from "./routes";

// First path segments on github.com that are not users or organizations.
const RESERVED = new Set([
  "about", "account", "apps", "blog", "codespaces", "collections", "contact", "customer-stories",
  "dashboard", "enterprise", "events", "explore", "features", "gist", "github", "issues",
  "login", "logout", "marketplace", "new", "notifications", "orgs", "organizations", "pricing",
  "pulls", "readme", "search", "security", "settings", "site", "sponsors", "stars", "topics",
  "trending", "users", "watching",
]);

/**
 * Maps a github.com (or api.github.com) URL to an in-app path, or returns
 * null when the app has no screen for it and it should open in a browser.
 */
export function appPathForUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, "https://github.com");
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname === "api.github.com") return appPathForApiUrl(url);
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;

  const segments = url.pathname.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (segments.length === 0) return paths.inbox();
  const [owner, repo, kind, id, ...rest] = segments;

  if (segments.length === 1) {
    if (owner === "notifications") return paths.notifications();
    if (owner === "pulls") return paths.inbox();
    if (RESERVED.has(owner.toLowerCase())) return null;
    return paths.user(owner);
  }
  if (RESERVED.has(owner.toLowerCase())) return null;
  // GitHub serves e.g. https://github.com/owner/repo.git as the repo page.
  const name = repo.replace(/\.git$/, "");
  if (segments.length === 2) return paths.repo(owner, name);

  switch (kind) {
    case "pull":
      if (id && /^\d+$/.test(id)) {
        const tab = rest[0] === "files" ? "files" : rest[0] === "commits" ? "commits" : rest[0] === "checks" ? "checks" : undefined;
        return paths.pull(owner, name, id, tab);
      }
      return null;
    case "pulls":
      return segments.length === 3 ? paths.repo(owner, name, "pulls") : null;
    case "issues":
      if (segments.length === 3) return paths.repo(owner, name, "issues");
      return id && /^\d+$/.test(id) && rest.length === 0 ? paths.issue(owner, name, id) : null;
    case "commit":
      return id && /^[0-9a-f]{7,40}$/i.test(id) ? paths.commit(owner, name, id) : null;
    case "commits":
      return segments.length <= 4 ? paths.repo(owner, name, "commits") : null;
    case "tree":
      return paths.tree(owner, name, id, rest.join("/") || undefined);
    case "blob":
      return id && rest.length ? paths.blob(owner, name, id, rest.join("/")) : null;
    default:
      return null;
  }
}

function appPathForApiUrl(url: URL): string | null {
  const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/(pulls|issues|commits)\/([^/]+)$/);
  if (!m) {
    const repo = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)$/);
    return repo ? paths.repo(decodeURIComponent(repo[1]), decodeURIComponent(repo[2])) : null;
  }
  const [, owner, repo, kind, id] = m.map((s) => decodeURIComponent(s));
  if (kind === "pulls") return paths.pull(owner, repo, id);
  if (kind === "issues") return paths.issue(owner, repo, id);
  return paths.commit(owner, repo, id);
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
