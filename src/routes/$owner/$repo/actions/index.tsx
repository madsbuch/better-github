import { createFileRoute, redirect } from "@tanstack/react-router";

// github.com/<owner>/<repo>/actions is the repository's Actions tab here.
export const Route = createFileRoute("/$owner/$repo/actions/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$owner/$repo", params, search: { tab: "actions" }, replace: true });
  },
});
