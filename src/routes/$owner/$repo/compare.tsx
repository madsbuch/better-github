import { createFileRoute } from "@tanstack/react-router";
import type { CompareSearch } from "../../../lib/nav";
import { oneOf, optionalString } from "../../../lib/search-params";
import { newPullQueries } from "../../../queries/newPull";
import { warm } from "../../../queries/warm";
import { NewPullScreen } from "../../../screens/NewPullScreen";

const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

// Opening a pull request, like github.com/<owner>/<repo>/compare/<base>...<head>.
export const Route = createFileRoute("/$owner/$repo/compare")({
  validateSearch: (search: Record<string, unknown>): CompareSearch => {
    const from = optionalString(search.from);
    return {
      base: optionalString(search.base),
      head: optionalString(search.head),
      from: from && REPO_NAME.test(from) ? from : undefined,
      tab: oneOf(search.tab, ["commits", "files"] as const),
    };
  },
  loaderDeps: ({ search }) => ({ base: search.base, head: search.head, from: search.from }),
  loader: ({ context: { queryClient }, params: { owner, repo }, deps, preload }) => {
    const headRepo = deps.from ?? `${owner}/${repo}`;
    const [headOwner, headName] = headRepo.split("/");
    return warm(
      queryClient,
      [
        newPullQueries.context(owner, repo),
        ...(deps.base && deps.head ? [newPullQueries.compare(owner, repo, deps.base, { repo: headRepo, branch: deps.head })] : []),
      ],
      { secondary: [newPullQueries.repoBranches(headOwner, headName)], preload },
    );
  },
  component: NewPullScreen,
});
