import {
  BellSlashIcon,
  CheckIcon,
  CommentDiscussionIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  IssueOpenedIcon,
  ReadIcon,
  RocketIcon,
  ShieldIcon,
  TagIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { errorMessage, restPage, rest, type Page } from "../lib/api";
import { backend } from "../lib/backend";
import { appPathForUrl, htmlUrlForApiUrl } from "../lib/links";
import { nav, useScreen } from "../lib/router";
import { paths } from "../lib/routes";
import { useToast } from "../lib/toast";
import type { RestNotification } from "../lib/types";
import { Screen } from "../components/Screen";
import { ActionSheet } from "../components/Sheet";
import { Avatar, EmptyState, ErrorView, LoadMore, Segmented, SkeletonList, Time } from "../components/ui";

type Filter = "unread" | "participating" | "all";

const REASONS: Record<string, string> = {
  approval_requested: "Approval requested",
  assign: "Assigned",
  author: "Author",
  ci_activity: "CI activity",
  comment: "Comment",
  invitation: "Invitation",
  manual: "Subscribed",
  member_feature_requested: "Feature request",
  mention: "Mentioned",
  review_requested: "Review requested",
  security_alert: "Security alert",
  security_advisory_credit: "Advisory credit",
  state_change: "State change",
  subscribed: "Watching",
  team_mention: "Team mention",
};

function subjectIcon(type: string): ReactNode {
  switch (type) {
    case "PullRequest":
      return <GitPullRequestIcon size={16} />;
    case "Issue":
      return <IssueOpenedIcon size={16} />;
    case "Release":
      return <TagIcon size={16} />;
    case "Discussion":
      return <CommentDiscussionIcon size={16} />;
    case "Commit":
      return <GitCommitIcon size={16} />;
    case "CheckSuite":
      return <XCircleIcon size={16} />;
    case "RepositoryVulnerabilityAlert":
    case "RepositoryDependabotAlertsThread":
      return <ShieldIcon size={16} />;
    default:
      return <RocketIcon size={16} />;
  }
}

function targetFor(n: RestNotification): { path: string | null; url: string } {
  const apiUrl = n.subject.url;
  if (apiUrl) {
    return { path: appPathForUrl(apiUrl), url: htmlUrlForApiUrl(apiUrl) };
  }
  const repoUrl = `https://github.com/${n.repository.full_name}`;
  if (n.subject.type === "CheckSuite") return { path: null, url: `${repoUrl}/actions` };
  return { path: paths.repo(n.repository.owner.login, n.repository.name), url: repoUrl };
}

export function NotificationsScreen() {
  const { route } = useScreen();
  const filter = (["participating", "all"].includes(route.query.get("filter") ?? "") ? route.query.get("filter") : "unread") as Filter;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const key = ["notifications", "list", filter];

  const list = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      pageParam
        ? restPage<RestNotification>(pageParam)
        : restPage<RestNotification>("/notifications", {
            query: { per_page: 50, all: filter === "all", participating: filter === "participating" },
          }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const updateItems = (fn: (items: RestNotification[]) => RestNotification[]) => {
    queryClient.setQueryData<InfiniteData<Page<RestNotification>>>(key, (data) =>
      data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items) })) } : data,
    );
  };

  const markRead = async (n: RestNotification) => {
    if (!n.unread) return;
    updateItems((items) => items.map((i) => (i.id === n.id ? { ...i, unread: false } : i)));
    try {
      await rest(`/notifications/threads/${n.id}`, { method: "PATCH" });
      void queryClient.invalidateQueries({ queryKey: ["notifications", "has-unread"] });
    } catch {
      // Not critical; it'll show as unread again on refresh.
    }
  };

  const markDone = async (n: RestNotification) => {
    updateItems((items) => items.filter((i) => i.id !== n.id));
    try {
      await rest(`/notifications/threads/${n.id}`, { method: "DELETE" });
      void queryClient.invalidateQueries({ queryKey: ["notifications", "has-unread"] });
    } catch (e) {
      toast.show(errorMessage(e), "error");
      void list.refetch();
    }
  };

  const markAllRead = async () => {
    try {
      await rest("/notifications", { method: "PUT", body: { read: true } });
      toast.show("Marked everything as read", "success");
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) {
      toast.show(errorMessage(e), "error");
    }
  };

  const open = (n: RestNotification) => {
    void markRead(n);
    const target = targetFor(n);
    if (target.path) nav.navigate(target.path);
    else void backend.openUrl(target.url);
  };

  // Group consecutive notifications by repository.
  const groups: { repo: string; avatar: string; items: RestNotification[] }[] = [];
  for (const n of items) {
    const last = groups[groups.length - 1];
    if (last && last.repo === n.repository.full_name) last.items.push(n);
    else groups.push({ repo: n.repository.full_name, avatar: n.repository.owner.avatar_url, items: [n] });
  }

  return (
    <Screen
      title="Inbox"
      actions={
        <button className="icon-btn" aria-label="More" onClick={() => setMenuOpen(true)}>
          <ReadIcon size={20} />
        </button>
      }
      header={
        <Segmented
          value={filter}
          onChange={(value) => nav.replace(value === "unread" ? paths.notifications() : `${paths.notifications()}?filter=${value}`)}
          options={[
            { value: "unread", label: "Unread" },
            { value: "participating", label: "Participating" },
            { value: "all", label: "All" },
          ]}
        />
      }
      onRefresh={() => list.refetch()}
    >
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorView error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<BellSlashIcon size={32} />} title="Inbox zero">
          {filter === "unread" ? "You've read every notification." : "No notifications here."}
        </EmptyState>
      ) : (
        <>
          {groups.map((group, gi) => (
            <div key={`${group.repo}-${gi}`}>
              <div className="group-header">
                <Avatar src={group.avatar} size={18} square />
                <span className="ellipsis">{group.repo}</span>
              </div>
              {group.items.map((n) => (
                <div key={n.id} className="row" style={{ paddingRight: 4 }}>
                  <span className={`row-icon ${n.unread ? "c-accent" : "c-muted"}`}>{subjectIcon(n.subject.type)}</span>
                  <button className="row-body" style={{ border: 0, background: "none", padding: 0, textAlign: "left" }} onClick={() => open(n)}>
                    <span className={`row-title${n.unread ? " unread" : ""}`} style={{ display: "block", fontWeight: n.unread ? 600 : 400 }}>
                      {n.subject.title}
                    </span>
                    <span className="row-meta">
                      <span>{REASONS[n.reason] ?? n.reason.replace(/_/g, " ")}</span>
                      <span>·</span>
                      <Time iso={n.updated_at} />
                    </span>
                  </button>
                  <button className="icon-btn sm" aria-label="Mark as done" onClick={() => void markDone(n)}>
                    <CheckIcon size={16} />
                  </button>
                </div>
              ))}
            </div>
          ))}
          <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => void list.fetchNextPage()} />
        </>
      )}
      <ActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Notifications"
        actions={[
          { label: "Mark all as read", icon: <ReadIcon size={18} />, onSelect: () => void markAllRead() },
          {
            label: "Manage on GitHub",
            icon: <BellSlashIcon size={18} />,
            onSelect: () => void backend.openUrl("https://github.com/notifications"),
          },
        ]}
      />
    </Screen>
  );
}
