// Preloading. Route loaders call `warm` when a link is touched, scrolls into
// view, or is followed, so data is usually cached before the screen renders.

import type { FetchInfiniteQueryOptions, FetchQueryOptions, QueryClient } from "@tanstack/react-query";
import { INBOX_FILTERS, searchQueries } from "./search";
import { notificationQueries } from "./notifications";
import { viewerQueries } from "./viewer";

// Each factory in src/queries returns one of these.
type AnyOptions = FetchQueryOptions<any, any, any, any> | FetchInfiniteQueryOptions<any, any, any, any, any>;

/** How long a navigation waits for data before showing the screen with placeholders. */
const NAVIGATION_WAIT_MS = 250;

function load(queryClient: QueryClient, options: AnyOptions): Promise<unknown> {
  const promise =
    "getNextPageParam" in options
      ? queryClient.ensureInfiniteQueryData(options as FetchInfiniteQueryOptions)
      : queryClient.ensureQueryData(options as FetchQueryOptions);
  // Errors show on the screen itself (with a retry), never as a failed navigation.
  return promise.catch(() => undefined);
}

/**
 * Makes sure `primary` is cached, waiting at most a moment so navigation
 * stays instant on a slow network, and starts `secondary` in the background
 * (only when actually navigating, not on a mere preload).
 */
export async function warm(
  queryClient: QueryClient,
  primary: AnyOptions[],
  { secondary = [], preload = false }: { secondary?: AnyOptions[]; preload?: boolean } = {},
): Promise<void> {
  const ready = Promise.all(primary.map((options) => load(queryClient, options)));
  if (!preload) secondary.forEach((options) => void load(queryClient, options));
  await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, NAVIGATION_WAIT_MS))]);
}

/** Fills the cache for the main tabs right after startup, so switching tabs never waits. */
export function warmStartup(queryClient: QueryClient) {
  const options: AnyOptions[] = [
    searchQueries.inboxCounts(),
    ...INBOX_FILTERS.map((f) => searchQueries.inbox(f.id)),
    notificationQueries.list("unread"),
    notificationQueries.hasUnread(),
    viewerQueries.repos("yours"),
    viewerQueries.profile(),
  ];
  // prefetch* respects staleTime, so fresh restored data isn't refetched.
  for (const o of options) {
    if ("getNextPageParam" in o) void queryClient.prefetchInfiniteQuery(o as FetchInfiniteQueryOptions);
    else void queryClient.prefetchQuery(o as FetchQueryOptions);
  }
}
