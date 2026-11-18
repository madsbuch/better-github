import { LinkExternalIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { backend } from "../lib/backend";
import { to, useNav } from "../lib/nav";
import { repoQueries } from "../queries/repos";
import { BranchBar, Breadcrumbs, TreeView } from "../components/RepoParts";
import { Screen } from "../components/Screen";
import { CenterSpinner, ErrorView } from "../components/ui";

const route = getRouteApi("/$owner/$repo/tree");

export function TreeScreen() {
  const { owner, repo } = route.useParams();
  const search = route.useSearch();
  const path = search.path ?? "";
  const explicitRef = search.ref;
  const nav = useNav();

  // Only needed to resolve the default branch when no ref is given.
  const detail = useQuery({ ...repoQueries.detail(owner, repo), enabled: explicitRef === undefined || explicitRef === "" });
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
      {gitRef === null || gitRef === "" ? (
        detail.isError ? <ErrorView error={detail.error} onRetry={() => void detail.refetch()} /> : <CenterSpinner />
      ) : (
        <>
          <BranchBar owner={owner} repo={repo} gitRef={gitRef} onChange={(ref) => nav.replace(to.tree(owner, repo, ref, path))} />
          {path !== "" && <Breadcrumbs owner={owner} repo={repo} gitRef={gitRef} path={path} />}
          <TreeView owner={owner} repo={repo} gitRef={gitRef} path={path} />
        </>
      )}
    </Screen>
  );
}
