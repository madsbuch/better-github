import { createFileRoute } from "@tanstack/react-router";
import { viewerQueries } from "../../queries/viewer";
import { query, warm } from "../../queries/warm";
import { UserScreen } from "../../screens/UserScreen";

export const Route = createFileRoute("/$owner/")({
  loader: ({ context: { queryClient }, params, preload }) => warm(queryClient, [query(viewerQueries.owner(params.owner))], { preload }),
  component: UserScreen,
});
