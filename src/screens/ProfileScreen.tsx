import {
  BellIcon,
  ChevronRightIcon,
  GitPullRequestIcon,
  LinkExternalIcon,
  LocationIcon,
  NoteIcon,
  OrganizationIcon,
  PeopleIcon,
  RepoIcon,
  StarIcon,
} from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { backend } from "../lib/backend";
import { compactNumber } from "../lib/format";
import { to } from "../lib/nav";
import { useIsGuest, useViewer } from "../lib/session";
import { viewerQueries } from "../queries/viewer";
import { Screen } from "../components/Screen";
import { Avatar, ErrorView } from "../components/ui";
import { GuestProfilesScreen } from "./GuestScreens";

/** `text`, or null when it is missing or empty. */
const nonEmpty = (text: string | null | undefined): string | null => (text === null || text === undefined || text === "" ? null : text);

export function ProfileScreen() {
  return useIsGuest() ? <GuestProfilesScreen /> : <AccountProfileScreen />;
}

function AccountProfileScreen() {
  const session = useViewer();
  const viewer = useQuery(viewerQueries.profile());
  const v = viewer.data?.viewer;

  return (
    <Screen title="You" onRefresh={() => viewer.refetch()}>
      <div className="profile-header">
        <Avatar src={v?.avatarUrl ?? session.avatarUrl} size={72} />
        <div className="grow">
          <h2 className="ellipsis">{nonEmpty(v?.name) ?? nonEmpty(session.name) ?? session.login}</h2>
          <div className="muted">{session.login}</div>
        </div>
      </div>
      {viewer.isError && <ErrorView error={viewer.error} onRetry={() => void viewer.refetch()} />}
      {v && (
        <div style={{ padding: "0 16px 12px" }}>
          {nonEmpty(v.bio) !== null && <p style={{ margin: "0 0 10px" }}>{v.bio}</p>}
          <div className="stats-row" style={{ marginTop: 0 }}>
            <span>
              <PeopleIcon size={14} /> <strong>{compactNumber(v.followers.totalCount)}</strong> followers ·{" "}
              <strong>{compactNumber(v.following.totalCount)}</strong> following
            </span>
            {nonEmpty(v.company) !== null && (
              <span>
                <OrganizationIcon size={14} /> {v.company}
              </span>
            )}
            {nonEmpty(v.location) !== null && (
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
        <Link {...to.specs()} className="kv">
          <NoteIcon size={18} />
          <span className="grow">Shared specs</span>
          <ChevronRightIcon size={16} className="c-muted" />
        </Link>
        <button className="kv" style={{ width: "100%", border: 0, borderBottom: "1px solid var(--border-muted)", background: "none", textAlign: "left" }} onClick={() => void backend.openUrl(`https://github.com/${session.login}`)}>
          <LinkExternalIcon size={18} />
          <span className="grow">Open profile on GitHub</span>
        </button>
      </div>

      {v && v.organizations.nodes.length > 0 && (
        <>
          <h3 className="section-title">
            <Link {...to.orgs()}>Organizations</Link>
          </h3>
          {v.organizations.nodes.map((org) => (
            <Link key={org.login} {...to.user(org.login)} preload="viewport" className="row" style={{ alignItems: "center" }}>
              <Avatar src={org.avatarUrl} size={32} square />
              <span className="row-body">
                <span className="bold">{nonEmpty(org.name) ?? org.login}</span>
                {nonEmpty(org.name) !== null && <span className="muted small" style={{ display: "block" }}>{org.login}</span>}
              </span>
              <ChevronRightIcon size={16} className="c-muted" />
            </Link>
          ))}
        </>
      )}

    </Screen>
  );
}
