import { CopyIcon, IssueClosedIcon, IssueReopenedIcon, KebabHorizontalIcon, LinkExternalIcon, SkipIcon } from "@primer/octicons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { to, useNav } from "../lib/nav";
import { useViewer } from "../lib/session";
import { useToast } from "../lib/toast";
import type { IssueDetail, IssueResult } from "../lib/types";
import { issueQueries, useIssueMutations } from "../queries/issues";
import { Composer, focusComposer } from "../components/Composer";
import { Screen } from "../components/Screen";
import { ActionSheet } from "../components/Sheet";
import { CommentCard, EventRow, IssueCommentCard } from "../components/Timeline";
import { Avatar, CenterSpinner, ErrorView, Labels, LoadMore, StateBadge, Time } from "../components/ui";

const route = getRouteApi("/$owner/$repo/issues/$number");

type IssueOrPull = NonNullable<IssueResult["repository"]>["issueOrPullRequest"];

/** The issue, when GitHub answered with one (and not a pull request or something newer). */
function asIssue(node: IssueOrPull | undefined): IssueDetail | null {
  return node !== null && node !== undefined && "timelineItems" in node ? node : null;
}

export function IssueScreen() {
  const { owner, repo, number } = route.useParams();
  const viewer = useViewer();
  const toast = useToast();
  const nav = useNav();
  const [menu, setMenu] = useState(false);
  const [comment, setComment] = useState("");
  const query = useInfiniteQuery(issueQueries.detail(owner, repo, number));
  const mutations = useIssueMutations(owner, repo, number);

  const first = query.data?.pages[0]?.repository?.issueOrPullRequest ?? null;

  // GitHub serves pull requests under /issues/N too.
  useEffect(() => {
    if (first?.__typename === "PullRequest") nav.replace(to.pull(owner, repo, number));
  }, [first, owner, repo, number, nav]);

  const issue = asIssue(first);
  const items = query.data?.pages.flatMap((p) => asIssue(p.repository?.issueOrPullRequest)?.timelineItems.nodes ?? []) ?? [];

  const submitComment = async () => {
    if (!issue) return;
    try {
      await mutations.comment.mutateAsync({ subjectId: issue.id, body: comment.trim() });
      setComment("");
    } catch {
      // The mutation reports the error.
    }
  };

  const setState = (close: boolean, reason?: "COMPLETED" | "NOT_PLANNED") => {
    if (issue) mutations.setState.mutate({ issueId: issue.id, close, reason });
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
            {badge !== null && <StateBadge kind={badge} />}
            <h2>
              {issue.title} <span className="num">#{issue.number}</span>
            </h2>
            <div className="row-flex small muted">
              <Avatar src={issue.author?.avatarUrl ?? null} size={18} />
              {issue.author ? (
                <Link {...to.user(issue.author.login)} className="bold" style={{ color: "var(--fg)" }}>
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
            // Kinds of items this app doesn't know yet carry only their type name: show nothing.
            !("id" in item) ? null : item.__typename === "IssueComment" ? (
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
            onSelect: () => setState(true, "COMPLETED"),
          },
          {
            label: "Close as not planned",
            icon: <SkipIcon size={18} />,
            hidden: !issue || issue.state !== "OPEN" || !issue.viewerCanClose,
            onSelect: () => setState(true, "NOT_PLANNED"),
          },
          {
            label: "Reopen issue",
            icon: <IssueReopenedIcon size={18} />,
            hidden: !issue || issue.state === "OPEN" || !issue.viewerCanReopen,
            onSelect: () => setState(false),
          },
          { label: "Open in browser", icon: <LinkExternalIcon size={18} />, onSelect: () => void backend.openUrl(url) },
          { label: "Copy link", icon: <CopyIcon size={18} />, onSelect: () => void backend.copyText(url).then(() => toast.show("Link copied")) },
        ]}
      />
    </Screen>
  );
}
