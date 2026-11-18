// Preloading. Route loaders call `warm` when a link is touched, scrolls into
// view, or is followed, so data is usually cached before the screen renders.

import type { FetchInfiniteQueryOptions, FetchQueryOptions, QueryClient, QueryKey } from "@tanstack/react-query";
import { isGuest } from "../lib/guest";
import { viewerQueries } from "./viewer";

/** A query to load ahead of time, with its data types erased so lists can mix them. */
export interface Warmable {
  /** Loads it unless cached; errors show on the screen itself (with a retry), never as a failed navigation. */
  ensure(queryClient: QueryClient): Promise<unknown>;
  /** Fetches it unless the cached data is fresh. */
  prefetch(queryClient: QueryClient): Promise<void>;
}

function isInfinite<TQueryFnData, TError, TData, TQueryKey extends QueryKey, TPageParam>(
  options: FetchInfiniteQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam> | FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): options is FetchInfiniteQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam> {
  return "getNextPageParam" in options;
}

/** Wraps what a factory in src/queries returns (`queryOptions` or `infiniteQueryOptions`) for `warm`. */
export function query<TQueryFnData, TError, TData, TQueryKey extends QueryKey, TPageParam>(
  options: FetchInfiniteQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
): Warmable;
export function query<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): Warmable;
export function query<TQueryFnData, TError, TData, TQueryKey extends QueryKey, TPageParam>(
  options: FetchInfiniteQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam> | FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): Warmable {
  if (isInfinite(options)) {
    return {
      ensure: (queryClient) => queryClient.ensureInfiniteQueryData(options).catch(() => undefined),
      prefetch: (queryClient) => queryClient.prefetchInfiniteQuery(options),
    };
  }
  return {
    ensure: (queryClient) => queryClient.ensureQueryData(options).catch(() => undefined),
    prefetch: (queryClient) => queryClient.prefetchQuery(options),
  };
}

/** How long a navigation waits for data before showing the screen with placeholders. */
const NAVIGATION_WAIT_MS = 250;

/**
 * Makes sure `primary` is cached, waiting at most a moment so navigation
 * stays instant on a slow network, and starts `secondary` in the background
 * (only when actually navigating, not on a mere preload).
 */
export async function warm(
  queryClient: QueryClient,
  primary: Warmable[],
  { secondary = [], preload = false }: { secondary?: Warmable[]; preload?: boolean } = {},
): Promise<void> {
  // Guests have 60 requests an hour: load only what is actually opened.
  if (isGuest()) {
    if (preload) return;
    secondary = [];
  }
  const ready = Promise.all(primary.map((item) => item.ensure(queryClient)));
  if (!preload) secondary.forEach((item) => void item.ensure(queryClient));
  await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, NAVIGATION_WAIT_MS))]);
}

/** Fills the cache for the main tabs right after startup, so switching tabs never waits. */
export function warmStartup(queryClient: QueryClient) {
  if (isGuest()) return;
  const items = [query(viewerQueries.repos("yours")), query(viewerQueries.repos("starred")), query(viewerQueries.profile())];
  // prefetch* respects staleTime, so fresh restored data isn't refetched.
  for (const item of items) void item.prefetch(queryClient);
}
