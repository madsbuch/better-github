import { createFileRoute } from "@tanstack/react-router";
import { optionalString } from "../../../lib/search-params";
import { repoQueries } from "../../../queries/repos";
import { specQueries } from "../../../queries/spec";
import { query, warm } from "../../../queries/warm";
import { SpecDiffScreen } from "../../../screens/SpecDiffScreen";

export const Route = createFileRoute("/$owner/$repo/spec-diff")({
  // What changed in the spec from `base` (default: the default branch) to `head`. Both are branches or commits.
  validateSearch: (search: Record<string, unknown>): { base?: string | undefined; head?: string | undefined } => ({
    base: optionalString(search.base),
    head: optionalString(search.head),
  }),
  loaderDeps: ({ search }) => ({ base: search.base, head: search.head }),
  loader: ({ context: { queryClient }, params: { owner, repo }, deps, preload }) =>
    warm(
      queryClient,
      [
        deps.base !== undefined ? query(specQueries.root(owner, repo, deps.base)) : query(repoQueries.detail(owner, repo)),
        ...(deps.head !== undefined ? [query(specQueries.root(owner, repo, deps.head))] : []),
      ],
      { preload },
    ),
  component: SpecDiffScreen,
});
