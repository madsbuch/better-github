import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createStore, del, get, set } from "idb-keyval";
import { ApiError } from "../lib/api";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: {
      /** Set false for large or short-lived data (diffs, files, logs) to keep it out of the on-device cache. */
      persist?: boolean;
    };
  }
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cached data always renders immediately; stale data refetches in the background.
      staleTime: MINUTE,
      // Long enough to survive in the on-device cache (see `restoreCache`).
      gcTime: DAY,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        const status = ApiError.from(error).status;
        // Client errors (404, 403, 422...) won't fix themselves.
        if (status !== null && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

// The query cache is saved to IndexedDB in the app's private storage, so the
// app opens with the last data it showed instead of spinners, then refreshes.
const store = typeof indexedDB === "undefined" ? undefined : createStore("gh-commander", "query-cache");
const persister = createAsyncStoragePersister({
  storage: store
    ? {
        getItem: (key) => get<string>(key, store).then((value) => value ?? null),
        setItem: (key, value: string) => set(key, value, store),
        removeItem: (key) => del(key, store),
      }
    : undefined,
  key: "queries",
  // Saving serializes the whole cache; polling queries change it often.
  throttleTime: 10_000,
});

/** Restores the saved cache and keeps saving it. Resolves when the cache is ready (or gave up). */
export async function restoreCache(): Promise<void> {
  const [, restored] = persistQueryClient({
    queryClient,
    persister,
    maxAge: DAY,
    // A new build may change what queries return, so it starts with a fresh cache.
    buster: __BUILD_ID__,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => query.state.status === "success" && query.meta?.persist !== false,
    },
  });
  // Never let a slow or broken IndexedDB hold up the app.
  await Promise.race([restored.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 1500))]);
}

/** Forgets everything cached, in memory and on the device (on sign-out). */
export async function clearCache(): Promise<void> {
  queryClient.clear();
  await persister.removeClient();
}
