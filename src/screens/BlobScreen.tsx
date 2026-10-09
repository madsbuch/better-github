import { CodeIcon, CopyIcon, EyeIcon, KebabHorizontalIcon, LinkExternalIcon, UnwrapIcon, WrapIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { backend } from "../lib/backend";
import { formatBytes } from "../lib/format";
import { setPref, usePrefs } from "../lib/prefs";
import { useToast } from "../lib/toast";
import { repoQueries } from "../queries/repos";
import { CodeView } from "../components/CodeView";
import { Markdown, type MarkdownBase } from "../components/Markdown";
import { Breadcrumbs } from "../components/RepoParts";
import { Screen } from "../components/Screen";
import { ActionSheet } from "../components/Sheet";
import { CenterSpinner, EmptyState, ErrorView } from "../components/ui";

const MARKDOWN = /\.(md|markdown|mdx|mkd)$/i;

const route = getRouteApi("/$owner/$repo/blob");

export function BlobScreen() {
  const { owner, repo } = route.useParams();
  const search = route.useSearch();
  const path = search.path ?? "";
  const explicitRef = search.ref;
  const prefs = usePrefs();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const isMarkdown = MARKDOWN.test(path);
  const [preview, setPreview] = useState(isMarkdown);

  const detail = useQuery({ ...repoQueries.detail(owner, repo), enabled: !explicitRef });
  const gitRef = explicitRef ?? detail.data?.repository?.defaultBranchRef?.name ?? null;
  const file = useQuery({ ...repoQueries.blob(owner, repo, gitRef ?? "", path), enabled: !!gitRef });
  const rendered = useQuery({ ...repoQueries.blobHtml(owner, repo, gitRef ?? "", path), enabled: !!gitRef && isMarkdown && preview });

  const name = path.split("/").pop() ?? path;
  const dir = path.split("/").slice(0, -1).join("/");
  const base: MarkdownBase | null = gitRef ? { owner, repo, ref: gitRef, dir } : null;
  const webUrl = `https://github.com/${owner}/${repo}/blob/${gitRef ?? "HEAD"}/${path}`;
  const data = file.data;

  return (
    <Screen
      title={name}
      subtitle={`${owner}/${repo}${gitRef ? ` · ${gitRef}` : ""}`}
      actions={
        <>
          {isMarkdown && (
            <button className="icon-btn" aria-label={preview ? "Show source" : "Show preview"} onClick={() => setPreview(!preview)}>
              {preview ? <CodeIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          )}
          {(!isMarkdown || !preview) && (
            <button className="icon-btn" aria-label="Toggle line wrap" onClick={() => setPref("wrapCode", !prefs.wrapCode)}>
              {prefs.wrapCode ? <UnwrapIcon size={18} /> : <WrapIcon size={18} />}
            </button>
          )}
          <button className="icon-btn" aria-label="More" onClick={() => setMenu(true)}>
            <KebabHorizontalIcon size={18} />
          </button>
        </>
      }
    >
      {gitRef && <Breadcrumbs owner={owner} repo={repo} gitRef={gitRef} path={path} />}
      {!gitRef || file.isPending ? (
        detail.isError ? <ErrorView error={detail.error} onRetry={() => void detail.refetch()} /> : <CenterSpinner />
      ) : file.isError ? (
        <ErrorView error={file.error} onRetry={() => void file.refetch()} />
      ) : data!.kind === "image" ? (
        <div className="pad" style={{ textAlign: "center" }}>
          {data!.meta.download_url ? (
            <img src={data!.meta.download_url} alt={name} style={{ maxWidth: "100%", background: "repeating-conic-gradient(var(--bg-inset) 0% 25%, transparent 0% 50%) 50% / 16px 16px" }} />
          ) : (
            <EmptyState title="Image unavailable" />
          )}
        </div>
      ) : data!.kind === "binary" ? (
        <EmptyState title="Binary file">{formatBytes(data!.meta.size)} — open it on GitHub to download.</EmptyState>
      ) : data!.kind === "too-large" ? (
        <EmptyState title="File too large">{formatBytes(data!.meta.size)} is too big to show here.</EmptyState>
      ) : isMarkdown && preview ? (
        rendered.isPending ? (
          <CenterSpinner />
        ) : rendered.isError ? (
          <ErrorView error={rendered.error} onRetry={() => void rendered.refetch()} />
        ) : (
          <div className="pad">
            <Markdown html={rendered.data} base={base} />
          </div>
        )
      ) : (
        <CodeView text={data!.text} path={path} wrap={prefs.wrapCode} />
      )}
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title="File"
        actions={[
          { label: "Open in browser", icon: <LinkExternalIcon size={18} />, onSelect: () => void backend.openUrl(webUrl) },
          { label: "Copy path", icon: <CopyIcon size={18} />, onSelect: () => void backend.copyText(path).then(() => toast.show("Path copied")) },
          { label: "Copy link", icon: <CopyIcon size={18} />, onSelect: () => void backend.copyText(webUrl).then(() => toast.show("Link copied")) },
          {
            label: "Copy contents",
            icon: <CopyIcon size={18} />,
            hidden: data?.kind !== "text",
            onSelect: () => data?.kind === "text" && void backend.copyText(data.text).then(() => toast.show("Copied")),
          },
        ]}
      />
    </Screen>
  );
}
