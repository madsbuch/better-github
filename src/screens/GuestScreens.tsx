// Guest mode's two tabs (see lib/guest.ts): the public repositories of the
// profiles a guest follows, and the list of those profiles.

import { MarkGithubIcon, PeopleIcon, PlusIcon, RepoIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../lib/api";
import { compactNumber } from "../lib/format";
import { addProfile, isValidLogin, removeProfile, useGuestProfiles } from "../lib/guest";
import { to } from "../lib/nav";
import { useSessionApi } from "../lib/session";
import { useToast } from "../lib/toast";
import type { RepoListItem } from "../lib/types";
import { GUEST_REPOS_PER_PROFILE, guestQueries, toRepoListItem } from "../queries/guest";
import { keys } from "../queries/keys";
import { Screen } from "../components/Screen";
import { RepoRow } from "../components/rows";
import { Avatar, EmptyState, ErrorView, SkeletonList, Spinner } from "../components/ui";

/** `text`, or null when it is missing or empty. */
const nonEmpty = (text: string | null | undefined): string | null => (text === null || text === undefined || text === "" ? null : text);

/** Every followed profile's most recently pushed public repositories, newest first. */
export function GuestReposScreen() {
  const profiles = useGuestProfiles();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<string | null>(null);
  const results = useQueries({ queries: profiles.map((login) => guestQueries.repos(login)) });

  const repos: RepoListItem[] = results
    .flatMap((r) => r.data?.items.map(toRepoListItem) ?? [])
    .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));

  const onlyName = nonEmpty(only);
  const selected = onlyName !== null && profiles.some((p) => p.toLowerCase() === onlyName.toLowerCase()) ? onlyName.toLowerCase() : null;
  const needle = filter.trim().toLowerCase();
  const visible = repos.filter(
    (r) =>
      (selected === null || r.owner.login.toLowerCase() === selected) &&
      (needle === "" || r.nameWithOwner.toLowerCase().includes(needle) || r.description?.toLowerCase().includes(needle) === true),
  );
  const pending = results.some((r) => r.isPending);
  const failed = results.flatMap((r, i) => {
    const login = profiles[i];
    return r.isError && login !== undefined ? [{ login, error: r.error }] : [];
  });
  const firstFailure = failed[0];
  const refresh = () => Promise.all(profiles.map((login) => queryClient.refetchQueries({ queryKey: keys.guest.repos(login) })));

  return (
    <Screen
      title="Repositories"
      actions={
        profiles.length > 0 && (
          <Link {...to.profile()} className="icon-btn" aria-label="Manage profiles">
            <PlusIcon size={20} />
          </Link>
        )
      }
      header={
        profiles.length > 0 && (
          <>
            {profiles.length > 1 && (
              <div className="chips" role="radiogroup" aria-label="Profile">
                <button role="radio" aria-checked={selected === null} className={selected === null ? "chip active" : "chip"} onClick={() => setOnly(null)}>
                  All
                </button>
                {profiles.map((login) => (
                  <button
                    key={login}
                    role="radio"
                    aria-checked={selected === login.toLowerCase()}
                    className={selected === login.toLowerCase() ? "chip active" : "chip"}
                    onClick={() => setOnly(login)}
                  >
                    {login}
                  </button>
                ))}
              </div>
            )}
            <div className="search-bar">
              <SearchIcon size={16} />
              <input
                type="search"
                placeholder="Filter repositories"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                enterKeyHint="search"
              />
              {filter !== "" && (
                <button className="icon-btn sm" aria-label="Clear" onClick={() => setFilter("")}>
                  <XIcon size={14} />
                </button>
              )}
            </div>
          </>
        )
      }
      onRefresh={refresh}
    >
      {profiles.length === 0 ? (
        <>
          <EmptyState icon={<RepoIcon size={32} />} title="Follow profiles to see their repositories">
            Add GitHub users or organizations. Their public repositories show up here.
          </EmptyState>
          <AddProfileForm />
        </>
      ) : pending && repos.length === 0 ? (
        <SkeletonList />
      ) : failed.length === profiles.length && firstFailure !== undefined ? (
        <ErrorView error={firstFailure.error} onRetry={() => void refresh()} />
      ) : (
        <>
          {failed.map(({ login, error }) => (
            <div key={login} className="pad muted small" role="alert">
              Couldn't load {login}'s repositories: {errorMessage(error)}
            </div>
          ))}
          {visible.length === 0 ? (
            <EmptyState icon={<RepoIcon size={32} />} title={needle !== "" ? "No matching repositories" : "No public repositories"} />
          ) : (
            visible.map((repo) => <RepoRow key={repo.id} repo={repo} />)
          )}
          {needle === "" && results.some((r) => nonEmpty(r.data?.next) !== null) && (
            <p className="pad muted small" style={{ margin: 0 }}>
              Showing each profile's {GUEST_REPOS_PER_PROFILE} most recently updated repositories. Open a profile to see all of them.
            </p>
          )}
        </>
      )}
    </Screen>
  );
}

/** The profiles a guest follows, with a field to add more. */
export function GuestProfilesScreen() {
  const profiles = useGuestProfiles();
  const session = useSessionApi();

  return (
    <Screen title="Profiles">
      <AddProfileForm />
      {profiles.length === 0 ? (
        <EmptyState icon={<PeopleIcon size={32} />} title="No profiles yet">
          Add a user or organization by its GitHub name, like “torvalds” or “rust-lang”.
        </EmptyState>
      ) : (
        profiles.map((login) => <ProfileRow key={login} login={login} />)
      )}

      <div className="pad">
        <button className="btn btn-block btn-primary" onClick={() => void session.leaveGuest()}>
          <MarkGithubIcon size={16} /> Sign in to GitHub
        </button>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Signed in, you also get your own and private repositories, pull requests, issues, notifications and search.
        </p>
      </div>
    </Screen>
  );
}

function ProfileRow({ login }: { login: string }) {
  const profile = useQuery(guestQueries.profile(login));
  const p = profile.data;
  return (
    <div className="row" style={{ alignItems: "center" }}>
      <Link {...to.user(login)} className="row-flex grow" style={{ minWidth: 0, color: "inherit", gap: 12 }}>
        {p ? <Avatar src={p.avatar_url} size={36} square={p.type === "Organization"} /> : <span style={{ width: 36, height: 36 }} />}
        <span className="row-body">
          <span className="bold ellipsis" style={{ display: "block" }}>
            {nonEmpty(p?.name) ?? login}
          </span>
          <span className="muted small" style={{ display: "block" }}>
            {profile.isError
              ? errorMessage(profile.error)
              : p === null
                ? "Not found"
                : p
                  ? [nonEmpty(p.name) !== null ? p.login : null, p.type === "Organization" ? "Organization" : null, `${compactNumber(p.public_repos ?? 0)} ${p.public_repos === 1 ? "repository" : "repositories"}`]
                      .filter(Boolean)
                      .join(" · ")
                  : " "}
          </span>
        </span>
      </Link>
      <button className="icon-btn" aria-label={`Remove ${login}`} onClick={() => removeProfile(login)}>
        <XIcon size={18} />
      </button>
    </div>
  );
}

function AddProfileForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // Accept "@name" and github.com links too.
    const name = login
      .trim()
      .replace(/^@/, "")
      .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
      .replace(/\/.*$/, "");
    if (!isValidLogin(name)) {
      setError("That isn't a GitHub user or organization name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const profile = await queryClient.fetchQuery(guestQueries.profile(name));
      if (profile === null) {
        setError(`There's no user or organization called ${name}.`);
        return;
      }
      if (addProfile(profile.login)) toast.show(`Added ${profile.login}`, "success");
      else toast.show(`${profile.login} is already in your list`);
      setLogin("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pad" onSubmit={(e) => void submit(e)} style={{ borderBottom: "1px solid var(--border-muted)" }}>
      <label className="field-label" htmlFor="guest-add-profile">
        Add a profile
      </label>
      <div className="row-flex" style={{ gap: 8 }}>
        <input
          id="guest-add-profile"
          className="input"
          placeholder="User or organization"
          value={login}
          onChange={(e) => {
            setLogin(e.target.value);
            setError(null);
          }}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
        />
        <button className="btn btn-primary" type="submit" disabled={busy || login.trim() === ""} aria-label="Add profile">
          {busy ? <Spinner /> : <PlusIcon size={16} />} Add
        </button>
      </div>
      {error !== null && error !== "" && (
        <p className="small c-danger" role="alert" style={{ margin: "6px 0 0" }}>
          {error}
        </p>
      )}
    </form>
  );
}
