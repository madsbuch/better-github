import { ApiError, backend, type QueryValue, type RestRequest } from "./backend";
import { isGuest } from "./guest";

export { ApiError };

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** Called when GitHub rejects the stored token (revoked or expired). */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

async function guard<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    const apiError = ApiError.from(error);
    if (apiError.status === 401) unauthorizedListeners.forEach((l) => l());
    throw apiError;
  }
}

export interface RestOptions {
  method?: RestRequest["method"];
  query?: Record<string, QueryValue>;
  body?: unknown;
  accept?: string;
}

export async function rest<T>(path: string, options: RestOptions = {}): Promise<T> {
  const response = await guard(backend.rest<T>({ path, ...options }));
  return response.body;
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

/**
 * Fetches one page of a paginated REST list; `next` is the URL of the next
 * page. `listKey` names the array in wrapped responses: "items" for search,
 * "workflow_runs" for Actions.
 */
export async function restPage<T>(path: string, options: RestOptions = {}, listKey = "items"): Promise<Page<T>> {
  const response = await guard(backend.rest<T[] | Record<string, T[] | undefined>>({ path, ...options }));
  const body = response.body;
  const items = Array.isArray(body) ? body : (body?.[listKey] ?? []);
  return { items, next: parseLink(response.link).next ?? null };
}

/** Follows `Link` headers until exhausted or `limit` items are collected. */
export async function restAll<T>(path: string, options: RestOptions = {}, limit = 3000): Promise<T[]> {
  const all: T[] = [];
  let page = await restPage<T>(path, options);
  all.push(...page.items);
  while (page.next && all.length < limit) {
    page = await restPage<T>(page.next, { accept: options.accept });
    all.push(...page.items);
  }
  return all;
}

export async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  // GitHub's GraphQL API always needs a token; guest screens use REST.
  if (isGuest()) throw new ApiError("Sign in to GitHub to see this.", "not_authenticated", 401);
  const envelope = await guard(backend.graphql<T>(query, variables));
  return dropNullNodes(envelope.data) as T;
}

/**
 * GitHub puts `null` into connection `nodes` for items the viewer can't see
 * (e.g. from SAML-protected organizations) and reports them as partial
 * errors. Drop those entries so lists can assume every node is real.
 */
export function dropNullNodes(value: unknown): unknown {
  if (Array.isArray(value)) {
    value.forEach(dropNullNodes);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const child = record[key];
      if (key === "nodes" && Array.isArray(child)) record[key] = child.filter((node) => node !== null && node !== undefined);
      dropNullNodes(record[key]);
    }
  }
  return value;
}

/** Parses an RFC 8288 `Link` header into `{ next, prev, last, first }`. */
export function parseLink(header: string | null | undefined): Record<string, string> {
  const links: Record<string, string> = {};
  if (!header) return links;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?([^";]+)"?/);
    if (match) {
      for (const rel of match[2].split(/\s+/)) links[rel] = match[1];
    }
  }
  return links;
}

export function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function errorMessage(error: unknown): string {
  const e = ApiError.from(error);
  if (e.kind === "network") return "Can't reach GitHub. Check your connection.";
  if (isGuest()) {
    if (e.kind === "not_authenticated" || e.status === 401) return "Sign in to GitHub to see this.";
    if (e.status === 404) return "Not found. It may be private.";
    if ((e.status === 403 || e.status === 429) && /rate limit/i.test(e.message))
      return "GitHub allows 60 requests an hour without signing in. Try again later, or sign in for more.";
  }
  if (e.status === 404) return "Not found, or you don't have access.";
  if (e.status === 403 && /rate limit/i.test(e.message)) return "GitHub rate limit reached. Try again in a bit.";
  return e.message;
}
