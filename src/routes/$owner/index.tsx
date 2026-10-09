import { createFileRoute } from "@tanstack/react-router";
import { viewerQueries } from "../../queries/viewer";
import { warm } from "../../queries/warm";
import { UserScreen } from "../../screens/UserScreen";

export const Route = createFileRoute("/$owner/")({
  loader: ({ context: { queryClient }, params, preload }) => warm(queryClient, [viewerQueries.owner(params.owner)], { preload }),
  component: UserScreen,
});
