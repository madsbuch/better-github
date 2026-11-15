import { createFileRoute } from "@tanstack/react-router";
import { guestProfiles, isGuest } from "../lib/guest";
import { guestQueries } from "../queries/guest";
import { viewerQueries } from "../queries/viewer";
import { warm } from "../queries/warm";
import { ProfileScreen } from "../screens/ProfileScreen";

export const Route = createFileRoute("/profile")({
  loader: ({ context: { queryClient }, preload }) =>
    warm(queryClient, isGuest() ? guestProfiles().map(guestQueries.profile) : [viewerQueries.profile()], { preload }),
  component: ProfileScreen,
});
