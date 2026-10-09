import { createFileRoute } from "@tanstack/react-router";
import { oneOf } from "../lib/search-params";
import type { InboxFilter } from "../queries/keys";
import { INBOX_FILTERS, searchQueries } from "../queries/search";
import { warm } from "../queries/warm";
import { InboxScreen } from "../screens/InboxScreen";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { filter?: InboxFilter } => ({
    filter: oneOf(
      search.filter,
      INBOX_FILTERS.map((f) => f.id),
    ),
  }),
  loaderDeps: ({ search }) => ({ filter: search.filter ?? "review" }),
  loader: ({ context: { queryClient }, deps, preload }) =>
    warm(queryClient, [searchQueries.inbox(deps.filter)], { secondary: [searchQueries.inboxCounts()], preload }),
  component: InboxScreen,
});
