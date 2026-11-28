import { createFileRoute } from "@tanstack/react-router";
import { canManageApps } from "../lib/apps";
import { isGuest } from "../lib/guest";
import { appQueries } from "../queries/apps";
import { query, warm } from "../queries/warm";
import { AppsScreen } from "../screens/AppsScreen";

export const Route = createFileRoute("/apps")({
  // Only the Android app can see what's installed; elsewhere the screen says so.
  loader: ({ context: { queryClient }, preload }) =>
    warm(queryClient, canManageApps() && !isGuest() ? [query(appQueries.repos())] : [], { preload }),
  component: AppsScreen,
});
