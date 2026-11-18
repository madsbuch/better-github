import {
  CopyIcon,
  DeviceMobileIcon,
  DownloadIcon,
  FileBinaryIcon,
  FileCodeIcon,
  FileZipIcon,
  KebabHorizontalIcon,
  LinkExternalIcon,
  PackageIcon,
  TagIcon,
} from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ApiError } from "../../lib/api";
import { backend, type DownloadTarget } from "../../lib/backend";
import { useDownload, type DownloadFile } from "../../lib/downloads";
import { compactNumber, formatBytes } from "../../lib/format";
import { to } from "../../lib/nav";
import { useToast } from "../../lib/toast";
import { releaseQueries, type Release, type ReleaseLookup } from "../../queries/releases";
import { repoQueries } from "../../queries/repos";
import { Markdown } from "../../components/Markdown";
import { Screen } from "../../components/Screen";
import { ActionSheet } from "../../components/Sheet";
import { Avatar, CenterSpinner, EmptyState, ErrorView, Spinner, Time } from "../../components/ui";
import { ReleaseBadges, releaseTitle } from "./ReleasesTab";

function assetIcon(name: string): ReactNode {
  if (/\.apk$/i.test(name)) return <DeviceMobileIcon size={16} />;
  if (/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i.test(name)) return <FileZipIcon size={16} />;
  if (/\.(dmg|exe|msi|deb|rpm|appimage|pkg)$/i.test(name)) return <PackageIcon size={16} />;
  return <FileBinaryIcon size={16} />;
}

/** One release: its notes and its assets, which download to the phone. */
export function ReleaseScreen({ owner, repo, lookup }: { owner: string; repo: string; lookup: ReleaseLookup }) {
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const release = useQuery(releaseQueries.one(owner, repo, lookup));
  const detail = useQuery(repoQueries.detail(owner, repo));
  const r = release.data;
  const latest = r !== undefined && detail.data?.repository?.latestRelease?.tagName === r.tag_name;
  const fallback = lookup === "latest" ? "Latest release" : "tag" in lookup ? lookup.tag : "Release";
  const url = r?.html_url ?? `https://github.com/${owner}/${repo}/releases`;
  // A draft's tag may not exist yet, so there's no source to download.
  const archives: ("zip" | "tar")[] = r?.draft === true ? [] : ["zip", "tar"];

  return (
    <Screen
      title={r ? releaseTitle(r) : fallback}
      subtitle={`${owner}/${repo}`}
      actions={
        <button className="icon-btn" aria-label="More" onClick={() => setMenu(true)}>
          <KebabHorizontalIcon size={20} />
        </button>
      }
      onRefresh={() => release.refetch()}
    >
      {release.isPending ? (
        <CenterSpinner />
      ) : release.isError ? (
        ApiError.from(release.error).status === 404 ? (
          <EmptyState icon={<TagIcon size={32} />} title="Release not found">
            It may have been deleted, or the repository has no releases.
          </EmptyState>
        ) : (
          <ErrorView error={release.error} onRetry={() => void release.refetch()} />
        )
      ) : (
        <>
          <ReleaseHeader owner={owner} repo={repo} release={release.data} latest={latest} />
          <div className="pad">
            {release.data.body_html !== undefined && release.data.body_html !== "" ? (
              <Markdown html={release.data.body_html} base={{ owner, repo, ref: release.data.tag_name, dir: "" }} />
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No release notes.
              </p>
            )}
          </div>
          <div className="group-header">Assets · {release.data.assets.length + archives.length}</div>
          {release.data.assets.map((asset) => (
            <DownloadRow
              key={asset.id}
              icon={assetIcon(asset.name)}
              name={asset.name}
              meta={
                <>
                  {formatBytes(asset.size)} · {compactNumber(asset.download_count)} download{asset.download_count === 1 ? "" : "s"}
                </>
              }
              target={{ kind: "asset", owner, repo, assetId: asset.id, browserUrl: asset.browser_download_url }}
              file={{ name: asset.name, contentType: asset.content_type }}
            />
          ))}
          {archives.map((format) => {
            const name = `${repo}-${release.data.tag_name.replace(/\//g, "-")}.${format === "zip" ? "zip" : "tar.gz"}`;
            return (
              <DownloadRow
                key={format}
                icon={<FileCodeIcon size={16} />}
                name={`Source code (${format === "zip" ? "zip" : "tar.gz"})`}
                meta={name}
                target={{ kind: "archive", owner, repo, ref: release.data.tag_name, format }}
                file={{ name, contentType: format === "zip" ? "application/zip" : "application/gzip" }}
              />
            );
          })}
        </>
      )}
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title="Release"
        actions={[
          { label: "Open in browser", icon: <LinkExternalIcon size={18} />, onSelect: () => void backend.openUrl(url) },
          { label: "Copy link", icon: <CopyIcon size={18} />, onSelect: () => void backend.copyText(url).then(() => toast.show("Link copied")) },
        ]}
      />
    </Screen>
  );
}

function ReleaseHeader({ owner, repo, release, latest }: { owner: string; repo: string; release: Release; latest: boolean }) {
  return (
    <div className="detail-header">
      <div className="row-flex" style={{ gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <ReleaseBadges release={release} latest={latest} />
      </div>
      <h2 style={{ marginTop: 0 }}>{releaseTitle(release)}</h2>
      <div className="row-flex small muted" style={{ flexWrap: "wrap" }}>
        <Avatar src={release.author.avatar_url} size={18} />
        <Link {...to.user(release.author.login)} className="bold" style={{ color: "var(--fg)" }}>
          {release.author.login}
        </Link>
        <span>
          {release.draft ? "drafted this" : "released this"} <Time iso={release.published_at ?? release.created_at} />
        </span>
      </div>
      <div className="row-flex small" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <Link {...to.tree(owner, repo, release.tag_name)} className="pill mono">
          <TagIcon size={12} /> {release.tag_name}
        </Link>
      </div>
    </div>
  );
}

function DownloadRow({
  icon,
  name,
  meta,
  target,
  file,
}: {
  icon: ReactNode;
  name: string;
  meta: ReactNode;
  target: DownloadTarget;
  file: DownloadFile;
}) {
  const download = useDownload(target, file);
  const action = download.complete ? "Open" : download.retry ? "Retry download" : "Download";
  return (
    <div className="download-row">
      <button className="row" onClick={download.complete ? download.open : download.start} disabled={download.busy} aria-label={`${action} ${name}`}>
        <span className="row-icon c-muted">{icon}</span>
        <span className="row-body">
          <span className="bold" style={{ display: "block", overflowWrap: "anywhere" }}>
            {name}
          </span>
          <span className="muted small" style={{ overflowWrap: "anywhere" }}>
            {meta}
          </span>
          {download.message !== null && download.message !== "" && <span className="download-status small" role="status">{download.message}</span>}
        </span>
        <span className="row-trailing c-accent">
          {download.busy ? <Spinner small /> : download.complete ? "Open" : <DownloadIcon size={18} />}
        </span>
      </button>
      {download.complete && (
        <button className="icon-btn" aria-label={`Download ${name} again`} onClick={download.start} disabled={download.busy}>
          <DownloadIcon size={18} />
        </button>
      )}
    </div>
  );
}
