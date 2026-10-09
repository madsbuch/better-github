import { createFileRoute } from "@tanstack/react-router";
import { releaseQueries } from "../../../../../queries/releases";
import { warm } from "../../../../../queries/warm";
import { ReleaseScreen } from "../../../../../screens/releases/ReleaseScreen";

// Like github.com/<owner>/<repo>/releases/tag/<tag>.
export const Route = createFileRoute("/$owner/$repo/releases/tag/$tag")({
  loader: ({ context: { queryClient }, params: { owner, repo, tag }, preload }) =>
    warm(queryClient, [releaseQueries.one(owner, repo, { tag })], { preload }),
  component: function ReleaseByTag() {
    const { owner, repo, tag } = Route.useParams();
    return <ReleaseScreen owner={owner} repo={repo} lookup={{ tag }} />;
  },
});
