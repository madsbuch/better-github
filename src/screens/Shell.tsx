import { PeopleIcon, RepoIcon } from "@primer/octicons-react";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useLocation, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { to, useNav } from "../lib/nav";
import { useSessionApi } from "../lib/session";
import { warmStartup } from "../queries/warm";
import { Avatar, ErrorView, SkeletonList } from "../components/ui";

type TabId = "repos" | "profile";

const TABS: { id: TabId; label: string; path: string; target: ReturnType<(typeof to)[TabId]> }[] = [
  { id: "repos", label: "Repos", path: "/repos", target: to.repos() },
  { id: "profile", label: "You", path: "/profile", target: to.profile() },
];

/** One routed screen, with bottom tabs on phones and persistent navigation on tablets. */
export function Shell() {
  const queryClient = useQueryClient();
  const pathname = useLocation({ select: (l) => l.pathname });
  const index = useLocation({ select: (l) => l.state.__TSR_index });
  const screen = useRef<HTMLElement>(null);
  const previous = useRef({ pathname, index });
  const tab = TABS.find((t) => t.path === pathname)?.id;

  useEffect(() => warmStartup(queryClient), [queryClient]);

  // Slide new screens in when going forward; going back just shows the previous one.
  useEffect(() => {
    const before = previous.current;
    previous.current = { pathname, index };
    if (pathname !== before.pathname && index > before.index && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      screen.current?.animate(
        [
          { transform: "translateX(24px)", opacity: 0.4 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
  }, [pathname, index]);

  return (
    <div className="app app-shell">
      <ProgressBar />
      <TabBar current={tab} rail />
      <div className="stack">
        <section className="screen" ref={screen}>
          <Outlet />
        </section>
      </div>
      {tab !== undefined && <TabBar current={tab} />}
    </div>
  );
}

/** A thin bar while a navigation waits for data (rare: loaders resolve within ~250 ms). */
function ProgressBar() {
  const loading = useRouterState({ select: (s) => s.isLoading });
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!loading) return setVisible(false);
    const timer = window.setTimeout(() => setVisible(true), 120);
    return () => window.clearTimeout(timer);
  }, [loading]);
  return <div className={`nav-progress${visible ? " active" : ""}`} aria-hidden />;
}

function TabBar({ current, rail = false }: { current?: TabId | undefined; rail?: boolean | undefined }) {
  const { state } = useSessionApi();
  const nav = useNav();

  return (
    <nav className={`main-nav ${rail ? "nav-rail" : "tabbar"}`} aria-label="Main">
      {rail && <img className="nav-logo" src="/icon.svg" alt="Better GitHub" />}
      {TABS.map((tab) => {
        const active = tab.id === current;
        let icon: ReactNode;
        if (tab.id === "repos") icon = <RepoIcon size={20} />;
        else if (state.status === "signed-in") icon = <Avatar src={state.session.avatarUrl} size={22} />;
        else icon = <PeopleIcon size={20} />;
        // Guests have no account; their second tab lists the profiles they follow.
        const label = tab.id === "profile" && state.status !== "signed-in" ? "Profiles" : tab.label;
        return (
          <button
            key={tab.id}
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              if (active) window.dispatchEvent(new CustomEvent("ghc:scroll-top"));
              else nav.resetTo(tab.target);
            }}
          >
            <span className="tab-icon">
              {icon}
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}

/** Shown when a screen crashes or its route fails. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const nav = useNav();
  return (
    <div className="content">
      <ErrorView error={error} onRetry={reset} />
      <div className="center" style={{ paddingTop: 0 }}>
        <button className="btn btn-ghost" onClick={nav.back}>
          Go back
        </button>
      </div>
    </div>
  );
}

/** Placeholder while a screen's data is still on its way after the loader stopped waiting. */
export function ScreenPending() {
  return (
    <>
      <header className="appbar" />
      <div className="content">
        <SkeletonList />
      </div>
    </>
  );
}
