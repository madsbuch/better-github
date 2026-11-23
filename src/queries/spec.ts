// Loading a repository's spec (src/lib/spec.ts) so that its size doesn't matter:
//
//   1. One small query per branch says which tree the .spec folder is. The
//      tree's id changes when anything in the folder does, so while it stays
//      the same nothing else is asked for again.
//   2. One REST call lists every file of that tree with its git object id.
//      That is enough for the outline: ids, folders and how many items.
//   3. Contents are read in batches, by object id, only for what is looked at
//      (a small spec is read whole). A file's id is the same on every branch
//      it hasn't changed on, so switching branches, and comparing two of
//      them, reads only what differs.
// Spec: S5, S12, S14, SR2

import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import { errorMessage, graphql, rest } from "../lib/api";
import { backend } from "../lib/backend";
import { SPEC_BLOBS, SPEC_ROOT } from "../lib/queries";
import { buildSpec, SPEC_DIR, type Spec, type SpecFile, type SpecNode } from "../lib/spec";
import { diffSpecs, type ItemChange, type SpecDiff } from "../lib/specDiff";
import { specConsistencyPrompt, specPrompt } from "../lib/specPrompt";
import { useToast } from "../lib/toast";
import { SPEC_BLOB_BATCH } from "../lib/types";
import { keys } from "./keys";

// ------------------------------------------------------------------ listing

/** A git tree, listed recursively (`git-tree`). Only what the app reads. */
export const RestGitTree = z.object({
  tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string() })),
  /** GitHub stops at 100,000 entries or 7 MB. */
  truncated: z.boolean(),
});

/** Every file of a spec folder: its path from the folder and its git object id. */
export interface SpecListing {
  files: { path: string; oid: string }[];
  /** Every folder in it ("uploads"), with git's id for it. Missing from listings cached before there were imports. */
  folders?: { path: string; oid: string }[] | undefined;
  /** The folder has more files than GitHub lists; the rest is missing. */
  cutOff: boolean;
}

export const specQueries = {
  /** The id of the .spec folder's tree on a branch or commit; null when there is no such folder. */
  root: (owner: string, repo: string, ref: string) =>
    queryOptions({
      queryKey: keys.repo.spec(owner, repo, ref),
      queryFn: async (): Promise<string | null> => {
        const { repository } = await graphql(SPEC_ROOT, { owner, name: repo, expression: `${ref}:${SPEC_DIR}` });
        // A file called .spec isn't a spec: it has no tree id.
        return repository?.object?.oid ?? null;
      },
      // Like review rules: rarely changes, but a screen showing it checks again when it opens.
      staleTime: 30_000,
    }),
  /** The files in a spec folder's tree. A tree never changes, so this is never asked for twice. */
  listing: (owner: string, repo: string, tree: string) =>
    queryOptions({
      queryKey: keys.repo.specListing(owner, repo, tree),
      queryFn: async (): Promise<SpecListing> => {
        const listed = await rest(RestGitTree, `/repos/${owner}/${repo}/git/trees/${tree}`, { query: { recursive: 1 } });
        return {
          files: listed.tree.filter((entry) => entry.type === "blob").map((entry) => ({ path: entry.path, oid: entry.sha })),
          folders: listed.tree.filter((entry) => entry.type === "tree").map((entry) => ({ path: entry.path, oid: entry.sha })),
          cutOff: listed.truncated,
        };
      },
      staleTime: Infinity,
      gcTime: 30 * 60_000,
    }),
};

/** The commit two refs both descend from (`commit-comparison`). */
export const RestMergeBase = z.object({ merge_base_commit: z.object({ sha: z.string() }) });

/**
 * The commit a pull request's branch started from. Its spec is what the pull
 * request's changes are measured against: the base branch itself may have
 * moved on since, and those changes aren't the pull request's.
 */
export function mergeBaseQuery(owner: string, repo: string, base: string, head: string) {
  return queryOptions({
    queryKey: keys.repo.mergeBase(owner, repo, base, head),
    queryFn: async () => {
      const comparison = await rest(RestMergeBase, `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, {
        query: { per_page: 1 },
      });
      return comparison.merge_base_commit.sha;
    },
    staleTime: 5 * 60_000,
  });
}

// ----------------------------------------------------------------- contents

interface Blob {
  text: string | null;
  truncated: boolean;
}

/**
 * File contents by git object id, for this run of the app. Content-addressed,
 * so nothing here is ever stale, and it is shared by every branch and both
 * sides of a comparison.
 */
const blobs = new Map<string, Blob>();
const queued = new Map<string, { owner: string; repo: string }>();
const inFlight = new Set<string>();
const failed = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;
let running = 0;
/** Sign-out starts a new generation: answers to the old account's requests are dropped. */
let generation = 0;

const MAX_REQUESTS = 4;

function changed() {
  version++;
  listeners.forEach((listener) => listener());
}

async function readBatch(owner: string, repo: string, oids: string[]) {
  const startedIn = generation;
  // Every slot of the query needs an id; a short batch repeats its first.
  const variables: Record<string, string> = { owner, name: repo };
  for (let i = 0; i < SPEC_BLOB_BATCH; i++) variables[`o${i}`] = oids[i] ?? oids[0] ?? "";
  try {
    const { repository } = await graphql(SPEC_BLOBS, variables);
    if (startedIn !== generation) return;
    for (const blob of Object.values(repository ?? {})) {
      if (blob?.oid !== undefined) blobs.set(blob.oid, { text: blob.text ?? null, truncated: blob.isTruncated ?? false });
    }
    // An id GitHub had nothing for (not a file, or gone): don't ask again.
    for (const oid of oids) if (!blobs.has(oid)) blobs.set(oid, { text: null, truncated: true });
  } catch (error) {
    if (startedIn !== generation) return;
    for (const oid of oids) failed.set(oid, error);
  } finally {
    for (const oid of oids) inFlight.delete(oid);
  }
}

function pump() {
  while (running < MAX_REQUESTS && queued.size > 0) {
    // One request reads files of one repository.
    const [first] = queued.values();
    if (first === undefined) return;
    const batch: string[] = [];
    for (const [oid, from] of queued) {
      if (from.owner !== first.owner || from.repo !== first.repo) continue;
      batch.push(oid);
      if (batch.length === SPEC_BLOB_BATCH) break;
    }
    for (const oid of batch) {
      queued.delete(oid);
      inFlight.add(oid);
    }
    running++;
    void readBatch(first.owner, first.repo, batch).finally(() => {
      running--;
      changed();
      pump();
    });
  }
}

/** Asks for the contents of these files, unless they're here, on their way, or failed (see `retrySpecContents`). */
export function requestSpecContents(owner: string, repo: string, oids: Iterable<string>) {
  let added = false;
  for (const oid of oids) {
    if (blobs.has(oid) || inFlight.has(oid) || queued.has(oid) || failed.has(oid)) continue;
    queued.set(oid, { owner, repo });
    added = true;
  }
  if (added) pump();
}

/** Forgets failures, so the files are asked for again when next wanted. */
export function retrySpecContents() {
  failed.clear();
  changed();
}

/** Forgets every file's contents (on sign-out: they may be from private repositories). */
export function clearSpecContents() {
  generation++;
  blobs.clear();
  queued.clear();
  failed.clear();
  changed();
}

/** A file's text, if it has been read. */
export function specFileText(oid: string | null | undefined): string | null {
  return oid === null || oid === undefined ? null : (blobs.get(oid)?.text ?? null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever contents arrive or fail. */
function useContentsVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

const fileOf = (entry: { path: string; oid: string }): SpecFile => {
  const blob = entry.path.endsWith(".json") ? blobs.get(entry.oid) : undefined;
  return { path: entry.path, oid: entry.oid, text: blob?.text ?? null, truncated: blob?.truncated ?? false };
};

/** The listed files with the contents read so far. `_arrivals` is what makes a caller's memo see new ones. */
const filesAsOf = (listing: SpecListing, _arrivals: number): SpecFile[] => listing.files.map(fileOf);

// --------------------------------------------------------------------- spec

/** Git's id for each folder of a listing, by its path from the spec folder. */
function folderIds(listing: SpecListing | undefined): ReadonlyMap<string, string> | undefined {
  return listing?.folders === undefined ? undefined : new Map(listing.folders.map((folder) => [folder.path, folder.oid]));
}

/** Specs up to this many items are read whole, so filtering and counts are complete from the start. */
export const SPEC_READ_WHOLE = 300;

export interface LoadedSpec {
  /** Null while loading, and when the branch has no spec. Items may still be on their way (`node.loaded`). */
  spec: Spec | null;
  /** The folder's files with the contents read so far; what `spec` is built from. */
  files: SpecFile[] | null;
  /** Whether the branch has been checked, and its files listed. */
  loaded: boolean;
  isPending: boolean;
  error: Error | null;
  retry: () => void;
  /** Reads these items' contents, if they aren't here yet. */
  want: (nodes: Iterable<SpecNode>) => void;
  /** Reading some contents failed; `retry` asks again. */
  contentsError: unknown;
}

/** The spec on `ref` ("" while the branch isn't known yet). */
export function useSpec(owner: string, repo: string, ref: string): LoadedSpec {
  const root = useQuery({ ...specQueries.root(owner, repo, ref), enabled: ref !== "" });
  const tree = root.data ?? null;
  const listing = useQuery({ ...specQueries.listing(owner, repo, tree ?? ""), enabled: tree !== null });
  const contents = useContentsVersion();
  const files = listing.data;
  // Rebuilt as files arrive (`contents` counts arrivals); each file is only parsed once (see readItem).
  const read = useMemo(() => (files === undefined ? null : filesAsOf(files, contents)), [files, contents]);
  const folders = useMemo(() => folderIds(files), [files]);
  const spec = useMemo(() => (read === null ? null : buildSpec(read, files?.cutOff ?? false, folders)), [read, files?.cutOff, folders]);

  const want = useCallback(
    (nodes: Iterable<SpecNode>) => {
      const oids: string[] = [];
      for (const node of nodes) if (!node.loaded && node.oid !== null) oids.push(node.oid);
      if (oids.length > 0) requestSpecContents(owner, repo, oids);
    },
    [owner, repo],
  );

  // A spec of ordinary size is simply read whole.
  useEffect(() => {
    if (spec !== null && spec.nodes.size <= SPEC_READ_WHOLE) want(spec.nodes.values());
  }, [spec, want]);

  const firstFailure = useMemo(() => {
    if (spec === null) return null;
    for (const node of spec.nodes.values()) if (node.oid !== null && failed.has(node.oid)) return failed.get(node.oid);
    return null;
  }, [spec]);

  return {
    spec: tree === null ? null : spec,
    files: tree === null ? null : read,
    loaded: root.isSuccess && (tree === null || listing.isSuccess),
    isPending: root.isPending || (tree !== null && listing.isPending),
    error: root.error ?? listing.error,
    retry: () => {
      retrySpecContents();
      void root.refetch();
      if (listing.isError) void listing.refetch();
    },
    want,
    contentsError: firstFailure,
  };
}

/** Reads `nodes`' contents when they change. Screens say what they are about to show. */
export function useSpecContents(loaded: LoadedSpec, nodes: SpecNode[]) {
  const { want } = loaded;
  useEffect(() => want(nodes), [want, nodes]);
}

// --------------------------------------------------------------------- diff

export interface LoadedSpecDiff {
  before: LoadedSpec;
  after: LoadedSpec;
  /** Null until both sides are listed. Items whose contents are on their way are `pending`. */
  diff: SpecDiff | null;
  error: Error | null;
  retry: () => void;
}

/**
 * What changed in the spec from `base` to `head`. Only the files that differ
 * between the two are read, however large the spec.
 * `renames`: new path to old path of files a pull request moved, from the spec folder.
 */
export function useSpecDiff(owner: string, repo: string, base: string, head: string, renames?: Map<string, string>): LoadedSpecDiff {
  const before = useSpec(owner, repo, base);
  const after = useSpec(owner, repo, head);
  const ready = before.loaded && after.loaded;
  const diff = useMemo(() => (ready ? diffSpecs(before.spec, after.spec, renames) : null), [ready, before.spec, after.spec, renames]);

  const [wantBefore, wantAfter] = [before.want, after.want];
  // The changed items, and the folders above them for their names.
  useEffect(() => {
    if (diff === null) return;
    const [old, current]: [SpecNode[], SpecNode[]] = [[], []];
    const above = (node: SpecNode | null, into: SpecNode[]) => {
      for (let at = node; at !== null; at = at.parent) into.push(at);
    };
    for (const item of diff.items) {
      above(item.before, old);
      above(item.after, current);
    }
    wantBefore(old);
    wantAfter(current);
  }, [diff, wantBefore, wantAfter]);

  const [retryBefore, retryAfter] = [before.retry, after.retry];
  return {
    before,
    after,
    diff,
    error: before.error ?? after.error,
    retry: () => {
      retryBefore();
      retryAfter();
    },
  };
}

/** What a pull request changes in the spec, for its Files and Spec tabs. */
export interface PullSpec extends LoadedSpecDiff {
  /** Whether any of its files is in the spec folder. */
  touchesSpec: boolean;
  /** What the changes are measured against: the commit the branch started from ("" until that is known). */
  base: string;
  /** The change to each item, by its file's path from the repository's root. */
  byFile: Map<string, ItemChange>;
}

const inSpecFolder = (path: string | undefined) => path?.startsWith(`${SPEC_DIR}/`) === true;

/**
 * The spec changes of a pull request (null while it loads) with these changed files.
 * They are measured against where its branch started, not the base branch as it is
 * now: what happened there since isn't the pull request's doing.
 */
export function usePullSpec(
  owner: string,
  repo: string,
  pr: { baseRefName: string; headRefOid: string } | null,
  files: { filename: string; previous_filename?: string | undefined }[],
): PullSpec {
  const touchesSpec = pr !== null && files.some((file) => inSpecFolder(file.filename) || inSpecFolder(file.previous_filename));
  const [baseRef, head] = [pr?.baseRefName ?? "", pr?.headRefOid ?? ""];
  const mergeBase = useQuery({ ...mergeBaseQuery(owner, repo, baseRef, head), enabled: touchesSpec });
  // Should that fail, the base branch as it is now is the next best thing.
  const base = !touchesSpec ? "" : (mergeBase.data ?? (mergeBase.isError ? baseRef : ""));
  const renames = useMemo(() => {
    const moved = new Map<string, string>();
    for (const file of files) {
      if (inSpecFolder(file.filename) && inSpecFolder(file.previous_filename)) {
        moved.set(file.filename.slice(SPEC_DIR.length + 1), (file.previous_filename ?? "").slice(SPEC_DIR.length + 1));
      }
    }
    return moved;
  }, [files]);
  const compared = useSpecDiff(owner, repo, base, touchesSpec ? head : "", renames);
  const byFile = useMemo(() => {
    const changes = new Map<string, ItemChange>();
    for (const change of compared.diff?.items ?? []) {
      const file = (change.after ?? change.before)?.file;
      if (file !== null && file !== undefined) changes.set(file, change);
    }
    return changes;
  }, [compared.diff]);
  return useMemo(() => ({ ...compared, touchesSpec, base, byFile }), [compared, touchesSpec, base, byFile]);
}

// ------------------------------------------------------------------- prompt

async function wholeSpec(queryClient: QueryClient, owner: string, repo: string, branch: string): Promise<Spec | null> {
  const tree = await queryClient.fetchQuery(specQueries.root(owner, repo, branch));
  if (tree === null) return null;
  const listing = await queryClient.fetchQuery(specQueries.listing(owner, repo, tree));
  const items = listing.files.filter((file) => file.path.endsWith(".json"));
  // The prompt names every item of a spec of ordinary size; a huge one is outlined by its files.
  if (items.length <= SPEC_READ_WHOLE) {
    requestSpecContents(owner, repo, items.map((file) => file.oid));
    await new Promise<void>((resolve) => {
      const done = () => items.every((file) => blobs.has(file.oid) || failed.has(file.oid));
      if (done()) return resolve();
      const stop = subscribe(() => {
        if (!done()) return;
        stop();
        resolve();
      });
    });
  }
  return buildSpec(listing.files.map(fileOf), listing.cutOff, folderIds(listing));
}

/**
 * Copies a prompt for a coding agent to write the repository's spec, or to
 * improve the one on `branch`.
 */
/** Copies a prompt for a coding agent to check that the spec on `branch` agrees with itself. */
export function useCopySpecConsistencyPrompt() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return async (owner: string, repo: string, branch: string) => {
    try {
      const current = await wholeSpec(queryClient, owner, repo, branch);
      if (current === null) throw new Error(`${branch} has no spec.`);
      await backend.copyText(specConsistencyPrompt({ repo: `${owner}/${repo}`, branch, current }));
      toast.show("Prompt copied. Paste it into your coding agent.", "success");
      // The agent may change it: check again when the app is back in front.
      void queryClient.invalidateQueries({ queryKey: keys.repo.spec(owner, repo, branch), refetchType: "none" });
    } catch (error) {
      toast.show(`Couldn't copy the prompt: ${errorMessage(error)}`, "error");
    }
  };
}

export function useCopySpecPrompt() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return async (owner: string, repo: string, branch: string) => {
    try {
      const current = await wholeSpec(queryClient, owner, repo, branch);
      await backend.copyText(specPrompt({ repo: `${owner}/${repo}`, branch, current }));
      toast.show("Prompt copied. Paste it into your coding agent.", "success");
      // The agent is about to change it: check again when the app is back in front.
      void queryClient.invalidateQueries({ queryKey: keys.repo.spec(owner, repo, branch), refetchType: "none" });
    } catch (error) {
      toast.show(`Couldn't copy the prompt: ${errorMessage(error)}`, "error");
    }
  };
}
