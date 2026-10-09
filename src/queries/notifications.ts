import { infiniteQueryOptions, queryOptions, type InfiniteData } from "@tanstack/react-query";
import { rest, restPage, type Page } from "../lib/api";
import type { RestNotification } from "../lib/types";
import { affects, keys, type NotificationFilter } from "./keys";
import { patchQueries, useAppMutation } from "./mutation";

type NotificationPages = InfiniteData<Page<RestNotification>>;

export const notificationQueries = {
  list: (filter: NotificationFilter) =>
    infiniteQueryOptions({
      queryKey: keys.notifications.list(filter),
      queryFn: ({ pageParam }) =>
        pageParam
          ? restPage<RestNotification>(pageParam)
          : restPage<RestNotification>("/notifications", {
              query: { per_page: 50, all: filter === "all", participating: filter === "participating" },
            }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next ?? undefined,
      staleTime: 30_000,
    }),
  /** Drives the dot on the Inbox tab. */
  hasUnread: () =>
    queryOptions({
      queryKey: keys.notifications.unread(),
      queryFn: async () => (await rest<RestNotification[]>("/notifications", { query: { per_page: 1 } })).length > 0,
      refetchInterval: 120_000,
      staleTime: 60_000,
    }),
};

/** Applies `fn` to the items of every cached notification list. */
function patchLists(fn: (items: RestNotification[]) => RestNotification[]) {
  return (data: NotificationPages): NotificationPages => ({ ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items) })) });
}

const lists = { queryKey: [...keys.notifications.all(), "list"] };

export function useMarkNotificationRead() {
  return useAppMutation({
    mutationFn: (n: RestNotification) => rest(`/notifications/threads/${n.id}`, { method: "PATCH" }),
    optimistic: (n, queryClient) =>
      patchQueries<NotificationPages>(queryClient, lists, patchLists((items) => items.map((i) => (i.id === n.id ? { ...i, unread: false } : i)))),
    invalidates: () => [keys.notifications.unread()],
    // Not worth interrupting for: it shows as unread again on refresh.
    toastErrors: false,
  });
}

export function useMarkNotificationDone() {
  return useAppMutation({
    mutationFn: (n: RestNotification) => rest(`/notifications/threads/${n.id}`, { method: "DELETE" }),
    optimistic: (n, queryClient) => patchQueries<NotificationPages>(queryClient, lists, patchLists((items) => items.filter((i) => i.id !== n.id))),
    invalidates: () => [keys.notifications.unread()],
  });
}

export function useMarkAllNotificationsRead() {
  return useAppMutation({
    mutationFn: () => rest("/notifications", { method: "PUT", body: { read: true } }),
    optimistic: (_vars, queryClient) =>
      patchQueries<NotificationPages>(queryClient, lists, patchLists((items) => items.map((i) => ({ ...i, unread: false })))),
    success: "Marked everything as read",
    invalidates: affects.notifications,
  });
}
