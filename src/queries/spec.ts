import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { graphql } from "../lib/api";
import { SPEC } from "../lib/queries";
import { buildSpec, SPEC_DIR, type Spec, type SpecFile } from "../lib/spec";
import type { SpecTree } from "../lib/types";
import { keys } from "./keys";

/** The spec folder's files, and the folders nested too deep to have been read. */
export interface SpecFolder {
  files: SpecFile[];
  tooDeep: string[];
}

function flatten(tree: NonNullable<SpecTree>): SpecFolder {
  const folder: SpecFolder = { files: [], tooDeep: [] };
  // The levels are separate types (the query has a fixed depth), so each is walked by its own call.
  for (const a of tree.entries ?? []) {
    if (!add(folder, a.name, a.object)) continue;
    for (const b of a.object?.entries ?? []) {
      if (!add(folder, `${a.name}/${b.name}`, b.object)) continue;
      for (const c of b.object?.entries ?? []) {
        if (!add(folder, `${a.name}/${b.name}/${c.name}`, c.object)) continue;
        for (const d of c.object?.entries ?? []) {
          const path = `${a.name}/${b.name}/${c.name}/${d.name}`;
          if (!add(folder, path, d.object) && (d.object?.entries ?? []).length > 0) folder.tooDeep.push(path);
        }
      }
    }
  }
  return folder;
}

/** Adds a file; returns true for a folder, whose entries the caller walks. */
function add(
  folder: SpecFolder,
  path: string,
  object: { text?: string | null | undefined; isTruncated?: boolean | undefined; entries?: unknown } | null,
): boolean {
  // Submodules have no object here.
  if (object === null) return false;
  if (object.entries !== undefined) return true;
  folder.files.push({ path, text: object.text ?? null, truncated: object.isTruncated ?? false });
  return false;
}

export const specQueries = {
  /** The .spec folder on a branch; null when the repository has none. */
  folder: (owner: string, repo: string, ref: string) =>
    queryOptions({
      queryKey: keys.repo.spec(owner, repo, ref),
      queryFn: async (): Promise<SpecFolder | null> => {
        const { repository } = await graphql(SPEC, { owner, name: repo, expression: `${ref}:${SPEC_DIR}` });
        const tree = repository?.object ?? null;
        // A file called .spec isn't a spec.
        return tree === null || tree.entries === undefined ? null : flatten(tree);
      },
      // Like review rules: rarely changes, but a screen showing it checks again when it opens.
      staleTime: 30_000,
    }),
};

export interface LoadedSpec {
  /** Null while loading, and when the branch has no spec. */
  spec: Spec | null;
  /** Whether the branch has been checked. */
  loaded: boolean;
  isPending: boolean;
  error: Error | null;
  retry: () => void;
}

/** The spec on `ref` ("" while the branch isn't known yet). */
export function useSpec(owner: string, repo: string, ref: string): LoadedSpec {
  const folder = useQuery({ ...specQueries.folder(owner, repo, ref), enabled: ref !== "" });
  const data = folder.data;
  const spec = useMemo(() => (data === null || data === undefined ? null : buildSpec(data.files, data.tooDeep)), [data]);
  return { spec, loaded: folder.isSuccess, isPending: folder.isPending, error: folder.error, retry: () => void folder.refetch() };
}
