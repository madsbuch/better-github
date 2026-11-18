import { infiniteQueryOptions, queryOptions, type InfiniteData } from "@tanstack/react-query";
import { z } from "zod";
import { rest, restPage, restSend, type Page } from "../lib/api";
import { affects, keys, type NotificationFilter } from "./keys";
import { patchQueries, useAppMutation } from "./mutation";

/** The fields of GitHub's notification `thread` the app reads. */
export const RestNotification = z.object({
  id: z.string(),
  repository: z.object({
    name: z.string(),
    full_name: z.string(),
    owner: z.object({ login: z.string(), avatar_url: z.string() }),
  }),
  subject: z.object({
    title: z.string(),
    // Documented as a string, but null for some types (e.g. workflow run notifications).
    url: z.string().nullable(),
    type: z.string(),
  }),
  reason: z.string(),
  unread: z.boolean(),
  updated_at: z.string(),
});
export type RestNotification = z.infer<typeof RestNotification>;

type NotificationPages = InfiniteData<Page<RestNotification>>;

export const notificationQueries = {
  list: (filter: NotificationFilter) =>
    infiniteQueryOptions({
      queryKey: keys.notifications.list(filter),
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        pageParam !== null && pageParam !== ""
          ? restPage(RestNotification, pageParam)
          : restPage(RestNotification, "/notifications", {
              query: { per_page: 50, all: filter === "all", participating: filter === "participating" },
            }),
      initialPageParam: null,
      getNextPageParam: (last) => last.next ?? undefined,
      staleTime: 30_000,
    }),
  /** Drives the dot on the Inbox tab. */
  hasUnread: () =>
    queryOptions({
      queryKey: keys.notifications.unread(),
      queryFn: async () => (await rest(z.array(RestNotification), "/notifications", { query: { per_page: 1 } })).length > 0,
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
    mutationFn: (n: RestNotification) => restSend(`/notifications/threads/${n.id}`, { method: "PATCH" }),
    optimistic: (n, queryClient) =>
      patchQueries<NotificationPages>(queryClient, lists, patchLists((items) => items.map((i) => (i.id === n.id ? { ...i, unread: false } : i)))),
    invalidates: () => [keys.notifications.unread()],
    // Not worth interrupting for: it shows as unread again on refresh.
    toastErrors: false,
  });
}

export function useMarkNotificationDone() {
  return useAppMutation({
    mutationFn: (n: RestNotification) => restSend(`/notifications/threads/${n.id}`, { method: "DELETE" }),
    optimistic: (n, queryClient) => patchQueries<NotificationPages>(queryClient, lists, patchLists((items) => items.filter((i) => i.id !== n.id))),
    invalidates: () => [keys.notifications.unread()],
  });
}

export function useMarkAllNotificationsRead() {
  return useAppMutation({
    mutationFn: () => restSend("/notifications", { method: "PUT", body: { read: true } }),
    optimistic: (_vars, queryClient) =>
      patchQueries<NotificationPages>(queryClient, lists, patchLists((items) => items.map((i) => ({ ...i, unread: false })))),
    success: "Marked everything as read",
    invalidates: affects.notifications,
  });
}
