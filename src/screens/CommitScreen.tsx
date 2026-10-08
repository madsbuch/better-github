import { CopyIcon, LinkExternalIcon, UnwrapIcon, WrapIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { rest } from "../lib/api";
import { backend } from "../lib/backend";
import { setPref, usePrefs } from "../lib/prefs";
import { Link, useScreen } from "../lib/router";
import { paths } from "../lib/routes";
import { useToast } from "../lib/toast";
import type { RestCommit } from "../lib/types";
import { DiffFile } from "../components/DiffView";
import { repoKey } from "../components/RepoParts";
import { Screen } from "../components/Screen";
import { Avatar, CenterSpinner, DiffStat, ErrorView, Time } from "../components/ui";

export function CommitScreen() {
  const { route } = useScreen();
  const { owner, repo, sha } = route.params;
  const prefs = usePrefs();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const commit = useQuery({
    queryKey: [...repoKey(owner, repo), "commit", sha],
    queryFn: () => rest<RestCommit>(`/repos/${owner}/${repo}/commits/${sha}`),
    staleTime: Infinity,
  });
  const data = commit.data;
  const [headline, ...bodyLines] = (data?.commit.message ?? "").split("\n");
  const body = bodyLines.join("\n").trim();

  return (
    <Screen
      title={`Commit ${sha.slice(0, 7)}`}
      subtitle={`${owner}/${repo}`}
      actions={
        <>
          <button className="icon-btn" aria-label="Toggle line wrap" onClick={() => setPref("wrapDiff", !prefs.wrapDiff)}>
            {prefs.wrapDiff ? <UnwrapIcon size={18} /> : <WrapIcon size={18} />}
          </button>
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
            {body && <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 14, color: "var(--fg-muted)", margin: "0 0 12px" }}>{body}</pre>}
            <div className="row-flex small">
              <Avatar src={data!.author?.avatar_url} size={20} />
              {data!.author ? (
                <Link to={paths.user(data!.author.login)} className="bold" style={{ color: "var(--fg)" }}>
                  {data!.author.login}
                </Link>
              ) : (
                <span className="bold">{data!.commit.author?.name}</span>
              )}
              <span className="muted">
                committed <Time iso={data!.commit.committer?.date ?? data!.commit.author?.date} />
              </span>
            </div>
            <div className="row-flex small" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <button
                className="pill mono"
                style={{ background: "none" }}
                onClick={() => void backend.copyText(data!.sha).then(() => toast.show("SHA copied"))}
              >
                <CopyIcon size={12} /> {data!.sha.slice(0, 12)}
              </button>
              {data!.parents.map((p) => (
                <Link key={p.sha} to={paths.commit(owner, repo, p.sha)} className="pill mono">
                  parent {p.sha.slice(0, 7)}
                </Link>
              ))}
              {data!.stats && <DiffStat additions={data!.stats.additions ?? 0} deletions={data!.stats.deletions ?? 0} />}
              <span className="muted">{data!.files?.length ?? 0} files</span>
            </div>
          </div>
          {(data!.files ?? []).map((f) => (
            <DiffFile
              key={f.filename}
              file={{
                filename: f.filename,
                previousFilename: f.previous_filename,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions,
                patch: f.patch,
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
