import { createFileRoute } from "@tanstack/react-router";
import type { PullTab } from "../../../../lib/nav";
import { intParam, oneOf } from "../../../../lib/search-params";
import { pullQueries, warmPullDiff } from "../../../../queries/pulls";
import { warm } from "../../../../queries/warm";
import { PullScreen } from "../../../../screens/PullScreen";

const TABS: PullTab[] = ["conversation", "files", "commits", "checks"];

export const Route = createFileRoute("/$owner/$repo/pull/$number")({
  params: {
    parse: (raw) => {
      const number = intParam(raw.number);
      return number === false ? false : { ...raw, number };
    },
    stringify: (params) => ({ ...params, number: String(params.number) }),
  },
  validateSearch: (search: Record<string, unknown>): { tab?: PullTab } => ({ tab: oneOf(search.tab, TABS) }),
  loader: ({ context: { queryClient }, params: { owner, repo, number }, preload }) => {
    warmPullDiff(queryClient, owner, repo, number, preload);
    return warm(queryClient, [pullQueries.detail(owner, repo, number), pullQueries.timeline(owner, repo, number)], {
      secondary: [
        pullQueries.threads(owner, repo, number),
        pullQueries.checks(owner, repo, number),
        pullQueries.commits(owner, repo, number),
        pullQueries.viewed(owner, repo, number),
      ],
      preload,
    });
  },
  component: PullScreen,
});
