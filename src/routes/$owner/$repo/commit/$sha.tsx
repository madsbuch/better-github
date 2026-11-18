import { createFileRoute } from "@tanstack/react-router";
import { repoQueries } from "../../../../queries/repos";
import { query, warm } from "../../../../queries/warm";
import { CommitScreen } from "../../../../screens/CommitScreen";

export const Route = createFileRoute("/$owner/$repo/commit/$sha")({
  params: {
    parse: (raw) => (/^[0-9a-f]{4,40}$/i.test(raw.sha) ? raw : false),
    stringify: (params) => params,
  },
  loader: ({ context: { queryClient }, params: { owner, repo, sha }, preload }) =>
    warm(queryClient, [query(repoQueries.commit(owner, repo, sha))], { preload }),
  component: CommitScreen,
});
