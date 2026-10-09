import { createFileRoute } from "@tanstack/react-router";
import type { RepoSearch, RepoTab, RunStatusFilter } from "../../../lib/nav";
import { oneOf, optionalInt, optionalString } from "../../../lib/search-params";
import { actionsQueries } from "../../../queries/actions";
import { repoQueries } from "../../../queries/repos";
import { repoListQuery, searchQueries } from "../../../queries/search";
import { warm } from "../../../queries/warm";
import { RepoScreen } from "../../../screens/RepoScreen";

const TABS: RepoTab[] = ["about", "code", "pulls", "issues", "commits", "actions"];
const RUN_STATUSES: RunStatusFilter[] = ["in_progress", "failure"];

export const Route = createFileRoute("/$owner/$repo/")({
  validateSearch: (search: Record<string, unknown>): RepoSearch => ({
    tab: oneOf(search.tab, TABS),
    ref: optionalString(search.ref),
    workflow: optionalInt(search.workflow),
    status: oneOf(search.status, RUN_STATUSES),
  }),
  loaderDeps: ({ search }) => ({ tab: search.tab ?? "about", workflow: search.workflow, status: search.status }),
  loader: ({ context: { queryClient }, params: { owner, repo }, deps, preload }) => {
    const tabData = {
      about: [repoQueries.readme(owner, repo)],
      pulls: [searchQueries.issues(repoListQuery(owner, repo, "pulls", "open"))],
      issues: [searchQueries.issues(repoListQuery(owner, repo, "issues", "open"))],
      actions: [actionsQueries.runs(owner, repo, { workflow: deps.workflow, status: deps.status }), actionsQueries.workflows(owner, repo)],
      // Both need the default branch from the repository first.
      code: [],
      commits: [],
    }[deps.tab];
    return warm(queryClient, [repoQueries.detail(owner, repo), ...tabData], { preload });
  },
  component: RepoScreen,
});
