import { CopyIcon, LinkExternalIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";
import { backend } from "../lib/backend";
import { to } from "../lib/nav";
import { usePrefs } from "../lib/prefs";
import { useToast } from "../lib/toast";
import { repoQueries } from "../queries/repos";
import { DiffFile, DiffLayoutButtons } from "../components/DiffView";
import { Screen } from "../components/Screen";
import { Avatar, CenterSpinner, DiffStat, ErrorView, Time } from "../components/ui";

const route = getRouteApi("/$owner/$repo/commit/$sha");

export function CommitScreen() {
  const { owner, repo, sha } = route.useParams();
  const prefs = usePrefs();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const commit = useQuery(repoQueries.commit(owner, repo, sha));
  const data = commit.data;
  const [headline, ...bodyLines] = (data?.commit.message ?? "").split("\n");
  const body = bodyLines.join("\n").trim();

  return (
    <Screen
      wide
      title={`Commit ${sha.slice(0, 7)}`}
      subtitle={`${owner}/${repo}`}
      actions={
        <>
          <DiffLayoutButtons />
          <button className="icon-btn" aria-label="Open in browser" onClick={() => void backend.openUrl(`https://github.com/${owner}/${repo}/commit/${sha}`)}>
            <LinkExternalIcon size={18} />
          </button>
        </>
      }
      onRefresh={() => commit.refetch()}
    >
      {commit.isPending ? (
        <CenterSpinner />
      ) : commit.isError ? (
        <ErrorView error={commit.error} onRetry={() => void commit.refetch()} />
      ) : (
        <>
          <div className="detail-header">
            <h2 style={{ marginTop: 0 }}>{headline}</h2>
            {body !== "" && <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 14, color: "var(--fg-muted)", margin: "0 0 12px" }}>{body}</pre>}
            <div className="row-flex small">
              <Avatar src={commit.data.author?.avatar_url ?? null} size={20} />
              {commit.data.author !== null ? (
                <Link {...to.user(commit.data.author.login)} className="bold" style={{ color: "var(--fg)" }}>
                  {commit.data.author.login}
                </Link>
              ) : (
                <span className="bold">{commit.data.commit.author?.name}</span>
              )}
              <span className="muted">
                committed <Time iso={commit.data.commit.committer?.date ?? commit.data.commit.author?.date} />
              </span>
            </div>
            <div className="row-flex small" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <button
                className="pill mono"
                style={{ background: "none" }}
                onClick={() => void backend.copyText(commit.data.sha).then(() => toast.show("SHA copied"))}
              >
                <CopyIcon size={12} /> {commit.data.sha.slice(0, 12)}
              </button>
              {commit.data.parents.map((p) => (
                <Link key={p.sha} {...to.commit(owner, repo, p.sha)} className="pill mono">
                  parent {p.sha.slice(0, 7)}
                </Link>
              ))}
              {commit.data.stats !== undefined && <DiffStat additions={commit.data.stats.additions ?? 0} deletions={commit.data.stats.deletions ?? 0} />}
              <span className="muted">{commit.data.files?.length ?? 0} files</span>
            </div>
          </div>
          {(commit.data.files ?? []).map((f) => (
            <DiffFile
              key={f.filename}
              file={{
                filename: f.filename,
                previousFilename: f.previous_filename ?? null,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions,
                patch: f.patch ?? null,
              }}
              wrap={prefs.wrapDiff}
              collapsed={collapsed[f.filename] ?? false}
              onToggleCollapsed={() => setCollapsed((c) => ({ ...c, [f.filename]: !(c[f.filename] ?? false) }))}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
