import { z } from "zod";
import { ApiError, backend, type RestRequest } from "./backend";
import { isGuest } from "./guest";
import type { GraphQLDocument } from "./schema";

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

export type RestOptions = Omit<RestRequest, "path">;

/** The single place responses are checked: anything that doesn't match `schema` fails like a request error. */
function parseBody<S extends z.ZodType>(schema: S, body: unknown, what: string): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new ApiError(`GitHub sent an unexpected response for ${what}.\n${z.prettifyError(parsed.error)}`, "invalid_response");
}

/** Path without the origin and query, for error messages. */
function describe(path: string): string {
  return path.replace(/^https:\/\/api\.github\.com/, "").replace(/\?.*$/, "");
}

/** A REST call whose response is parsed with `schema`. */
export async function rest<S extends z.ZodType>(schema: S, path: string, options: RestOptions = {}): Promise<z.infer<S>> {
  const response = await guard(backend.rest({ path, ...options }));
  return parseBody(schema, response.body, describe(path));
}

/** A REST call made for its effect; the response body isn't read. */
export async function restSend(path: string, options: RestOptions = {}): Promise<void> {
  await guard(backend.rest({ path, ...options }));
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

/**
 * Fetches one page of a paginated REST list; `next` is the URL of the next
 * page. `listKey` names the array in wrapped responses: "items" for search,
 * "workflow_runs" for Actions; plain lists are arrays.
 */
export async function restPage<S extends z.ZodType>(
  item: S,
  path: string,
  options: RestOptions = {},
  listKey?: string,
): Promise<Page<z.infer<S>>> {
  const response = await guard(backend.rest({ path, ...options }));
  const list = z.array(item);
  const items =
    listKey === undefined
      ? parseBody(list, response.body, describe(path))
      : parseBody(z.object({ [listKey]: list }).transform((page) => page[listKey]), response.body, describe(path));
  return { items: items ?? [], next: parseLink(response.link).next ?? null };
}

/** Follows `Link` headers until exhausted or `limit` items are collected. */
export async function restAll<S extends z.ZodType>(item: S, path: string, options: RestOptions = {}, limit = 3000): Promise<z.infer<S>[]> {
  const all: z.infer<S>[] = [];
  let page = await restPage(item, path, options);
  all.push(...page.items);
  while (page.next !== null && all.length < limit) {
    page = await restPage(item, page.next, options.accept === undefined ? {} : { accept: options.accept });
    all.push(...page.items);
  }
  return all;
}

export async function graphql<S extends z.ZodType>(document: GraphQLDocument<S>, variables?: Record<string, unknown>): Promise<z.infer<S>> {
  // GitHub's GraphQL API always needs a token; guest screens use REST.
  if (isGuest()) throw new ApiError("Sign in to GitHub to see this.", "not_authenticated", 401);
  const envelope = await guard(backend.graphql(document.source, variables));
  return parseBody(document.result, envelope.data, operationName(document.source));
}

function operationName(source: string): string {
  return /(?:query|mutation)\s+(\w+)/.exec(source)?.[1] ?? "a GraphQL query";
}

/** Parses an RFC 8288 `Link` header into `{ next, prev, last, first }`. */
export function parseLink(header: string | null | undefined): Record<string, string> {
  const links: Record<string, string> = {};
  if (header === null || header === undefined || header === "") return links;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?([^";]+)"?/);
    const url = match?.[1];
    const rels = match?.[2];
    if (url !== undefined && rels !== undefined) {
      for (const rel of rels.split(/\s+/)) links[rel] = url;
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
