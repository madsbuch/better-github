import { createFileRoute } from "@tanstack/react-router";
import { intParam } from "../../../../../../lib/search-params";
import { actionsQueries } from "../../../../../../queries/actions";
import { warm } from "../../../../../../queries/warm";
import { RunScreen } from "../../../../../../screens/actions/RunScreen";

export const Route = createFileRoute("/$owner/$repo/actions/runs/$runId/")({
  params: {
    parse: (raw) => {
      const runId = intParam(raw.runId);
      return runId === false ? false : { ...raw, runId };
    },
    stringify: (params) => ({ ...params, runId: String(params.runId) }),
  },
  loader: ({ context: { queryClient }, params: { owner, repo, runId }, preload }) =>
    warm(queryClient, [actionsQueries.run(owner, repo, runId), actionsQueries.runJobs(owner, repo, runId)], { preload }),
  component: RunScreen,
});
