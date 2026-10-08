import { CodeIcon, CopyIcon, EyeIcon, KebabHorizontalIcon, LinkExternalIcon, UnwrapIcon, WrapIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { encodePath, graphql, rest } from "../lib/api";
import { backend } from "../lib/backend";
import { formatBytes } from "../lib/format";
import { setPref, usePrefs } from "../lib/prefs";
import { REPO } from "../lib/queries";
import { useScreen } from "../lib/router";
import { useToast } from "../lib/toast";
import type { RepoResult, RestContentFile } from "../lib/types";
import { CodeView } from "../components/CodeView";
import { Markdown, type MarkdownBase } from "../components/Markdown";
import { Breadcrumbs, repoKey } from "../components/RepoParts";
import { Screen } from "../components/Screen";
import { ActionSheet } from "../components/Sheet";
import { CenterSpinner, EmptyState, ErrorView } from "../components/ui";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i;
const MARKDOWN = /\.(md|markdown|mdx|mkd)$/i;
const MAX_TEXT_BYTES = 3 * 1024 * 1024;

function decodeBase64(content: string): Uint8Array {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

type Loaded =
  | { kind: "text"; text: string; meta: RestContentFile }
  | { kind: "image"; meta: RestContentFile }
  | { kind: "binary"; meta: RestContentFile }
  | { kind: "too-large"; meta: RestContentFile };

export function BlobScreen() {
  const { route } = useScreen();
  const { owner, repo } = route.params;
  const path = route.query.get("path") ?? "";
  const explicitRef = route.query.get("ref");
  const prefs = usePrefs();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const isMarkdown = MARKDOWN.test(path);
  const [preview, setPreview] = useState(isMarkdown);

  const detail = useQuery({
    queryKey: [...repoKey(owner, repo), "detail"],
    queryFn: () => graphql<RepoResult>(REPO, { owner, name: repo }),
    enabled: !explicitRef,
  });
  const gitRef = explicitRef ?? detail.data?.repository?.defaultBranchRef?.name ?? null;

  const file = useQuery({
    queryKey: [...repoKey(owner, repo), "blob", gitRef, path],
    enabled: !!gitRef,
    queryFn: async (): Promise<Loaded> => {
      const meta = await rest<RestContentFile>(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, { query: { ref: gitRef } });
      if (IMAGE.test(path)) return { kind: "image", meta };
      if (meta.size > MAX_TEXT_BYTES) return { kind: "too-large", meta };
      let bytes: Uint8Array;
      if (meta.content && meta.encoding === "base64") {
        bytes = decodeBase64(meta.content);
      } else {
        // Files over 1 MB come without inline content.
        const raw = await rest<string>(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
          query: { ref: gitRef },
          accept: "application/vnd.github.raw+json",
        });
        return { kind: "text", text: typeof raw === "string" ? raw : JSON.stringify(raw, null, 2), meta };
      }
      if (looksBinary(bytes)) return { kind: "binary", meta };
      return { kind: "text", text: new TextDecoder().decode(bytes), meta };
    },
  });

  const rendered = useQuery({
    queryKey: [...repoKey(owner, repo), "blob-html", gitRef, path],
    enabled: !!gitRef && isMarkdown && preview,
    queryFn: () =>
      rest<string>(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
        query: { ref: gitRef },
        accept: "application/vnd.github.html+json",
      }),
  });

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
