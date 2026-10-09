import {
  BookIcon,
  CodeIcon,
  PlayIcon,
  CopyIcon,
  EyeIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  IssueOpenedIcon,
  KebabHorizontalIcon,
  LawIcon,
  LinkExternalIcon,
  LinkIcon,
  LockIcon,
  RepoForkedIcon,
  StarFillIcon,
  StarIcon,
} from "@primer/octicons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { compactNumber } from "../lib/format";
import { splitRepo, to, useNav, type RepoTab } from "../lib/nav";
import { recentBranches } from "../lib/newPull";
import { useViewer } from "../lib/session";
import { useToast } from "../lib/toast";
import type { RepoDetail } from "../lib/types";
import { actionsQueries } from "../queries/actions";
import { keys } from "../queries/keys";
import { newPullQueries } from "../queries/newPull";
import { repoQueries, useStarRepo } from "../queries/repos";
import { repoListQuery, searchQueries, useIssueSearch } from "../queries/search";
import { ActionsTab } from "./actions/ActionsTab";
import { Markdown, type MarkdownBase } from "../components/Markdown";
import { RecentBranchPrompts } from "../components/RecentBranches";
import { BranchBar, CommitList, TreeView } from "../components/RepoParts";
import { Screen } from "../components/Screen";
import { ActionSheet } from "../components/Sheet";
import { SearchIssueRow } from "../components/rows";
import { Avatar, CenterSpinner, EmptyState, ErrorView, LoadMore, ScreenTabs, Segmented, SkeletonList } from "../components/ui";

const route = getRouteApi("/$owner/$repo/");

export function RepoScreen() {
  const { owner, repo } = route.useParams();
  const search = route.useSearch();
  const tab: RepoTab = search.tab ?? "about";
  const nav = useNav();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const fullName = `${owner}/${repo}`;

  const detail = useQuery(repoQueries.detail(owner, repo));
  const data = detail.data?.repository ?? null;
  const gitRef = search.ref ?? data?.defaultBranchRef?.name ?? "";
  const star = useStarRepo(owner, repo);

  // Every tab's first page loads in the background, so switching tabs is instant.
  useEffect(() => {
    void queryClient.prefetchQuery(repoQueries.readme(owner, repo));
    void queryClient.prefetchInfiniteQuery(searchQueries.issues(repoListQuery(owner, repo, "pulls", "open")));
    void queryClient.prefetchInfiniteQuery(searchQueries.issues(repoListQuery(owner, repo, "issues", "open")));
    void queryClient.prefetchInfiniteQuery(actionsQueries.runs(owner, repo));
    void queryClient.prefetchQuery(newPullQueries.repoBranches(owner, repo));
  }, [queryClient, owner, repo]);
  useEffect(() => {
    if (!gitRef) return;
    void queryClient.prefetchQuery(repoQueries.contents(owner, repo, gitRef, ""));
    void queryClient.prefetchInfiniteQuery(repoQueries.commits(owner, repo, gitRef));
  }, [queryClient, owner, repo, gitRef]);

  const setTab = (next: RepoTab) => nav.replace(to.repo(owner, repo, { tab: next, ref: search.ref }));
  const setRef = (ref: string) => nav.replace(to.repo(owner, repo, { tab, ref }));
  const refresh = () => queryClient.refetchQueries({ queryKey: keys.repo.all(owner, repo), type: "active" });

  return (
    <Screen
      title={repo}
      subtitle={owner}
      actions={
        <>
          {data && (
            <button className="icon-btn" aria-label={data.viewerHasStarred ? "Unstar" : "Star"} onClick={() => star.mutate(!data.viewerHasStarred)}>
              {data.viewerHasStarred ? <StarFillIcon size={20} className="c-attention" /> : <StarIcon size={20} />}
            </button>
          )}
          <button className="icon-btn" aria-label="More" onClick={() => setMenu(true)}>
            <KebabHorizontalIcon size={20} />
          </button>
        </>
      }
      header={
        <ScreenTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "about", label: "About", icon: <BookIcon size={16} /> },
            { value: "code", label: "Code", icon: <CodeIcon size={16} /> },
            { value: "pulls", label: "Pull requests", icon: <GitPullRequestIcon size={16} />, count: data?.pullRequests.totalCount },
            ...(data?.hasIssuesEnabled === false
              ? []
              : [{ value: "issues" as RepoTab, label: "Issues", icon: <IssueOpenedIcon size={16} />, count: data?.issues.totalCount }]),
            { value: "actions", label: "Actions", icon: <PlayIcon size={16} /> },
            { value: "commits", label: "Commits", icon: <GitCommitIcon size={16} /> },
          ]}
        />
      }
      onRefresh={refresh}
    >
      {detail.isPending ? (
        <CenterSpinner />
      ) : detail.isError ? (
        <ErrorView error={detail.error} onRetry={() => void detail.refetch()} />
      ) : !data ? (
        <EmptyState title="Repository not found">It may be private or it doesn't exist.</EmptyState>
      ) : tab === "about" ? (
        <About repo={data} />
      ) : tab === "code" ? (
        gitRef ? (
          <>
            <BranchBar owner={owner} repo={repo} gitRef={gitRef} onChange={setRef} />
            <TreeView owner={owner} repo={repo} gitRef={gitRef} path="" />
          </>
        ) : (
          <EmptyState title="This repository is empty" />
        )
      ) : tab === "pulls" || tab === "issues" ? (
        <RepoIssues owner={owner} repo={repo} kind={tab} parent={data.parent?.nameWithOwner} />
      ) : tab === "actions" ? (
        <ActionsTab owner={owner} repo={repo} workflow={search.workflow} status={search.status} />
      ) : gitRef ? (
        <>
          <BranchBar owner={owner} repo={repo} gitRef={gitRef} onChange={setRef} />
          <CommitList owner={owner} repo={repo} gitRef={gitRef} />
        </>
      ) : (
        <EmptyState title="No commits yet" />
      )}
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title="Repository"
        actions={[
          {
            label: "New pull request",
            icon: <GitPullRequestIcon size={18} />,
            onSelect: () => nav.navigate(newPullTarget(owner, repo, data?.parent?.nameWithOwner)),
          },
          { label: "Open in browser", icon: <LinkExternalIcon size={18} />, onSelect: () => void backend.openUrl(`https://github.com/${fullName}`) },
          {
            label: "Copy link",
            icon: <CopyIcon size={18} />,
            onSelect: () => void backend.copyText(`https://github.com/${fullName}`).then(() => toast.show("Link copied")),
          },
          {
            label: "Copy clone URL",
            icon: <CopyIcon size={18} />,
            onSelect: () => void backend.copyText(`https://github.com/${fullName}.git`).then(() => toast.show("Clone URL copied")),
          },
        ]}
      />
    </Screen>
  );
}

function About({ repo }: { repo: RepoDetail }) {
  const [owner, name] = [repo.owner.login, repo.name];
  const branch = repo.defaultBranchRef?.name;
  const readme = useQuery({ ...repoQueries.readme(owner, name), enabled: !!branch });
  const base: MarkdownBase | null = branch ? { owner, repo: name, ref: branch, dir: "" } : null;

  return (
    <>
      <div className="repo-header">
        <Link {...to.user(owner)} className="row-flex" style={{ color: "var(--fg-muted)" }}>
          <Avatar src={repo.owner.avatarUrl} size={22} square />
          <span>{owner}</span>
        </Link>
        <h2>
          {name}{" "}
          {repo.isPrivate && (
            <span className="pill" style={{ verticalAlign: "middle" }}>
              <LockIcon size={12} /> Private
            </span>
          )}
          {repo.isArchived && (
            <span className="pill pill-attention" style={{ verticalAlign: "middle", marginLeft: 4 }}>
              Archived
            </span>
          )}
        </h2>
        {repo.parent && (
          <div className="muted small" style={{ marginBottom: 6 }}>
            <RepoForkedIcon size={13} /> forked from{" "}
            <Link {...to.repo(...splitRepo(repo.parent.nameWithOwner))}>{repo.parent.nameWithOwner}</Link>
          </div>
        )}
        {repo.description && <p style={{ margin: "4px 0 8px" }}>{repo.description}</p>}
        {repo.homepageUrl && (
          <button className="link-btn row-flex" style={{ marginBottom: 6 }} onClick={() => void backend.openUrl(repo.homepageUrl!)}>
            <LinkIcon size={14} /> <span className="ellipsis">{repo.homepageUrl.replace(/^https?:\/\//, "")}</span>
          </button>
        )}
        {repo.repositoryTopics.nodes.length > 0 && (
          <div className="wrap-flex" style={{ margin: "6px 0" }}>
            {repo.repositoryTopics.nodes.map((t) => (
              <Link key={t.topic.name} {...to.search(`topic:${t.topic.name}`, "repos")} className="pill pill-accent">
                {t.topic.name}
              </Link>
            ))}
          </div>
        )}
        <div className="stats-row">
          <span>
            <StarIcon size={14} /> <strong>{compactNumber(repo.stargazerCount)}</strong> stars
          </span>
          <span>
            <RepoForkedIcon size={14} /> <strong>{compactNumber(repo.forkCount)}</strong> forks
          </span>
          <span>
            <EyeIcon size={14} /> <strong>{compactNumber(repo.watchers.totalCount)}</strong> watching
          </span>
          {repo.primaryLanguage && (
            <span>
              <span className="lang-dot" style={{ background: repo.primaryLanguage.color ?? "var(--fg-subtle)" }} />
              {repo.primaryLanguage.name}
            </span>
          )}
          {repo.licenseInfo && (
            <span>
              <LawIcon size={14} /> {repo.licenseInfo.spdxId && repo.licenseInfo.spdxId !== "NOASSERTION" ? repo.licenseInfo.spdxId : repo.licenseInfo.name}
            </span>
          )}
        </div>
      </div>
      <div className="pad">
        {readme.isPending && branch ? (
          <CenterSpinner />
        ) : readme.isError ? (
          <ErrorView error={readme.error} onRetry={() => void readme.refetch()} />
        ) : readme.data ? (
          <Markdown html={readme.data} base={base} />
        ) : (
          <p className="muted">This repository has no README.</p>
        )}
      </div>
    </>
  );
}

function RepoIssues({ owner, repo, kind, parent }: { owner: string; repo: string; kind: "pulls" | "issues"; parent?: string }) {
  const [state, setState] = useState<"open" | "closed">("open");
  const search = useIssueSearch(repoListQuery(owner, repo, kind, state));
  return (
    <>
      {kind === "pulls" && <NewPullBar owner={owner} repo={repo} parent={parent} />}
      <Segmented
        value={state}
        onChange={setState}
        options={[
          { value: "open", label: "Open" },
          { value: "closed", label: kind === "pulls" ? "Closed & merged" : "Closed" },
        ]}
      />
      {search.isPending ? (
        <SkeletonList />
      ) : search.isError ? (
        <ErrorView error={search.error} onRetry={() => void search.refetch()} />
      ) : search.nodes.length === 0 ? (
        <EmptyState title={`No ${state} ${kind === "pulls" ? "pull requests" : "issues"}`} />
      ) : (
        <>
          {search.nodes.map((node, i) => (
            <SearchIssueRow key={"id" in node ? (node as { id: string }).id : i} node={node} showRepo={false} />
          ))}
          <LoadMore hasMore={search.hasNextPage} loading={search.isFetchingNextPage} onLoadMore={() => void search.fetchNextPage()} />
        </>
      )}
    </>
  );
}

/** A fork's pull requests go to its parent, as on github.com. */
function newPullTarget(owner: string, repo: string, parent: string | undefined) {
  return parent ? to.compare(...splitRepo(parent), { from: `${owner}/${repo}` }) : to.compare(owner, repo);
}

function NewPullBar({ owner, repo, parent }: { owner: string; repo: string; parent?: string }) {
  const viewer = useViewer();
  const branches = useQuery(newPullQueries.repoBranches(owner, repo));
  return (
    <>
      <div className="row-flex" style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-muted)" }}>
        <Link {...newPullTarget(owner, repo, parent)} className="btn btn-sm">
          <GitPullRequestIcon size={14} /> New pull request
        </Link>
      </div>
      <RecentBranchPrompts branches={recentBranches(branches.data ? [branches.data] : [], viewer.login)} showRepo={!!parent} />
    </>
  );
}
