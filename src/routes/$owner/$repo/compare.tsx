import { createFileRoute } from "@tanstack/react-router";
import { splitRepo, type CompareSearch } from "../../../lib/nav";
import { oneOf, optionalString } from "../../../lib/search-params";
import { branchQueries } from "../../../queries/branches";
import { newPullQueries } from "../../../queries/newPull";
import { query, warm } from "../../../queries/warm";
import { NewPullScreen } from "../../../screens/NewPullScreen";

const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

// Opening a pull request, like github.com/<owner>/<repo>/compare/<base>...<head>.
export const Route = createFileRoute("/$owner/$repo/compare")({
  validateSearch: (search: Record<string, unknown>): CompareSearch => {
    const from = optionalString(search.from);
    return {
      base: optionalString(search.base),
      head: optionalString(search.head),
      from: from !== undefined && REPO_NAME.test(from) ? from : undefined,
      tab: oneOf(search.tab, ["commits", "files"] as const),
    };
  },
  loaderDeps: ({ search }) => ({ base: search.base, head: search.head, from: search.from }),
  loader: ({ context: { queryClient }, params: { owner, repo }, deps, preload }) => {
    const headRepo = deps.from ?? `${owner}/${repo}`;
    const [headOwner, headName] = splitRepo(headRepo);
    return warm(
      queryClient,
      [
        query(newPullQueries.context(owner, repo)),
        ...(deps.base !== undefined && deps.head !== undefined
          ? [query(newPullQueries.compare(owner, repo, deps.base, { repo: headRepo, branch: deps.head }))]
          : []),
      ],
      {
        secondary: [
          query(newPullQueries.repoBranches(headOwner, headName)),
          query(branchQueries.list(owner, repo)),
          query(branchQueries.list(headOwner, headName)),
        ],
        preload,
      },
    );
  },
  component: NewPullScreen,
});
