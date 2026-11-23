// The catalogue of shared specs: repositories whose spec is made of parts that
// products copy into their own spec (see "Parts shared between products" in
// spec-llms.txt). The app lists their parts, and pulls one into a repository
// as a pull request that copies the part's files and records the copy in the
// repository's root item.
// Spec: SC1, SC2, SC4, SC5, SC6

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { parseJson } from "./schema";
import { SPEC_DIR, SPEC_SCHEMA_URL, type Spec, type SpecFile, type SpecImport, type SpecItem, type SpecNode } from "./spec";
import { specItemText } from "./specRework";

// ------------------------------------------------------------- catalogues

const KEY = "ghc.spec-catalogues";
const Stored = z.array(z.string());
const listeners = new Set<() => void>();
let current: string[] = load();

function load(): string[] {
  try {
    return parseJson(Stored, window.localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

function save(next: string[]) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // In-memory only.
  }
  listeners.forEach((listener) => listener());
}

/** "owner/repo", as GitHub allows it. */
export function isRepoName(name: string): boolean {
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}\/[\w.-]{1,100}$/i.test(name) && !/\/\.\.?$/.test(name);
}

/** Adds a catalogue (case-insensitively unique); returns false if it isn't a repository name or is there already. */
export function addSpecCatalogue(name: string): boolean {
  const trimmed = name.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (!isRepoName(trimmed) || current.some((known) => known.toLowerCase() === trimmed.toLowerCase())) return false;
  save([...current, trimmed]);
  return true;
}

export function removeSpecCatalogue(name: string) {
  save(current.filter((known) => known.toLowerCase() !== name.toLowerCase()));
}

export function isSpecCatalogue(name: string): boolean {
  return current.some((known) => known.toLowerCase() === name.toLowerCase());
}

/** The catalogues, in the order they were added. */
export function useSpecCatalogues(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

// ------------------------------------------------------------------ parts

/** The parts a shared spec offers: its top-level folders that have an index.json. */
export function sharedParts(spec: Spec): SpecNode[] {
  return spec.root.children.filter((node) => node.file === `${SPEC_DIR}/${node.id}/index.json`);
}

/** Whether `node` is `at` or below it. */
export const inPart = (at: string, node: SpecNode) => node.id === at || node.id.startsWith(`${at}/`);

/** The import that brought `node` into the spec, if it is in an imported part. */
export function importOf(spec: Spec, node: SpecNode): SpecImport | null {
  return spec.root.item?.imports?.find((entry) => inPart(entry.at, node)) ?? null;
}

// ----------------------------------------------------------------- import

/** The shared part to pull in, as it is at one commit of its catalogue. */
export interface ImportSource {
  /** "owner/repo". */
  from: string;
  commit: string;
  /** Git's id for the part's folder at that commit. */
  tree: string;
  part: SpecNode;
  /** The catalogue's spec files at that commit, with their object ids. */
  files: SpecFile[];
}

/** The repository the part goes into, read on the branch the pull request will go into. */
export interface ImportTarget {
  /** "owner/repo". */
  name: string;
  /** Null when it has no spec yet. */
  spec: Spec | null;
  files: SpecFile[] | null;
}

export type ImportPlan =
  | { kind: "blocked"; reasons: string[] }
  | { kind: "current"; commit: string }
  | {
      kind: "ready";
      /** The commit the part was copied from before, when this updates it. */
      updates: string | null;
      /** Files to copy from the catalogue, byte for byte: their path in the repository, and their object id in the catalogue. */
      copies: { path: string; oid: string }[];
      /** Files of an earlier copy that the new one doesn't have. */
      deletes: string[];
      /** The root item, with the import recorded. */
      root: { path: string; text: string };
      title: string;
      body: string;
    };

/** What pulling `source` into `target` takes, or why it can't be done. */
export function planImport(source: ImportSource, target: ImportTarget): ImportPlan {
  const at = source.part.id;
  const root = target.spec?.root ?? null;
  const reasons: string[] = [];
  if (root !== null && root.file !== null && root.item === null) {
    reasons.push(`Its ${SPEC_DIR}/index.json can't be read, and the import is recorded there. Fix that first.`);
  }
  const imports = root?.item?.imports ?? [];
  const existing = imports.find((entry) => entry.at === at);
  if (existing !== undefined && existing.from.toLowerCase() !== source.from.toLowerCase()) {
    reasons.push(`It already has ${SPEC_DIR}/${at} from ${existing.from}.`);
  }
  const own = target.spec?.nodes.get(at);
  if (existing === undefined && own !== undefined) {
    reasons.push(`It already has its own part at ${SPEC_DIR}/${at}${own.file !== null ? ` (${own.file})` : ""}. Move it out of the way first, or deprecate it in favour of the shared one.`);
  }
  const outer = imports.find((entry) => at.startsWith(`${entry.at}/`) || entry.at.startsWith(`${at}/`));
  if (outer !== undefined) reasons.push(`It already imports ${SPEC_DIR}/${outer.at}, which overlaps this part.`);
  // Ids are unique in the whole spec: the part's can't be taken by the repository's own entries.
  if (target.spec !== null) {
    const taken: string[] = [];
    const sourceNodes = [source.part, ...descendants(source.part)];
    for (const entry of sourceNodes.flatMap((node) => [...(node.item?.requirements ?? []), ...(node.item?.stories ?? []), ...(node.item?.values ?? [])])) {
      const there = target.spec.requirements.get(entry.id) ?? target.spec.stories.get(entry.id) ?? target.spec.values.get(entry.id);
      if (there !== undefined && !inPart(at, there.node)) taken.push(`${entry.id} (${there.node.file ?? there.node.id})`);
    }
    if (taken.length > 0) reasons.push(`It already uses ${taken.length === 1 ? "an id" : "ids"} of the part: ${taken.join(", ")}. Ids are unique in the whole spec.`);
  }
  if (reasons.length > 0) return { kind: "blocked", reasons };
  if (existing?.tree === source.tree) return { kind: "current", commit: existing.commit };

  const prefix = `${at}/`;
  const copies = source.files.filter((file) => file.path.startsWith(prefix) && file.oid !== undefined).map((file) => ({ path: `${SPEC_DIR}/${file.path}`, oid: file.oid ?? "" }));
  const copied = new Set(copies.map((file) => file.path));
  const deletes = (target.files ?? []).map((file) => `${SPEC_DIR}/${file.path}`).filter((path) => path.startsWith(`${SPEC_DIR}/${prefix}`) && !copied.has(path));

  const entry: SpecImport = {
    at,
    from: source.from,
    commit: source.commit,
    tree: source.tree,
    ...(existing?.order !== undefined ? { order: existing.order } : {}),
    ...(existing?.values !== undefined ? { values: existing.values } : {}),
    ...(existing?.waived !== undefined ? { waived: existing.waived } : {}),
  };
  const item: SpecItem = root?.item ?? { title: target.name.split("/")[1] ?? target.name };
  const nextImports = existing !== undefined ? imports.map((other) => (other === existing ? entry : other)) : [...imports, entry];
  const text = specItemText({ ...item, imports: nextImports }, item.$schema ?? SPEC_SCHEMA_URL);

  const title = existing !== undefined ? `Spec: update the shared part "${source.part.title}" to ${source.commit.slice(0, 7)}` : `Spec: use the shared part "${source.part.title}" from ${source.from}`;
  return { kind: "ready", updates: existing?.commit ?? null, copies, deletes, root: { path: `${SPEC_DIR}/index.json`, text }, title, body: importPullBody(source, existing?.commit ?? null, copies.length, deletes.length) };
}

function descendants(node: SpecNode): SpecNode[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function importPullBody(source: ImportSource, updates: string | null, copies: number, deletes: number): string {
  const at = `${SPEC_DIR}/${source.part.id}`;
  const files = `${copies} ${copies === 1 ? "file" : "files"}${deletes > 0 ? `, ${deletes} removed` : ""}`;
  const what =
    updates === null
      ? `Copies \`${at}\` (${files}) from ${source.from} at ${source.commit}, and records it in \`imports\` in \`${SPEC_DIR}/index.json\`.`
      : `Updates \`${at}\` (${files}) from ${source.from} at ${updates} to ${source.commit}.`;
  const steps =
    updates === null
      ? [
          "1. Read the part. Where the product meets a requirement, cite it in the code and its test (`// Spec: <id>`). Where it doesn't, implement it, or waive it in the import's `waived`, with the reason.",
          "2. Set the part's named values that this product needs differently in the import's `values`, with the reason.",
          "3. Link the product's own parts to the shared ones they touch with `related`, written at the product's end.",
        ]
      : [
          "1. The spec comparison of this pull request shows what changed in the part, requirement by requirement.",
          "2. Reconcile what in the product is related to what changed, and search the code for the changed ids: that is the code and the tests to change.",
          "3. Check that the import's `values` and `waived` still name things the part has.",
        ];
  return [
    what,
    `Don't edit the copy: change the part in ${source.from} and import it again. A copy that differs from what was copied is listed as a problem.`,
    `## For a coding agent\n\nAdd the implementation to this pull request:\n\n${steps.join("\n")}`,
  ].join("\n\n");
}
