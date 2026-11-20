import { createFileRoute } from "@tanstack/react-router";
import { isGuest } from "../lib/guest";
import { viewerQueries } from "../queries/viewer";
import { query, warm } from "../queries/warm";
import { OrgsScreen } from "../screens/OrgsScreen";

export const Route = createFileRoute("/orgs")({
  // Guests belong to no organization; the screen says so.
  loader: ({ context: { queryClient }, preload }) => warm(queryClient, isGuest() ? [] : [query(viewerQueries.orgs())], { preload }),
  component: OrgsScreen,
});
