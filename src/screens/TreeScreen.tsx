import { LinkExternalIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { graphql } from "../lib/api";
import { backend } from "../lib/backend";
import { REPO } from "../lib/queries";
import { nav, useScreen } from "../lib/router";
import { paths } from "../lib/routes";
import type { RepoResult } from "../lib/types";
import { BranchBar, Breadcrumbs, TreeView, repoKey } from "../components/RepoParts";
import { Screen } from "../components/Screen";
import { CenterSpinner, ErrorView } from "../components/ui";

export function TreeScreen() {
  const { route } = useScreen();
  const { owner, repo } = route.params;
  const path = route.query.get("path") ?? "";
  const explicitRef = route.query.get("ref");

  // Only needed to resolve the default branch when no ref is given.
  const detail = useQuery({
    queryKey: [...repoKey(owner, repo), "detail"],
    queryFn: () => graphql<RepoResult>(REPO, { owner, name: repo }),
    enabled: !explicitRef,
  });
  const gitRef = explicitRef ?? detail.data?.repository?.defaultBranchRef?.name ?? null;
  const name = path.split("/").filter(Boolean).pop() ?? repo;

  return (
    <Screen
      title={name}
      subtitle={`${owner}/${repo}`}
      actions={
        <button
          className="icon-btn"
          aria-label="Open in browser"
          onClick={() => void backend.openUrl(`https://github.com/${owner}/${repo}/tree/${gitRef ?? "HEAD"}/${path}`)}
        >
          <LinkExternalIcon size={18} />
        </button>
      }
    >
      {!gitRef ? (
        detail.isError ? <ErrorView error={detail.error} onRetry={() => void detail.refetch()} /> : <CenterSpinner />
      ) : (
        <>
          <BranchBar owner={owner} repo={repo} gitRef={gitRef} onChange={(ref) => nav.replace(paths.tree(owner, repo, ref, path || undefined))} />
          {path && <Breadcrumbs owner={owner} repo={repo} gitRef={gitRef} path={path} />}
          <TreeView owner={owner} repo={repo} gitRef={gitRef} path={path} />
        </>
      )}
    </Screen>
  );
}
