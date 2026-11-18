import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import { optionalInt } from "../lib/search-params";
import { Shell } from "../screens/Shell";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // `o` counts the sheets open on a screen (see lib/nav.tsx); every route accepts it.
  validateSearch: (search: Record<string, unknown>): { o?: number | undefined } => ({ o: optionalInt(search.o) }),
  component: Shell,
});
