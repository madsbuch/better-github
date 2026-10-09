import { createFileRoute } from "@tanstack/react-router";
import { intParam } from "../../../../lib/search-params";
import { issueQueries } from "../../../../queries/issues";
import { warm } from "../../../../queries/warm";
import { IssueScreen } from "../../../../screens/IssueScreen";

export const Route = createFileRoute("/$owner/$repo/issues/$number")({
  params: {
    parse: (raw) => {
      const number = intParam(raw.number);
      return number === false ? false : { ...raw, number };
    },
    stringify: (params) => ({ ...params, number: String(params.number) }),
  },
  loader: ({ context: { queryClient }, params: { owner, repo, number }, preload }) =>
    warm(queryClient, [issueQueries.detail(owner, repo, number)], { preload }),
  component: IssueScreen,
});
