import {
  BellIcon,
  ChevronRightIcon,
  GearIcon,
  GitPullRequestIcon,
  LinkExternalIcon,
  LocationIcon,
  OrganizationIcon,
  PeopleIcon,
  RepoIcon,
  SignOutIcon,
  StarIcon,
} from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { backend } from "../lib/backend";
import { compactNumber } from "../lib/format";
import { to } from "../lib/nav";
import { useSessionApi, useViewer } from "../lib/session";
import { viewerQueries } from "../queries/viewer";
import { Screen } from "../components/Screen";
import { Avatar, ErrorView } from "../components/ui";

export function ProfileScreen() {
  const session = useViewer();
  const { signOut } = useSessionApi();
  const viewer = useQuery(viewerQueries.profile());
  const v = viewer.data?.viewer;

  return (
    <Screen title="You" onRefresh={() => viewer.refetch()}>
      <div className="profile-header">
        <Avatar src={v?.avatarUrl ?? session.avatarUrl} size={72} />
        <div className="grow">
          <h2 className="ellipsis">{v?.name || session.name || session.login}</h2>
          <div className="muted">{session.login}</div>
        </div>
      </div>
      {viewer.isError && <ErrorView error={viewer.error} onRetry={() => void viewer.refetch()} />}
      {v && (
        <div style={{ padding: "0 16px 12px" }}>
          {v.bio && <p style={{ margin: "0 0 10px" }}>{v.bio}</p>}
          <div className="stats-row" style={{ marginTop: 0 }}>
            <span>
              <PeopleIcon size={14} /> <strong>{compactNumber(v.followers.totalCount)}</strong> followers ·{" "}
              <strong>{compactNumber(v.following.totalCount)}</strong> following
            </span>
            {v.company && (
              <span>
                <OrganizationIcon size={14} /> {v.company}
              </span>
            )}
            {v.location && (
              <span>
                <LocationIcon size={14} /> {v.location}
              </span>
            )}
          </div>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--border-muted)" }}>
        <Link {...to.repos()} className="kv">
          <RepoIcon size={18} />
          <span className="grow">Repositories</span>
          <span className="muted">{v ? compactNumber(v.repositories.totalCount) : ""}</span>
          <ChevronRightIcon size={16} className="c-muted" />
        </Link>
        <Link {...to.repos("starred")} className="kv">
          <StarIcon size={18} />
          <span className="grow">Stars</span>
          <span className="muted">{v ? compactNumber(v.starredRepositories.totalCount) : ""}</span>
          <ChevronRightIcon size={16} className="c-muted" />
        </Link>
        <Link {...to.settings()} className="kv">
          <GearIcon size={18} />
          <span className="grow">Settings</span>
          <ChevronRightIcon size={16} className="c-muted" />
        </Link>
        <Link {...to.inbox()} preload="viewport" className="kv">
          <GitPullRequestIcon size={18} />
          <span className="grow">All pull requests</span>
          <ChevronRightIcon size={16} className="c-muted" />
        </Link>
        <Link {...to.notifications()} preload="viewport" className="kv">
          <BellIcon size={18} />
          <span className="grow">Notifications</span>
          <ChevronRightIcon size={16} className="c-muted" />
        </Link>
        <button className="kv" style={{ width: "100%", border: 0, borderBottom: "1px solid var(--border-muted)", background: "none", textAlign: "left" }} onClick={() => void backend.openUrl(`https://github.com/${session.login}`)}>
          <LinkExternalIcon size={18} />
          <span className="grow">Open profile on GitHub</span>
        </button>
      </div>

      {v && v.organizations.nodes.length > 0 && (
        <>
          <h3 className="section-title">Organizations</h3>
          {v.organizations.nodes.map((org) => (
            <Link key={org.login} {...to.user(org.login)} preload="viewport" className="row" style={{ alignItems: "center" }}>
              <Avatar src={org.avatarUrl} size={32} square />
              <span className="row-body">
                <span className="bold">{org.name || org.login}</span>
                {org.name && <span className="muted small" style={{ display: "block" }}>{org.login}</span>}
              </span>
              <ChevronRightIcon size={16} className="c-muted" />
            </Link>
          ))}
        </>
      )}

      <div className="pad">
        <button className="btn btn-block btn-danger" onClick={() => void signOut()}>
          <SignOutIcon size={16} /> Sign out
        </button>
      </div>
    </Screen>
  );
}
