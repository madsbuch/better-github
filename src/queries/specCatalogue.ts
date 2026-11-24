// Reading a catalogue of shared specs: the commit its parts are pulled from,
// and its spec at that commit; and how an imported part compares with it.
// Spec: SC2, SC9

import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";
import { rest } from "../lib/api";
import type { SpecImport } from "../lib/spec";
import { sharedParts } from "../lib/specCatalogue";
import { keys } from "./keys";
import { useSpec, type LoadedSpec } from "./spec";

const RestTip = z.object({ sha: z.string() });
const RestGitCommit = z.object({ committer: z.object({ date: z.string() }) });

export const catalogueQueries = {
  /** The newest commit on the catalogue's default branch. */
  tip: (owner: string, repo: string) =>
    queryOptions({
      queryKey: keys.repo.specTip(owner, repo),
      queryFn: async () => (await rest(RestTip, `/repos/${owner}/${repo}/commits/HEAD`)).sha,
      staleTime: 60_000,
    }),
  /** When a commit was made. A commit never changes. */
  commitDate: (owner: string, repo: string, sha: string) =>
    queryOptions({
      queryKey: keys.repo.commitDate(owner, repo, sha),
      queryFn: async () => (await rest(RestGitCommit, `/repos/${owner}/${repo}/git/commits/${sha}`)).committer.date,
      staleTime: Infinity,
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

/** How an imported part compares with its catalogue now. */
export interface ImportStatus {
  /** When the commit the part was copied from was made. */
  copiedAt: string | null;
  /** The catalogue's newest commit, once known. */
  tip: string;
  /**
   * "current": the catalogue has the part as it was copied; "changed": it has
   * changed it since (on `changedAt`, at its folder `at`); "gone": the catalogue
   * no longer has a part with this id; null while that isn't known yet.
   */
  state: "current" | "changed" | "gone" | null;
  /** The part's folder in the catalogue now: another than the import's when it was renamed. */
  at: string | null;
  changedAt: string | null;
  error: Error | null;
}

/** Where `entry`'s part stands in its catalogue: up to date, changed since, or gone. */
export function useImportStatus(entry: SpecImport): ImportStatus {
  const [owner = "", repo = ""] = entry.from.split("/");
  const catalogue = useCatalogue(entry.from);
  const copied = useQuery(catalogueQueries.commitDate(owner, repo, entry.commit));
  const tipDate = useQuery({ ...catalogueQueries.commitDate(owner, repo, catalogue.commit), enabled: catalogue.commit !== "" });
  // The parts are found by their index.json: read those, however large the catalogue.
  const { spec, want } = catalogue;
  useEffect(() => {
    if (spec !== null) want(spec.root.children);
  }, [spec, want]);
  const known = spec !== null && spec.root.children.every((node) => node.loaded);
  const part = spec === null ? undefined : sharedParts(spec).find((node) => node.item?.shared?.id === entry.id);
  const tree = part === undefined ? undefined : catalogue.folders?.get(part.id);
  const state = !known || catalogue.commit === "" ? null : part === undefined ? "gone" : tree === undefined ? null : tree === entry.tree ? "current" : "changed";
  return {
    copiedAt: copied.data ?? null,
    tip: catalogue.commit,
    state,
    at: part?.id ?? null,
    changedAt: state === "changed" ? (tipDate.data ?? null) : null,
    error: catalogue.tipError ?? catalogue.error ?? copied.error,
  };
}
