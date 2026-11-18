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
import { useInfiniteQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { backend } from "../lib/backend";
import { appLinkForUrl, htmlUrlForApiUrl } from "../lib/links";
import { to, useNav, type LinkTarget } from "../lib/nav";
import {
  notificationQueries,
  type RestNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationDone,
  useMarkNotificationRead,
} from "../queries/notifications";
import { Screen } from "../components/Screen";
import { ActionSheet } from "../components/Sheet";
import { Avatar, EmptyState, ErrorView, LoadMore, Segmented, SkeletonList, Time } from "../components/ui";

const route = getRouteApi("/notifications");

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

function targetFor(n: RestNotification): { link: LinkTarget | null; url: string } {
  const apiUrl = n.subject.url;
  if (apiUrl !== null && apiUrl !== "") return { link: appLinkForUrl(apiUrl), url: htmlUrlForApiUrl(apiUrl) };
  const [owner, repo] = [n.repository.owner.login, n.repository.name];
  const repoUrl = `https://github.com/${n.repository.full_name}`;
  // Workflow run notifications carry no URL; their runs are in the Actions tab.
  if (n.subject.type === "CheckSuite") return { link: to.repo(owner, repo, { tab: "actions" }), url: `${repoUrl}/actions` };
  return { link: to.repo(owner, repo), url: repoUrl };
}

export function NotificationsScreen() {
  const filter = route.useSearch({ select: (s) => s.filter ?? "unread" });
  const nav = useNav();
  const [menuOpen, setMenuOpen] = useState(false);
  const list = useInfiniteQuery(notificationQueries.list(filter));
  const markRead = useMarkNotificationRead();
  const markDone = useMarkNotificationDone();
  const markAllRead = useMarkAllNotificationsRead();

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  // Group consecutive notifications by repository.
  const groups: { repo: string; avatar: string; items: RestNotification[] }[] = [];
  for (const n of items) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.repo === n.repository.full_name) last.items.push(n);
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
          onChange={(value) => nav.replace(to.notifications(value === "unread" ? undefined : value))}
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
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onOpen={() => {
                    if (n.unread) markRead.mutate(n);
                  }}
                  onDone={() => markDone.mutate(n)}
                />
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
          { label: "Mark all as read", icon: <ReadIcon size={18} />, onSelect: () => markAllRead.mutate() },
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

function NotificationRow({ notification: n, onOpen, onDone }: { notification: RestNotification; onOpen: () => void; onDone: () => void }) {
  const target = targetFor(n);
  const body = (
    <>
      <span className={`row-title${n.unread ? " unread" : ""}`} style={{ display: "block", fontWeight: n.unread ? 600 : 400 }}>
        {n.subject.title}
      </span>
      <span className="row-meta">
        <span>{REASONS[n.reason] ?? n.reason.replace(/_/g, " ")}</span>
        <span>·</span>
        <Time iso={n.updated_at} />
      </span>
    </>
  );
  return (
    <div className="row" style={{ paddingRight: 4 }}>
      <span className={`row-icon ${n.unread ? "c-accent" : "c-muted"}`}>{subjectIcon(n.subject.type)}</span>
      {target.link ? (
        // Preloads the pull request or issue as it scrolls into view.
        <Link {...target.link} preload="viewport" className="row-body" style={{ color: "inherit" }} onClick={onOpen}>
          {body}
        </Link>
      ) : (
        <button
          className="row-body"
          style={{ border: 0, background: "none", padding: 0, textAlign: "left" }}
          onClick={() => {
            onOpen();
            void backend.openUrl(target.url);
          }}
        >
          {body}
        </button>
      )}
      <button className="icon-btn sm" aria-label="Mark as done" onClick={onDone}>
        <CheckIcon size={16} />
      </button>
    </div>
  );
}
