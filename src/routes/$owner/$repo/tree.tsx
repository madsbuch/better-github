import { createFileRoute } from "@tanstack/react-router";
import { optionalString } from "../../../lib/search-params";
import { repoQueries } from "../../../queries/repos";
import { query, warm } from "../../../queries/warm";
import { TreeScreen } from "../../../screens/TreeScreen";

export const Route = createFileRoute("/$owner/$repo/tree")({
  validateSearch: (search: Record<string, unknown>): { ref?: string | undefined; path?: string | undefined } => ({
    ref: optionalString(search.ref),
    path: optionalString(search.path),
  }),
  loaderDeps: ({ search }) => ({ ref: search.ref, path: search.path ?? "" }),
  loader: ({ context: { queryClient }, params: { owner, repo }, deps, preload }) =>
    warm(queryClient, [deps.ref !== undefined ? query(repoQueries.contents(owner, repo, deps.ref, deps.path)) : query(repoQueries.detail(owner, repo))], { preload }),
  component: TreeScreen,
});
