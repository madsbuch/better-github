// App routes mirror github.com URLs so links inside rendered markdown and
// notifications map straight onto screens.

export type RouteName =
  | "inbox"
  | "notifications"
  | "repos"
  | "profile"
  | "search"
  | "settings"
  | "user"
  | "repo"
  | "tree"
  | "blob"
  | "pull"
  | "issue"
  | "commit"
  | "notFound";

export interface RouteMatch {
  name: RouteName;
  params: Record<string, string>;
  query: URLSearchParams;
}

/** Top-level screens reachable from the tab bar. */
export const TAB_ROUTES = ["inbox", "notifications", "repos", "profile"] as const;
export type TabRoute = (typeof TAB_ROUTES)[number];

const STATIC: Record<string, RouteName> = {
  "": "inbox",
  notifications: "notifications",
  repos: "repos",
  profile: "profile",
  search: "search",
  settings: "settings",
};

export function matchPath(path: string): RouteMatch {
  const [pathname, search = ""] = path.split("?", 2);
  const query = new URLSearchParams(search);
  const segments = pathname.split("/").filter(Boolean).map(safeDecode);

  if (segments.length <= 1 && (segments[0] ?? "") in STATIC) {
    return { name: STATIC[segments[0] ?? ""], params: {}, query };
  }
  const [owner, repo, kind, id] = segments;
  if (segments.length === 1) return { name: "user", params: { owner }, query };
  if (segments.length === 2) return { name: "repo", params: { owner, repo }, query };
  if (segments.length === 3 && (kind === "tree" || kind === "blob")) {
    return { name: kind, params: { owner, repo }, query };
  }
  if (segments.length === 4) {
    if (kind === "pull" && /^\d+$/.test(id)) return { name: "pull", params: { owner, repo, number: id }, query };
    if (kind === "issues" && /^\d+$/.test(id)) return { name: "issue", params: { owner, repo, number: id }, query };
    if (kind === "commit" && /^[0-9a-f]{4,40}$/i.test(id)) return { name: "commit", params: { owner, repo, sha: id }, query };
  }
  return { name: "notFound", params: {}, query };
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function withQuery(path: string, query: Record<string, string | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const seg = encodeURIComponent;

export const paths = {
  inbox: (filter?: string) => withQuery("/", { filter }),
  notifications: () => "/notifications",
  repos: () => "/repos",
  profile: () => "/profile",
  settings: () => "/settings",
  search: (q?: string, type?: string) => withQuery("/search", { q, type }),
  user: (login: string) => `/${seg(login)}`,
  repo: (owner: string, repo: string, tab?: string) => withQuery(`/${seg(owner)}/${seg(repo)}`, { tab }),
  tree: (owner: string, repo: string, ref?: string, path?: string) =>
    withQuery(`/${seg(owner)}/${seg(repo)}/tree`, { ref, path }),
  blob: (owner: string, repo: string, ref: string | undefined, path: string) =>
    withQuery(`/${seg(owner)}/${seg(repo)}/blob`, { ref, path }),
  pull: (owner: string, repo: string, number: number | string, tab?: string) =>
    withQuery(`/${seg(owner)}/${seg(repo)}/pull/${number}`, { tab }),
  issue: (owner: string, repo: string, number: number | string) => `/${seg(owner)}/${seg(repo)}/issues/${number}`,
  commit: (owner: string, repo: string, sha: string) => `/${seg(owner)}/${seg(repo)}/commit/${sha}`,
};

/** Splits "owner/name" into its parts. */
export function splitRepo(nameWithOwner: string): [string, string] {
  const index = nameWithOwner.indexOf("/");
  return [nameWithOwner.slice(0, index), nameWithOwner.slice(index + 1)];
}
