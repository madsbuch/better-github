import { createFileRoute } from "@tanstack/react-router";
import { viewerQueries } from "../queries/viewer";
import { query, warm } from "../queries/warm";
import { SettingsScreen } from "../screens/SettingsScreen";

export const Route = createFileRoute("/settings")({
  loader: ({ context: { queryClient }, preload }) => warm(queryClient, [], { secondary: [query(viewerQueries.rateLimit())], preload }),
  component: SettingsScreen,
});
