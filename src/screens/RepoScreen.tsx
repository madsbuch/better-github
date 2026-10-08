import {
  BookIcon,
  CodeIcon,
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
import { useState } from "react";
import { ApiError, errorMessage, graphql, rest } from "../lib/api";
import { backend } from "../lib/backend";
import { compactNumber } from "../lib/format";
import { REPO } from "../lib/queries";
import { Link, nav, useScreen } from "../lib/router";
import { paths } from "../lib/routes";
import { useToast } from "../lib/toast";
import type { RepoDetail, RepoResult } from "../lib/types";
import { useIssueSearch } from "../hooks/useSearch";
import { Markdown, type MarkdownBase } from "../components/Markdown";
import { BranchBar, CommitList, TreeView, repoKey } from "../components/RepoParts";
import { Screen } from "../components/Screen";
import { ActionSheet } from "../components/Sheet";
import { SearchIssueRow } from "../components/rows";
import { Avatar, CenterSpinner, EmptyState, ErrorView, LoadMore, ScreenTabs, Segmented, SkeletonList } from "../components/ui";

type Tab = "about" | "code" | "pulls" | "issues" | "commits";
const TABS: Tab[] = ["about", "code", "pulls", "issues", "commits"];

export function RepoScreen() {
  const { route } = useScreen();
  const { owner, repo } = route.params;
  const tab = (TABS.includes(route.query.get("tab") as Tab) ? route.query.get("tab") : "about") as Tab;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const fullName = `${owner}/${repo}`;

  const detail = useQuery({
    queryKey: [...repoKey(owner, repo), "detail"],
    queryFn: () => graphql<RepoResult>(REPO, { owner, name: repo }),
  });
  const data = detail.data?.repository ?? null;
  const gitRef = route.query.get("ref") ?? data?.defaultBranchRef?.name ?? "";

  const withParams = (update: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(route.query);
    update(params);
    const qs = params.toString();
    nav.replace(qs ? `${paths.repo(owner, repo)}?${qs}` : paths.repo(owner, repo));
  };
  const setTab = (next: Tab) => withParams((p) => (next === "about" ? p.delete("tab") : p.set("tab", next)));
  const setRef = (ref: string) => withParams((p) => p.set("ref", ref));

  const toggleStar = async () => {
    if (!data) return;
    const starred = !data.viewerHasStarred;
    queryClient.setQueryData<RepoResult>([...repoKey(owner, repo), "detail"], (old) =>
      old?.repository
        ? { repository: { ...old.repository, viewerHasStarred: starred, stargazerCount: old.repository.stargazerCount + (starred ? 1 : -1) } }
        : old,
    );
    try {
      await rest(`/user/starred/${owner}/${repo}`, { method: starred ? "PUT" : "DELETE" });
      void queryClient.invalidateQueries({ queryKey: ["viewer-repos", "starred"] });
    } catch (e) {
      toast.show(errorMessage(e), "error");
      void detail.refetch();
    }
  };

  const refresh = () =>
    queryClient.refetchQueries({
      predicate: (q) =>
        (q.queryKey[0] === "r" && q.queryKey[1] === fullName.toLowerCase()) ||
        (q.queryKey[0] === "search-issues" && String(q.queryKey[1]).includes(`repo:${fullName}`)),
    });

  return (
    <Screen
      title={repo}
      subtitle={owner}
      actions={
        <>
          {data && (
            <button className="icon-btn" aria-label={data.viewerHasStarred ? "Unstar" : "Star"} onClick={() => void toggleStar()}>
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
              : [{ value: "issues" as Tab, label: "Issues", icon: <IssueOpenedIcon size={16} />, count: data?.issues.totalCount }]),
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
        <RepoIssues fullName={fullName} kind={tab} />
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
  const readme = useQuery({
    queryKey: [...repoKey(owner, name), "readme"],
    queryFn: async () => {
      try {
        return await rest<string>(`/repos/${owner}/${name}/readme`, { accept: "application/vnd.github.html+json" });
      } catch (e) {
        if (ApiError.from(e).status === 404) return null;
        throw e;
      }
    },
    enabled: !!branch,
  });
  const base: MarkdownBase | null = branch ? { owner, repo: name, ref: branch, dir: "" } : null;

  return (
    <>
      <div className="repo-header">
        <Link to={paths.user(owner)} className="row-flex" style={{ color: "var(--fg-muted)" }}>
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
            <Link to={`/${repo.parent.nameWithOwner}`}>{repo.parent.nameWithOwner}</Link>
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
              <Link key={t.topic.name} to={paths.search(`topic:${t.topic.name}`, "repos")} className="pill pill-accent">
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

function RepoIssues({ fullName, kind }: { fullName: string; kind: "pulls" | "issues" }) {
  const [state, setState] = useState<"open" | "closed">("open");
  const query = `repo:${fullName} ${kind === "pulls" ? "is:pr" : "is:issue"} is:${state} sort:updated-desc`;
  const search = useIssueSearch(query);
  return (
    <>
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
