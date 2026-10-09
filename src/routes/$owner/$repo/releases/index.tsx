import { createFileRoute, redirect } from "@tanstack/react-router";

// github.com/<owner>/<repo>/releases is the repository's Releases tab here.
export const Route = createFileRoute("/$owner/$repo/releases/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$owner/$repo", params, search: { tab: "releases" }, replace: true });
  },
});
