import { ArrowLeftIcon, SyncIcon } from "@primer/octicons-react";
import { useCanGoBack } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNav } from "../lib/nav";

interface ScreenProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Shown between the app bar and the scrolling content (tabs, filters). */
  header?: ReactNode;
  /** Pinned below the content (action bars, composers). */
  footer?: ReactNode;
  onRefresh?: () => Promise<unknown>;
  /** Set false when the child manages its own scrolling. */
  scroll?: boolean;
  children: ReactNode;
  contentRef?: React.RefObject<HTMLDivElement | null>;
}

const THRESHOLD = 64;
const MAX_PULL = 96;

export function Screen({ title, subtitle, actions, header, footer, onRefresh, scroll = true, children, contentRef }: ScreenProps) {
  const canGoBack = useCanGoBack();
  const nav = useNav();
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = contentRef ?? ownRef;
  const indicator = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  usePullToRefresh(ref, indicator, refreshRef, refreshing, setRefreshing);

  // Tapping the current bottom tab again scrolls back to the top.
  useEffect(() => {
    const handler = () => ref.current?.scrollTo({ top: 0, behavior: "smooth" });
    window.addEventListener("ghc:scroll-top", handler);
    return () => window.removeEventListener("ghc:scroll-top", handler);
  }, [ref]);

  return (
    <>
      <header className="appbar">
        {canGoBack && (
          <button className="icon-btn" onClick={nav.back} aria-label="Back">
            <ArrowLeftIcon size={20} />
          </button>
        )}
        <div className="appbar-title" style={canGoBack ? undefined : { paddingLeft: 12 }}>
          <h1>{title}</h1>
          {subtitle && <div className="appbar-sub">{subtitle}</div>}
        </div>
        {actions && <div className="appbar-actions">{actions}</div>}
      </header>
      {header}
      {/* The router restores this element's scroll position on back (see router.tsx). */}
      <div className={`content${scroll ? "" : " no-scroll"}`} ref={ref} data-scroll-restoration-id="screen">
        {onRefresh && (
          <div className="ptr" ref={indicator} style={{ opacity: 0, transform: "translateY(-48px)" }} aria-hidden>
            <SyncIcon size={18} className={refreshing ? "spin" : undefined} />
          </div>
        )}
        {children}
      </div>
      {footer}
    </>
  );
}

function usePullToRefresh(
  scroller: React.RefObject<HTMLDivElement | null>,
  indicator: React.RefObject<HTMLDivElement | null>,
  onRefresh: React.RefObject<(() => Promise<unknown>) | undefined>,
  refreshing: boolean,
  setRefreshing: (value: boolean) => void,
) {
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let startY: number | null = null;
    let pull = 0;

    const paint = (distance: number, animate: boolean) => {
      const node = indicator.current;
      if (!node) return;
      node.style.transition = animate ? "transform 180ms ease, opacity 180ms ease" : "none";
      node.style.opacity = String(Math.min(1, distance / THRESHOLD));
      node.style.transform = `translateY(${distance - 40}px) rotate(${distance * 4}deg)`;
    };

    const onStart = (e: TouchEvent) => {
      if (!onRefresh.current || refreshingRef.current || el.scrollTop > 0 || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      pull = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (pull > 0) paint(0, false);
        pull = 0;
        return;
      }
      pull = Math.min(MAX_PULL, dy * 0.5);
      paint(pull, false);
    };
    const onEnd = async () => {
      if (startY === null) return;
      startY = null;
      if (pull >= THRESHOLD && onRefresh.current) {
        setRefreshing(true);
        paint(THRESHOLD, true);
        try {
          await onRefresh.current();
        } finally {
          setRefreshing(false);
          paint(0, true);
        }
      } else {
        paint(0, true);
      }
      pull = 0;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scroller, indicator, onRefresh, setRefreshing]);
}
