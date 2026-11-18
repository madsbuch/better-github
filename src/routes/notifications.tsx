import { createFileRoute } from "@tanstack/react-router";
import type { NotificationsFilter } from "../lib/nav";
import { oneOf } from "../lib/search-params";
import { notificationQueries } from "../queries/notifications";
import { query, warm } from "../queries/warm";
import { NotificationsScreen } from "../screens/NotificationsScreen";

export const Route = createFileRoute("/notifications")({
  validateSearch: (search: Record<string, unknown>): { filter?: NotificationsFilter | undefined } => ({
    filter: oneOf(search.filter, ["participating", "all"] as const),
  }),
  loaderDeps: ({ search }) => ({ filter: search.filter ?? ("unread" as const) }),
  loader: ({ context: { queryClient }, deps, preload }) => warm(queryClient, [query(notificationQueries.list(deps.filter))], { preload }),
  component: NotificationsScreen,
});
