import { createFileRoute } from "@tanstack/react-router";
import type { SearchType } from "../lib/nav";
import { oneOf, optionalString } from "../lib/search-params";
import { searchQueries } from "../queries/search";
import { warm } from "../queries/warm";
import { SearchScreen } from "../screens/SearchScreen";

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): { q?: string; type?: SearchType } => ({
    q: optionalString(search.q),
    type: oneOf(search.type, ["repos", "pulls", "issues", "users"] as const),
  }),
  loaderDeps: ({ search }) => ({ q: search.q, type: search.type ?? "repos" }),
  loader: ({ context: { queryClient }, deps: { q, type }, preload }) => {
    if (!q) return;
    const results =
      type === "repos"
        ? searchQueries.repos(q)
        : type === "users"
          ? searchQueries.users(q)
          : searchQueries.issues(`${q} ${type === "pulls" ? "is:pr" : "is:issue"}`);
    return warm(queryClient, [results], { preload });
  },
  component: SearchScreen,
});
