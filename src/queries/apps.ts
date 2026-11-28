import { queryOptions } from "@tanstack/react-query";
import { graphql } from "../lib/api";
import { appReleaseTag, packageIdsFromFiles } from "../lib/appMatch";
import { APP_IDS, APP_IDS_BATCH, APP_REPOS } from "../lib/queries";
import type { AppReposResult } from "../lib/types";
import { keys } from "./keys";

/** A repository that publishes an APK, the release it's on, and the package names its build files declare. */
export interface AppRepo {
  owner: string;
  name: string;
  tag: string;
  packageIds: string[];
}

/** Enough for anyone's repositories; more pages than this stop the search. */
const MAX_PAGES = 10;

async function appRepos(): Promise<AppRepo[]> {
  const candidates: { id: string; owner: string; name: string; tag: string }[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: AppReposResult = await graphql(APP_REPOS, { after });
    const { repositories } = data.viewer;
    for (const repo of repositories.nodes) {
      const tag = appReleaseTag(repo.latestRelease, repo.releases.nodes);
      if (tag !== undefined) candidates.push({ id: repo.id, owner: repo.owner.login, name: repo.name, tag });
    }
    if (!repositories.pageInfo.hasNextPage || repositories.pageInfo.endCursor === null) break;
    after = repositories.pageInfo.endCursor;
  }

  const ids = new Map<string, string[]>();
  for (let start = 0; start < candidates.length; start += APP_IDS_BATCH) {
    const batch = candidates.slice(start, start + APP_IDS_BATCH);
    const data = await graphql(APP_IDS, { ids: batch.map((repo) => repo.id) });
    for (const node of data.nodes) {
      if (node?.__typename !== "Repository" || !("id" in node)) continue;
      const files = [node.f0, node.f1, node.f2, node.f3, node.f4, node.f5, node.f6, node.f7, node.f8];
      const texts = files.flatMap((file) => (file?.text !== undefined && file.text !== null ? [file.text] : []));
      ids.set(node.id, packageIdsFromFiles(texts));
    }
  }
  return candidates.map((repo) => ({ owner: repo.owner, name: repo.name, tag: repo.tag, packageIds: ids.get(repo.id) ?? [] }));
}

export const appQueries = {
  /** The viewer's repositories that publish an Android app. */
  repos: () =>
    queryOptions({
      queryKey: keys.viewer.apps(),
      queryFn: appRepos,
      // New apps and new build files are rare; updates themselves come from each release.
      staleTime: 30 * 60_000,
    }),
};
