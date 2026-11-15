// Navigation on top of TanStack Router (file-based routes in src/routes).
//
// Links: build them with `to.*` (or TanStack's <Link to=...> directly). Both
// are type-checked against the generated route tree, so a link to a screen
// that doesn't exist, or with missing params, fails `npm run typecheck`.
//
// Sheets: every open sheet adds a history entry (`?o=<depth>`), so the
// Android back button, which Tauri maps to WebView history, closes sheets
// before it leaves a screen. Navigating from inside a sheet first unwinds
// the sheets' entries, so back afterwards returns to the screen, not to a
// sheet that is no longer open.

import { linkOptions, useRouter, type RegisteredRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import type { InboxFilter } from "../queries/keys";

export type PullTab = "conversation" | "files" | "commits" | "checks";
export type RepoTab = "about" | "code" | "pulls" | "issues" | "commits" | "actions" | "releases";
export type SearchType = "repos" | "pulls" | "issues" | "users";
export type NotificationsFilter = "participating" | "all";
/** Run filters in the Actions tab: GitHub's `status` values we offer. */
export type RunStatusFilter = "in_progress" | "failure";

/** The "open a pull request" screen: `head` from `from` ("owner/name", default: this repository) into `base`. */
export interface CompareSearch {
  base?: string;
  head?: string;
  from?: string;
  tab?: "commits" | "files";
}

export interface RepoSearch {
  tab?: RepoTab;
  ref?: string;
  /** Actions tab: a workflow's id. */
  workflow?: number;
  status?: RunStatusFilter;
}

// ------------------------------------------------------------------ links

export const to = {
  inbox: (filter?: InboxFilter) => linkOptions({ to: "/pulls", search: { filter: filter === "review" ? undefined : filter } }),
  notifications: (filter?: NotificationsFilter) => linkOptions({ to: "/notifications", search: { filter } }),
  repos: (tab?: "starred") => linkOptions({ to: "/repos", search: { tab } }),
  profile: () => linkOptions({ to: "/profile" }),
  settings: () => linkOptions({ to: "/settings" }),
  search: (q?: string, type?: SearchType) => linkOptions({ to: "/search", search: { q: q || undefined, type } }),
  user: (login: string) => linkOptions({ to: "/$owner", params: { owner: login } }),
  repo: (owner: string, repo: string, search: RepoSearch = {}) =>
    linkOptions({ to: "/$owner/$repo", params: { owner, repo }, search: { ...search, tab: search.tab === "about" ? undefined : search.tab } }),
  tree: (owner: string, repo: string, ref?: string, path?: string) =>
    linkOptions({ to: "/$owner/$repo/tree", params: { owner, repo }, search: { ref, path: path || undefined } }),
  blob: (owner: string, repo: string, ref: string | undefined, path: string) =>
    linkOptions({ to: "/$owner/$repo/blob", params: { owner, repo }, search: { ref, path } }),
  pull: (owner: string, repo: string, number: number, tab?: PullTab) =>
    linkOptions({
      to: "/$owner/$repo/pull/$number",
      params: { owner, repo, number },
      search: { tab: tab === "conversation" ? undefined : tab },
    }),
  compare: (owner: string, repo: string, search: CompareSearch = {}) =>
    linkOptions({ to: "/$owner/$repo/compare", params: { owner, repo }, search }),
  issue: (owner: string, repo: string, number: number) => linkOptions({ to: "/$owner/$repo/issues/$number", params: { owner, repo, number } }),
  commit: (owner: string, repo: string, sha: string) => linkOptions({ to: "/$owner/$repo/commit/$sha", params: { owner, repo, sha } }),
  release: (owner: string, repo: string, tag: string) =>
    linkOptions({ to: "/$owner/$repo/releases/tag/$tag", params: { owner, repo, tag } }),
  latestRelease: (owner: string, repo: string) => linkOptions({ to: "/$owner/$repo/releases/latest", params: { owner, repo } }),
  releaseById: (owner: string, repo: string, releaseId: number) =>
    linkOptions({ to: "/$owner/$repo/releases/$releaseId", params: { owner, repo, releaseId } }),
  run: (owner: string, repo: string, runId: number) => linkOptions({ to: "/$owner/$repo/actions/runs/$runId", params: { owner, repo, runId } }),
  job: (owner: string, repo: string, runId: number, jobId: number) =>
    linkOptions({ to: "/$owner/$repo/actions/runs/$runId/job/$jobId", params: { owner, repo, runId, jobId } }),
};

/** Splits "owner/name" into its parts. */
export function splitRepo(nameWithOwner: string): [string, string] {
  const index = nameWithOwner.indexOf("/");
  return [nameWithOwner.slice(0, index), nameWithOwner.slice(index + 1)];
}

/** Anything `to.*` returns; also what github.com URLs map to (lib/links.ts). */
export type LinkTarget = ReturnType<(typeof to)[keyof typeof to]>;

// ---------------------------------------------------------------- history

/** A `to.*` target, optionally replacing the current history entry. */
type NavigateTarget = LinkTarget & { replace?: boolean };

interface Overlay {
  id: number;
  depth: number;
  close: () => void;
}

/** Per-router bookkeeping for sheets and the history traversals we start. */
class Controller {
  private overlays: Overlay[] = [];
  /** Sheets opened while a traversal was pending; their entry isn't pushed yet. */
  private pendingOpens = new Set<number>();
  private nextId = 1;
  /** Traversals we started ourselves and whose popstate we still await. */
  private pendingPops = 0;
  private queue: (() => void)[] = [];

  constructor(private router: RegisteredRouter) {
    router.history.subscribe(({ action }) => {
      if (action.type !== "BACK" && action.type !== "GO" && action.type !== "FORWARD") {
        this.pruneOverlays();
        return;
      }
      if (this.pendingPops > 0) {
        this.pendingPops--;
        if (this.pendingPops === 0) {
          const queued = this.queue;
          this.queue = [];
          queued.forEach((fn) => fn());
        }
        return;
      }
      // Back (or forward) pressed: close the sheets above the entry we landed on.
      this.pruneOverlays();
    });
  }

  /** The `o` of the current history entry: how many sheets it has open. */
  private depth(): number {
    const raw = new URLSearchParams(this.router.history.location.search).get("o");
    const depth = Number(raw);
    return Number.isInteger(depth) && depth > 0 ? depth : 0;
  }

  private pruneOverlays() {
    const depth = this.depth();
    while (this.overlays.length && this.overlays[this.overlays.length - 1].depth > depth) this.overlays.pop()!.close();
  }

  private pop(steps: number) {
    this.pendingPops++;
    this.router.history.go(-steps);
  }

  /** Runs `fn` now, or once the history traversals we started have landed. */
  whenSettled(fn: () => void) {
    if (this.pendingPops > 0) this.queue.push(fn);
    else fn();
  }

  /** Closes every open sheet, unwinding their history entries. Returns false if none were open. */
  private dropOverlays(): boolean {
    const depth = this.depth();
    if (this.overlays.length === 0 && depth === 0) return false;
    const closing = this.overlays;
    this.overlays = [];
    closing.forEach((o) => o.close());
    if (depth === 0) return false;
    this.pop(depth);
    return true;
  }

  navigate(options: NavigateTarget) {
    this.whenSettled(() => {
      if (this.dropOverlays()) this.queue.push(() => this.navigate(options));
      else void this.router.navigate(withoutOverlay(options) as never);
    });
  }

  back() {
    this.whenSettled(() => {
      if (this.router.history.canGoBack()) this.router.history.back();
    });
  }

  /** Jumps to a root screen (bottom tab), unwinding the whole history. */
  resetTo(options: NavigateTarget) {
    this.whenSettled(() => {
      const closing = this.overlays;
      this.overlays = [];
      closing.forEach((o) => o.close());
      const index = Number(this.router.history.location.state.__TSR_index ?? 0);
      if (index > 0) {
        this.queue.push(() => void this.router.navigate({ ...options, replace: true } as never));
        this.pop(index);
      } else {
        void this.router.navigate({ ...options, replace: true } as never);
      }
    });
  }

  openOverlay(close: () => void): number {
    const id = this.nextId++;
    this.pendingOpens.add(id);
    this.whenSettled(() => {
      // Closed again before its turn came.
      if (!this.pendingOpens.delete(id)) return;
      const depth = this.depth() + 1;
      this.overlays.push({ id, depth, close });
      void this.router.navigate({ to: ".", search: (prev: object) => ({ ...prev, o: depth }), resetScroll: false } as never);
    });
    return id;
  }

  /** Closes a sheet from the UI; a no-op when back (or a navigation) already closed it. */
  closeOverlay(id: number) {
    if (this.pendingOpens.delete(id)) return;
    const index = this.overlays.findIndex((o) => o.id === id);
    if (index === -1) return;
    const removed = this.overlays.slice(index);
    this.overlays = this.overlays.slice(0, index);
    removed.slice(1).forEach((o) => o.close());
    // Only unwind entries that are still the current ones: after a link inside
    // the sheet navigated away, the sheet's entry is history, not on screen.
    const steps = this.depth() - removed[0].depth + 1;
    if (steps > 0) this.pop(steps);
  }
}

/**
 * A target built from the current search (`{ ...search, ref }`) may carry the
 * open sheet's `o`; a new screen or tab never starts with a sheet open.
 */
function withoutOverlay(options: NavigateTarget): NavigateTarget {
  const search = (options as { search?: unknown }).search;
  if (!search || typeof search !== "object" || !("o" in search)) return options;
  const { o: _sheet, ...rest } = search;
  return { ...options, search: rest } as NavigateTarget;
}

const controllers = new WeakMap<RegisteredRouter, Controller>();

function controllerFor(router: RegisteredRouter): Controller {
  let controller = controllers.get(router);
  if (!controller) {
    controller = new Controller(router);
    controllers.set(router, controller);
  }
  return controller;
}

/**
 * Navigation that cooperates with open sheets. Prefer it over TanStack's
 * `useNavigate` for anything triggered from a sheet or menu.
 */
export function useNav() {
  const router = useRouter();
  return useMemo(() => {
    const controller = controllerFor(router);
    return {
      navigate: (target: LinkTarget) => controller.navigate(target),
      /** Swaps the current screen's URL without adding history (tabs, filters). */
      replace: (target: LinkTarget) => controller.navigate({ ...target, replace: true }),
      back: () => controller.back(),
      resetTo: (target: LinkTarget) => controller.resetTo(target),
    };
  }, [router]);
}

/** Registers a modal surface with the back button while `open` is true. */
export function useOverlay(open: boolean, onClose: () => void) {
  const router = useRouter();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const controller = controllerFor(router);
    const id = controller.openOverlay(() => closeRef.current());
    return () => controller.closeOverlay(id);
  }, [open, router]);
}
