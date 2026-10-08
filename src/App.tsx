import { BellIcon, GitPullRequestIcon, RepoIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { Component, useMemo, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { rest } from "./lib/api";
import { nav, ScreenProvider, useStack, type StackEntry } from "./lib/router";
import { matchPath, paths, type RouteName, type TabRoute } from "./lib/routes";
import { useSessionApi, useViewer } from "./lib/session";
import type { RestNotification } from "./lib/types";
import { Avatar, CenterSpinner, ErrorView } from "./components/ui";
import { LoginScreen } from "./screens/LoginScreen";
import { InboxScreen } from "./screens/InboxScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { ReposScreen } from "./screens/ReposScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { UserScreen } from "./screens/UserScreen";
import { RepoScreen } from "./screens/RepoScreen";
import { TreeScreen } from "./screens/TreeScreen";
import { BlobScreen } from "./screens/BlobScreen";
import { PullScreen } from "./screens/PullScreen";
import { IssueScreen } from "./screens/IssueScreen";
import { CommitScreen } from "./screens/CommitScreen";
import { NotFoundScreen } from "./screens/NotFoundScreen";

const SCREENS: Record<RouteName, ComponentType> = {
  inbox: InboxScreen,
  notifications: NotificationsScreen,
  repos: ReposScreen,
  profile: ProfileScreen,
  settings: SettingsScreen,
  search: SearchScreen,
  user: UserScreen,
  repo: RepoScreen,
  tree: TreeScreen,
  blob: BlobScreen,
  pull: PullScreen,
  issue: IssueScreen,
  commit: CommitScreen,
  notFound: NotFoundScreen,
};

/** Screens further than this below the top are unmounted to save memory. */
const KEEP_MOUNTED = 8;

export function App() {
  const { state } = useSessionApi();
  if (state.status === "loading") {
    return (
      <div className="app">
        <CenterSpinner />
      </div>
    );
  }
  if (state.status === "signed-out") {
    return (
      <div className="app">
        <div className="content">
          <LoginScreen />
        </div>
      </div>
    );
  }
  return <Shell />;
}

function Shell() {
  const stack = useStack();
  const topIndex = stack.length - 1;
  const topRoute = matchPath(stack[topIndex].path).name;
  const showTabs = topIndex === 0 && (["inbox", "notifications", "repos", "profile"] as RouteName[]).includes(topRoute);

  return (
    <div className="app">
      <div className="stack">
        {stack.map((entry, index) =>
          topIndex - index > KEEP_MOUNTED && index !== 0 ? null : (
            <ScreenHost key={entry.key} entry={entry} depth={index} active={index === topIndex} />
          ),
        )}
      </div>
      {showTabs && <TabBar current={topRoute as TabRoute} />}
    </div>
  );
}

function ScreenHost({ entry, depth, active }: { entry: StackEntry; depth: number; active: boolean }) {
  const route = useMemo(() => matchPath(entry.path), [entry.path]);
  const info = useMemo(() => ({ path: entry.path, route, active, depth }), [entry.path, route, active, depth]);
  const Screen = SCREENS[route.name];
  return (
    <section className={`screen${active ? "" : " hidden"}${depth > 0 ? " enter" : ""}`} aria-hidden={!active} inert={!active}>
      <ScreenProvider value={info}>
        <ScreenErrorBoundary>
          <Screen />
        </ScreenErrorBoundary>
      </ScreenProvider>
    </section>
  );
}

const TABS: { route: TabRoute; label: string; path: string }[] = [
  { route: "inbox", label: "Pull requests", path: paths.inbox() },
  { route: "notifications", label: "Inbox", path: paths.notifications() },
  { route: "repos", label: "Repos", path: paths.repos() },
  { route: "profile", label: "You", path: paths.profile() },
];

function TabBar({ current }: { current: TabRoute }) {
  const viewer = useViewer();
  const unread = useQuery({
    queryKey: ["notifications", "has-unread"],
    queryFn: async () => (await rest<RestNotification[]>("/notifications", { query: { per_page: 1 } })).length > 0,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => {
        const active = tab.route === current;
        let icon: ReactNode;
        if (tab.route === "inbox") icon = <GitPullRequestIcon size={20} />;
        else if (tab.route === "notifications") icon = <BellIcon size={20} />;
        else if (tab.route === "repos") icon = <RepoIcon size={20} />;
        else icon = <Avatar src={viewer.avatarUrl} size={22} />;
        return (
          <button
            key={tab.route}
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              if (active) window.dispatchEvent(new CustomEvent("ghc:scroll-top"));
              else nav.resetTo(tab.path);
            }}
          >
            <span className="tab-icon">
              {icon}
              {tab.route === "notifications" && unread.data && <span className="tab-dot" />}
            </span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

class ScreenErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Screen crashed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="content">
          <ErrorView error={this.state.error} onRetry={() => this.setState({ error: null })} />
          <div className="center" style={{ paddingTop: 0 }}>
            <button className="btn btn-ghost" onClick={nav.back}>
              Go back
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
