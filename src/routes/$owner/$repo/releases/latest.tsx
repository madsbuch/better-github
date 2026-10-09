import { createFileRoute } from "@tanstack/react-router";
import { releaseQueries } from "../../../../queries/releases";
import { warm } from "../../../../queries/warm";
import { ReleaseScreen } from "../../../../screens/releases/ReleaseScreen";

// Like github.com/<owner>/<repo>/releases/latest.
export const Route = createFileRoute("/$owner/$repo/releases/latest")({
  loader: ({ context: { queryClient }, params: { owner, repo }, preload }) =>
    warm(queryClient, [releaseQueries.one(owner, repo, "latest")], { preload }),
  component: function LatestRelease() {
    const { owner, repo } = Route.useParams();
    return <ReleaseScreen owner={owner} repo={repo} lookup="latest" />;
  },
});
