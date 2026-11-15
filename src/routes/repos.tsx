import { createFileRoute } from "@tanstack/react-router";
import { oneOf } from "../lib/search-params";
import { guestProfiles, isGuest } from "../lib/guest";
import { guestQueries } from "../queries/guest";
import { viewerQueries } from "../queries/viewer";
import { warm } from "../queries/warm";
import { ReposScreen } from "../screens/ReposScreen";

export const Route = createFileRoute("/repos")({
  validateSearch: (search: Record<string, unknown>): { tab?: "starred" } => ({ tab: oneOf(search.tab, ["starred"] as const) }),
  loaderDeps: ({ search }) => ({ tab: search.tab ?? ("yours" as const) }),
  loader: ({ context: { queryClient }, deps, preload }) =>
    warm(queryClient, isGuest() ? guestProfiles().map(guestQueries.repos) : [viewerQueries.repos(deps.tab)], { preload }),
  component: ReposScreen,
});
