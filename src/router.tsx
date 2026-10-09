import { createBrowserHistory, createRouter, type HistoryLocation } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./queries/client";
import { NotFoundScreen } from "./screens/NotFoundScreen";
import { RouteError, ScreenPending } from "./screens/Shell";

/**
 * Hash URLs (`index.html#/owner/repo`) work from Tauri's asset server and
 * `vite preview` alike. Unlike TanStack's `createHashHistory`, the location
 * comes from the hash alone: a query string on the page itself (the dev
 * mock's `?signedOut`, the e2e tests' `?load=N`) must not leak into routes.
 */
function createAppHistory() {
  return createBrowserHistory({
    parseLocation: () => {
      const [path, ...fragment] = window.location.hash.slice(1).split("#");
      return parseLocation(`${path || "/"}${fragment.length ? `#${fragment.join("#")}` : ""}`, window.history.state);
    },
    createHref: (href) => `${window.location.pathname}${window.location.search}#${href}`,
  });
}

function parseLocation(href: string, state: HistoryLocation["state"] | null): HistoryLocation {
  const hashIndex = href.indexOf("#");
  const searchIndex = href.indexOf("?");
  const pathEnd = Math.min(...[hashIndex, searchIndex, href.length].filter((i) => i >= 0));
  const key = Math.random().toString(36).slice(2, 10);
  return {
    href,
    pathname: href.slice(0, pathEnd),
    search: searchIndex >= 0 && (hashIndex < 0 || searchIndex < hashIndex) ? href.slice(searchIndex, hashIndex < 0 ? undefined : hashIndex) : "",
    hash: hashIndex >= 0 ? href.slice(hashIndex) : "",
    state: state ?? { __TSR_index: 0, key, __TSR_key: key },
  };
}

export const router = createRouter({
  routeTree,
  history: createAppHistory(),
  context: { queryClient },
  // Preload a screen's data as soon as a link is touched; list rows also
  // preload when they scroll into view (`preload="viewport"`).
  defaultPreload: "intent",
  defaultPreloadDelay: 0,
  // TanStack Query decides what is fresh, so always ask it.
  defaultPreloadStaleTime: 0,
  // Loaders resolve within ~250 ms (see queries/warm.ts); this is a fallback.
  defaultPendingMs: 600,
  defaultPendingComponent: ScreenPending,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFoundScreen,
  // Screens scroll inside `.content`; back restores its position, new screens start at the top.
  scrollRestoration: true,
  scrollToTopSelectors: ['[data-scroll-restoration-id="screen"]'],
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
