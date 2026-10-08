// A small stack navigator on top of the History API.
//
// Every screen push is a history entry, so the Android back button (which
// Tauri maps to WebView history) pops screens, and earlier screens stay
// mounted underneath with their scroll position and state intact. Bottom
// sheets register as "overlays": opening one adds a history entry, so back
// closes the sheet before it leaves the screen.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { matchPath, type RouteMatch } from "./routes";

export interface StackEntry {
  key: number;
  path: string;
}

interface EntryState {
  ghc: 1;
  depth: number;
  key: number;
  path: string;
  overlays: number;
}

interface Overlay {
  id: number;
  close: () => void;
}

function hashPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/") ? hash : "/";
}

function readState(state: unknown): EntryState | null {
  return state && typeof state === "object" && (state as EntryState).ghc === 1 ? (state as EntryState) : null;
}

class Navigator {
  private stack: StackEntry[];
  private overlays: Overlay[] = [];
  private nextKey = 1;
  private nextOverlayId = 1;
  /** History traversals we started ourselves and whose popstate we await. */
  private expectedPops = 0;
  private queue: (() => void)[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    const path = hashPath();
    this.stack = [{ key: 0, path }];
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    history.replaceState(this.entryState(0, 0, path, 0), "", `#${path}`);
    window.addEventListener("popstate", (event) => this.onPopState(event.state));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getStack = () => this.stack;

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private entryState(depth: number, key: number, path: string, overlays: number): EntryState {
    return { ghc: 1, depth, key, path, overlays };
  }

  private get top(): StackEntry {
    return this.stack[this.stack.length - 1];
  }

  /** Runs `action` now, or after our pending history traversal lands. */
  private whenSettled(action: () => void) {
    if (this.expectedPops > 0) this.queue.push(action);
    else action();
  }

  /** Closes every open overlay (sheets) before a navigation. */
  private dropOverlays(): boolean {
    if (this.overlays.length === 0) return false;
    const closing = this.overlays;
    this.overlays = [];
    closing.forEach((o) => o.close());
    this.expectedPops++;
    history.go(-closing.length);
    return true;
  }

  navigate = (path: string) => {
    this.whenSettled(() => {
      if (this.dropOverlays()) {
        this.queue.push(() => this.navigate(path));
        return;
      }
      if (path === this.top.path) return;
      const key = this.nextKey++;
      const depth = this.stack.length;
      history.pushState(this.entryState(depth, key, path, 0), "", `#${path}`);
      this.stack = [...this.stack, { key, path }];
      this.emit();
    });
  };

  /** Swaps the current screen's path without adding history (e.g. tab changes). */
  replace = (path: string, remount = false) => {
    this.whenSettled(() => {
      const top = this.top;
      const key = remount ? this.nextKey++ : top.key;
      history.replaceState(this.entryState(this.stack.length - 1, key, path, this.overlays.length), "", `#${path}`);
      this.stack = [...this.stack.slice(0, -1), { key, path }];
      this.emit();
    });
  };

  back = () => {
    this.whenSettled(() => {
      if (this.stack.length > 1 || this.overlays.length > 0) history.back();
    });
  };

  /** Jumps to a root screen (bottom tab), unwinding the whole stack. */
  resetTo = (path: string) => {
    this.whenSettled(() => {
      const steps = this.stack.length - 1 + this.overlays.length;
      const overlays = this.overlays;
      this.overlays = [];
      overlays.forEach((o) => o.close());
      if (steps > 0) {
        this.expectedPops++;
        this.queue.push(() => this.replace(path, true));
        history.go(-steps);
      } else if (this.top.path !== path) {
        this.replace(path, true);
      }
    });
  };

  openOverlay = (close: () => void): number => {
    const id = this.nextOverlayId++;
    this.overlays.push({ id, close });
    const top = this.top;
    history.pushState(
      this.entryState(this.stack.length - 1, top.key, top.path, this.overlays.length),
      "",
      `#${top.path}`,
    );
    return id;
  };

  /** Closes an overlay from the UI; a no-op when back already closed it. */
  closeOverlay = (id: number) => {
    const index = this.overlays.findIndex((o) => o.id === id);
    if (index === -1) return;
    const removed = this.overlays.length - index;
    this.overlays = this.overlays.slice(0, index);
    this.expectedPops++;
    history.go(-removed);
  };

  private onPopState(raw: unknown) {
    const state = readState(raw);

    if (this.expectedPops > 0) {
      this.expectedPops--;
      if (state) this.syncStack(state);
      if (this.expectedPops === 0) {
        const queued = this.queue;
        this.queue = [];
        queued.forEach((action) => action());
      }
      return;
    }

    if (!state) {
      // The hash was changed by hand (or by a plain link): treat as a push.
      const path = hashPath();
      const key = this.nextKey++;
      history.replaceState(this.entryState(this.stack.length, key, path, 0), "", `#${path}`);
      this.stack = [...this.stack, { key, path }];
      this.emit();
      return;
    }

    // Back (or forward) pressed: close overlays above the target entry first.
    while (this.overlays.length > state.overlays) {
      this.overlays.pop()!.close();
    }
    this.syncStack(state);
  }

  private syncStack(state: EntryState) {
    const depth = Math.min(state.depth, this.stack.length);
    const stack = this.stack.slice(0, depth + 1);
    const at = stack[depth];
    if (!at || at.key !== state.key || at.path !== state.path) {
      stack[depth] = { key: state.key, path: state.path };
      this.nextKey = Math.max(this.nextKey, state.key + 1);
    }
    if (stack.length !== this.stack.length || stack.some((e, i) => e !== this.stack[i])) {
      this.stack = stack;
      this.emit();
    }
  }
}

let instance: Navigator | null = null;
function getNavigator(): Navigator {
  instance ??= new Navigator();
  return instance;
}

export const nav = {
  navigate: (path: string) => getNavigator().navigate(path),
  replace: (path: string) => getNavigator().replace(path),
  back: () => getNavigator().back(),
  resetTo: (path: string) => getNavigator().resetTo(path),
};

export function useStack(): StackEntry[] {
  const navigator = getNavigator();
  return useSyncExternalStore(navigator.subscribe, navigator.getStack);
}

/** Registers a modal surface with the back button while `open` is true. */
export function useOverlay(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const navigator = getNavigator();
    const id = navigator.openOverlay(() => closeRef.current());
    return () => navigator.closeOverlay(id);
  }, [open]);
}

// ---------------------------------------------------------------------------
// Per-screen context

export interface ScreenInfo {
  path: string;
  route: RouteMatch;
  active: boolean;
  depth: number;
}

const ScreenContext = createContext<ScreenInfo | null>(null);

export function ScreenProvider({ value, children }: { value: ScreenInfo; children: ReactNode }) {
  return <ScreenContext.Provider value={value}>{children}</ScreenContext.Provider>;
}

export function useScreen(): ScreenInfo {
  const screen = useContext(ScreenContext);
  if (!screen) throw new Error("useScreen must be used inside a screen");
  return screen;
}

export function routeFor(path: string): RouteMatch {
  return matchPath(path);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    nav.navigate(to);
  };
  return (
    <a href={`#${to}`} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
