// Where a code base cites a requirement of its spec: a comment "Spec: RET-1"
// on the code that meets it, or above the test that proves it. The spec holds
// nothing about code; this is looked up in the code, by the requirement's id.
// Spec: S32

/** What to ask GitHub's code search for: files that say "Spec:" and the id. */
export function citedQuery(owner: string, repo: string, id: string): string {
  return `"Spec:" "${id}" repo:${owner}/${repo}`;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a stretch of a file cites the requirement: "Spec:" with the id among
 * the ids after it, as an id of its own. "Spec: S1" doesn't cite S15, and a
 * file that happens to contain both words apart doesn't cite anything.
 */
export function citesRequirement(fragment: string, id: string): boolean {
  return new RegExp(`Spec:[^\\n]*(?<![A-Za-z0-9._-])${escaped(id)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`).test(fragment);
}

/** Tests first? No: in the order of their paths, which keeps a file next to its test. */
export function citedPaths(items: { path: string; fragments: string[] }[], id: string): string[] {
  return items
    // Without the matching text there is nothing to check it against: GitHub found both words, so it stays.
    .filter((item) => item.fragments.length === 0 || item.fragments.some((fragment) => citesRequirement(fragment, id)))
    .map((item) => item.path)
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort((a, b) => a.localeCompare(b));
}
