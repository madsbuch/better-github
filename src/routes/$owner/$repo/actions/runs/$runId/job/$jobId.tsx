import { createFileRoute } from "@tanstack/react-router";
import { intParam } from "../../../../../../../lib/search-params";
import { actionsQueries } from "../../../../../../../queries/actions";
import { query, warm } from "../../../../../../../queries/warm";
import { JobScreen } from "../../../../../../../screens/actions/JobScreen";

export const Route = createFileRoute("/$owner/$repo/actions/runs/$runId/job/$jobId")({
  params: {
    parse: (raw) => {
      const runId = intParam(raw.runId);
      const jobId = intParam(raw.jobId);
      return runId === false || jobId === false ? false : { ...raw, runId, jobId };
    },
    stringify: (params) => ({ ...params, runId: String(params.runId), jobId: String(params.jobId) }),
  },
  loader: ({ context: { queryClient }, params: { owner, repo, jobId }, preload }) =>
    warm(queryClient, [query(actionsQueries.job(owner, repo, jobId))], { secondary: [query(actionsQueries.annotations(owner, repo, jobId))], preload }),
  component: JobScreen,
});
