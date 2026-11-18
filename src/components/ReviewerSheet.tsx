import { CheckIcon, SearchIcon } from "@primer/octicons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AssignableUser } from "../lib/types";
import { newPullQueries } from "../queries/newPull";
import { Sheet } from "./Sheet";
import { Avatar, ErrorView, Spinner } from "./ui";

/** Picks reviewers among the people who can be assigned in owner/repo. */
export function ReviewerSheet({
  open,
  onClose,
  owner,
  repo,
  selected,
  onChange,
  exclude,
}: {
  open: boolean;
  onClose: () => void;
  owner: string;
  repo: string;
  selected: AssignableUser[];
  onChange: (users: AssignableUser[]) => void;
  /** The author, who can't review their own pull request. */
  exclude: string;
}) {
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(filter.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [filter]);
  const users = useQuery({ ...newPullQueries.assignableUsers(owner, repo, query), enabled: open, placeholderData: keepPreviousData });
  const isSelected = (login: string) => selected.some((u) => u.login === login);
  const toggle = (user: AssignableUser) =>
    onChange(isSelected(user.login) ? selected.filter((u) => u.login !== user.login) : [...selected, user]);
  const list = (users.data ?? []).filter((u) => u.login.toLowerCase() !== exclude.toLowerCase());

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Request reviews"
      full
      footer={
        <button className="btn btn-primary btn-block" onClick={onClose}>
          Done{selected.length > 0 ? ` (${selected.length})` : ""}
        </button>
      }
    >
      <div className="search-bar" style={{ margin: "0 0 8px" }}>
        <SearchIcon size={16} />
        <input
          type="search"
          placeholder="Find people"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
      {users.isPending ? (
        <div className="center">
          <Spinner />
        </div>
      ) : users.isError ? (
        <ErrorView error={users.error} onRetry={() => void users.refetch()} />
      ) : list.length === 0 ? (
        <p className="muted small">Nobody matches “{filter}”.</p>
      ) : (
        list.map((user) => (
          <button
            key={user.login}
            className="menu-item"
            role="checkbox"
            aria-checked={isSelected(user.login)}
            style={{ paddingLeft: 4 }}
            onClick={() => toggle(user)}
          >
            <Avatar src={user.avatarUrl} size={24} />
            <span className="grow ellipsis">
              <span className="bold">{user.login}</span>
              {user.name !== null && user.name !== "" && <span className="muted small"> {user.name}</span>}
            </span>
            {isSelected(user.login) && <CheckIcon size={16} className="c-accent" />}
          </button>
        ))
      )}
    </Sheet>
  );
}
