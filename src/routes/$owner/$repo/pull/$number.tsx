import { createFileRoute } from "@tanstack/react-router";
import type { PullTab } from "../../../../lib/nav";
import { intParam, oneOf } from "../../../../lib/search-params";
import { pullQueries, warmPullDiff } from "../../../../queries/pulls";
import { query, warm } from "../../../../queries/warm";
import { PullScreen } from "../../../../screens/PullScreen";

const TABS: PullTab[] = ["conversation", "files", "spec", "commits", "checks"];

export const Route = createFileRoute("/$owner/$repo/pull/$number")({
  params: {
    parse: (raw) => {
      const number = intParam(raw.number);
      return number === false ? false : { ...raw, number };
    },
    stringify: (params) => ({ ...params, number: String(params.number) }),
  },
  validateSearch: (search: Record<string, unknown>): { tab?: PullTab | undefined } => ({ tab: oneOf(search.tab, TABS) }),
  loader: ({ context: { queryClient }, params: { owner, repo, number }, preload }) => {
    warmPullDiff(queryClient, owner, repo, number, preload);
    return warm(queryClient, [query(pullQueries.detail(owner, repo, number)), query(pullQueries.timeline(owner, repo, number))], {
      secondary: [
        query(pullQueries.threads(owner, repo, number)),
        query(pullQueries.checks(owner, repo, number)),
        query(pullQueries.commits(owner, repo, number)),
        query(pullQueries.viewed(owner, repo, number)),
      ],
      preload,
    });
  },
  component: PullScreen,
});
