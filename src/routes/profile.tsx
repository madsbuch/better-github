import { createFileRoute } from "@tanstack/react-router";
import { viewerQueries } from "../queries/viewer";
import { warm } from "../queries/warm";
import { ProfileScreen } from "../screens/ProfileScreen";

export const Route = createFileRoute("/profile")({
  loader: ({ context: { queryClient }, preload }) => warm(queryClient, [viewerQueries.profile()], { preload }),
  component: ProfileScreen,
});
