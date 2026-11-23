// Reading a catalogue of shared specs: the commit its parts are pulled from,
// and its spec at that commit.
// Spec: SC2

import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { rest } from "../lib/api";
import { keys } from "./keys";
import { useSpec, type LoadedSpec } from "./spec";

const RestTip = z.object({ sha: z.string() });

export const catalogueQueries = {
  /** The newest commit on the catalogue's default branch. */
  tip: (owner: string, repo: string) =>
    queryOptions({
      queryKey: keys.repo.specTip(owner, repo),
      queryFn: async () => (await rest(RestTip, `/repos/${owner}/${repo}/commits/HEAD`)).sha,
      staleTime: 60_000,
    }),
};

export interface LoadedCatalogue extends LoadedSpec {
  /** The commit it is read at; "" until known. */
  commit: string;
  tipError: Error | null;
}

/** A catalogue's spec at the newest commit of its default branch: one commit, so the parts and the ids recorded for them agree. */
export function useCatalogue(name: string): LoadedCatalogue {
  const [owner = "", repo = ""] = name.split("/");
  const tip = useQuery(catalogueQueries.tip(owner, repo));
  const commit = tip.data ?? "";
  const loaded = useSpec(owner, repo, commit);
  return { ...loaded, commit, tipError: tip.error, isPending: tip.isPending || loaded.isPending };
}
