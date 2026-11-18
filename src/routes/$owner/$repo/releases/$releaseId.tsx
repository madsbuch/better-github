import { createFileRoute } from "@tanstack/react-router";
import { intParam } from "../../../../lib/search-params";
import { releaseQueries } from "../../../../queries/releases";
import { query, warm } from "../../../../queries/warm";
import { ReleaseScreen } from "../../../../screens/releases/ReleaseScreen";

// A release by id, as notifications link to them.
export const Route = createFileRoute("/$owner/$repo/releases/$releaseId")({
  params: {
    parse: (raw) => {
      const releaseId = intParam(raw.releaseId);
      return releaseId === false ? false : { ...raw, releaseId };
    },
    stringify: (params) => ({ ...params, releaseId: String(params.releaseId) }),
  },
  loader: ({ context: { queryClient }, params: { owner, repo, releaseId }, preload }) =>
    warm(queryClient, [query(releaseQueries.one(owner, repo, { id: releaseId }))], { preload }),
  component: function ReleaseById() {
    const { owner, repo, releaseId } = Route.useParams();
    return <ReleaseScreen owner={owner} repo={repo} lookup={{ id: releaseId }} />;
  },
});
