import { createFileRoute } from "@tanstack/react-router";
import { optionalString } from "../../../lib/search-params";
import { repoQueries } from "../../../queries/repos";
import { specQueries } from "../../../queries/spec";
import { query, warm } from "../../../queries/warm";
import { SpecScreen } from "../../../screens/SpecScreen";

export const Route = createFileRoute("/$owner/$repo/spec")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { ref?: string | undefined; id?: string | undefined; r?: string | undefined; q?: string | undefined; k?: string | undefined } => ({
    ref: optionalString(search.ref),
    // An item ("uploads/retries"), one of its requirements, and the outline's filter.
    id: optionalString(search.id),
    r: optionalString(search.r),
    q: optionalString(search.q),
    // What the outline's index shows: requirements, stories, values or deprecated.
    k: optionalString(search.k),
  }),
  loaderDeps: ({ search }) => ({ ref: search.ref }),
  loader: ({ context: { queryClient }, params: { owner, repo }, deps, preload }) =>
    warm(queryClient, [deps.ref !== undefined ? query(specQueries.root(owner, repo, deps.ref)) : query(repoQueries.detail(owner, repo))], { preload }),
  component: SpecScreen,
});
