import { CopyIcon, IssueClosedIcon, IssueReopenedIcon, KebabHorizontalIcon, LinkExternalIcon, SkipIcon } from "@primer/octicons-react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { errorMessage, graphql } from "../lib/api";
import { backend } from "../lib/backend";
import { ADD_COMMENT, CLOSE_ISSUE, ISSUE, REOPEN_ISSUE } from "../lib/queries";
import { Link, nav, useScreen } from "../lib/router";
import { paths } from "../lib/routes";
import { useViewer } from "../lib/session";
import { useToast } from "../lib/toast";
import type { IssueDetail, IssueResult } from "../lib/types";
import { Composer, focusComposer } from "../components/Composer";
import { repoKey } from "../components/RepoParts";
import { Screen } from "../components/Screen";
import { ActionSheet } from "../components/Sheet";
import { CommentCard, EventRow, IssueCommentCard } from "../components/Timeline";
import { Avatar, CenterSpinner, ErrorView, Labels, LoadMore, StateBadge, Time } from "../components/ui";

export function IssueScreen() {
  const { route } = useScreen();
  const { owner, repo } = route.params;
  const number = Number(route.params.number);
  const viewer = useViewer();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [comment, setComment] = useState("");
  const key = [...repoKey(owner, repo), "issue", number];

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => graphql<IssueResult>(ISSUE, { owner, name: repo, number, after: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => {
      const issue = last.repository?.issueOrPullRequest;
      return issue?.__typename === "Issue" && issue.timelineItems.pageInfo.hasNextPage ? issue.timelineItems.pageInfo.endCursor : undefined;
    },
  });

  const first = query.data?.pages[0]?.repository?.issueOrPullRequest ?? null;

  // GitHub serves pull requests under /issues/N too.
  useEffect(() => {
    if (first?.__typename === "PullRequest") nav.replace(paths.pull(owner, repo, number));
  }, [first, owner, repo, number]);

  const issue = first?.__typename === "Issue" ? (first as IssueDetail) : null;
  const items =
    query.data?.pages.flatMap((p) => {
      const node = p.repository?.issueOrPullRequest;
      return node?.__typename === "Issue" ? (node as IssueDetail).timelineItems.nodes : [];
    }) ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const submitComment = async () => {
    if (!issue) return;
    try {
      await graphql(ADD_COMMENT, { subjectId: issue.id, body: comment.trim() });
      setComment("");
      await refresh();
    } catch (e) {
      toast.show(errorMessage(e), "error");
    }
  };

  const setState = async (close: boolean, reason?: "COMPLETED" | "NOT_PLANNED") => {
    if (!issue) return;
    try {
      if (close) await graphql(CLOSE_ISSUE, { issueId: issue.id, stateReason: reason ?? "COMPLETED" });
      else await graphql(REOPEN_ISSUE, { issueId: issue.id });
      toast.show(close ? "Issue closed" : "Issue reopened", "success");
      await refresh();
      void queryClient.invalidateQueries({ queryKey: ["search-issues"] });
    } catch (e) {
      toast.show(errorMessage(e), "error");
    }
  };

  const url = `https://github.com/${owner}/${repo}/issues/${number}`;
  const badge = issue
    ? issue.state === "OPEN"
      ? "issue-open"
      : issue.stateReason === "NOT_PLANNED" || issue.stateReason === "DUPLICATE"
        ? "issue-skipped"
        : "issue-closed"
    : null;

  return (
    <Screen
      title={`Issue #${number}`}
      subtitle={`${owner}/${repo}`}
      actions={
        <button className="icon-btn" aria-label="More" onClick={() => setMenu(true)}>
          <KebabHorizontalIcon size={20} />
        </button>
      }
      footer={
        issue && !issue.locked ? (
          <Composer value={comment} onChange={setComment} onSubmit={submitComment} />
        ) : undefined
      }
      onRefresh={() => query.refetch()}
    >
      {query.isPending ? (
        <CenterSpinner />
      ) : query.isError ? (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      ) : !issue ? (
        first?.__typename === "PullRequest" ? <CenterSpinner /> : <ErrorView error={{ message: "Issue not found", status: 404 }} />
      ) : (
        <div className="timeline">
          <div className="detail-header">
            {badge && <StateBadge kind={badge} />}
            <h2>
              {issue.title} <span className="num">#{issue.number}</span>
            </h2>
            <div className="row-flex small muted">
              <Avatar src={issue.author?.avatarUrl} size={18} />
              {issue.author ? (
                <Link to={paths.user(issue.author.login)} className="bold" style={{ color: "var(--fg)" }}>
                  {issue.author.login}
                </Link>
              ) : (
                "ghost"
              )}
              <span>
                opened <Time iso={issue.createdAt} />
              </span>
            </div>
            <Labels labels={issue.labels?.nodes} />
            {(issue.assignees.nodes.length > 0 || issue.milestone) && (
              <div className="row-flex small muted" style={{ marginTop: 8, flexWrap: "wrap" }}>
                {issue.assignees.nodes.length > 0 && (
                  <span className="row-flex">
                    Assignees
                    <span className="avatar-stack">
                      {issue.assignees.nodes.map((a) => (
                        <Avatar key={a.login} src={a.avatarUrl} size={20} alt={a.login} />
                      ))}
                    </span>
                  </span>
                )}
                {issue.milestone && <span>Milestone: {issue.milestone.title}</span>}
              </div>
            )}
          </div>
          <CommentCard
            author={issue.author}
            association={issue.authorAssociation}
            createdAt={issue.createdAt}
            bodyHTML={issue.bodyHTML}
            body={issue.body}
            url={url}
            highlight={issue.author?.login === viewer.login}
            onQuote={(text) => {
              setComment((c) => c + text);
              focusComposer();
            }}
          />
          {items.map((item) =>
            item.__typename === "IssueComment" ? (
              <IssueCommentCard
                key={item.id}
                item={item}
                viewerLogin={viewer.login}
                onQuote={(text) => {
                  setComment((c) => c + text);
                  focusComposer();
                }}
              />
            ) : (
              <EventRow key={item.id} event={item} owner={owner} repo={repo} isPull={false} />
            ),
          )}
          <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()} />
          {issue.locked && <div className="banner">This conversation is locked.</div>}
        </div>
      )}
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title="Issue"
        actions={[
          {
            label: "Close as completed",
            icon: <IssueClosedIcon size={18} />,
            hidden: !issue || issue.state !== "OPEN" || !issue.viewerCanClose,
            onSelect: () => void setState(true, "COMPLETED"),
          },
          {
            label: "Close as not planned",
            icon: <SkipIcon size={18} />,
            hidden: !issue || issue.state !== "OPEN" || !issue.viewerCanClose,
            onSelect: () => void setState(true, "NOT_PLANNED"),
          },
          {
            label: "Reopen issue",
            icon: <IssueReopenedIcon size={18} />,
            hidden: !issue || issue.state === "OPEN" || !issue.viewerCanReopen,
            onSelect: () => void setState(false),
          },
          { label: "Open in browser", icon: <LinkExternalIcon size={18} />, onSelect: () => void backend.openUrl(url) },
          { label: "Copy link", icon: <CopyIcon size={18} />, onSelect: () => void backend.copyText(url).then(() => toast.show("Link copied")) },
        ]}
      />
    </Screen>
  );
}
