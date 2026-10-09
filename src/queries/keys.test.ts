import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { affects, keys } from "./keys";
import { patchQueries } from "./mutation";

/** A client holding data under `cached`; returns which of them `affected` invalidates. */
async function invalidatedBy(affected: QueryKey[], cached: QueryKey[]): Promise<boolean[]> {
  const client = new QueryClient();
  cached.forEach((key) => client.setQueryData(key, 1));
  await Promise.all(affected.map((queryKey) => client.invalidateQueries({ queryKey })));
  return cached.map((key) => client.getQueryState(key)?.isInvalidated ?? false);
}

describe("query keys", () => {
  it("ignore the case of owner and repository names", () => {
    expect(keys.pull.detail("Octo", "Hello-World", 1)).toEqual(keys.pull.detail("octo", "hello-world", 1));
    expect(keys.repo.all("OCTO", "x")).toEqual(["repo", "octo", "x"]);
  });

  it("nest everything about a repository under it", () => {
    const repo = keys.repo.all("o", "r");
    for (const key of [keys.pull.timeline("o", "r", 1), keys.issue.detail("o", "r", 2), keys.actions.jobLog("o", "r", 3), keys.repo.readme("o", "r")]) {
      expect(key.slice(0, repo.length)).toEqual(repo);
    }
  });
});

describe("affects", () => {
  it("a pull request change refreshes that PR, searches and its repository", async () => {
    const result = await invalidatedBy(affects.pull("Octo", "repo", 1), [
      keys.pull.detail("octo", "repo", 1),
      keys.pull.checks("octo", "repo", 1),
      keys.search.issues("is:open is:pr review-requested:@me"),
      keys.search.inboxCounts(),
      keys.repo.detail("octo", "repo"),
      keys.pull.detail("octo", "repo", 2),
      keys.notifications.list("unread"),
      keys.repo.readme("octo", "repo"),
    ]);
    expect(result).toEqual([true, true, true, true, true, false, false, false]);
  });

  it("thread changes refresh threads and the timeline only", async () => {
    const result = await invalidatedBy(affects.threads("o", "r", 1), [
      keys.pull.threads("o", "r", 1),
      keys.pull.timeline("o", "r", 1),
      keys.pull.detail("o", "r", 1),
    ]);
    expect(result).toEqual([true, true, false]);
  });

  it("branch changes refresh the branch lists and searches only", async () => {
    const result = await invalidatedBy(affects.branches("o", "r"), [
      keys.repo.branchList("o", "r"),
      keys.repo.branchSearch("o", "r", "staging"),
      keys.repo.recentBranches("o", "r"),
      keys.repo.detail("o", "r"),
      keys.repo.branchList("o", "other"),
    ]);
    expect(result).toEqual([true, true, true, false, false]);
  });

  it("re-running workflows refreshes runs and every PR's checks in the repository", async () => {
    const result = await invalidatedBy(affects.actions("o", "r"), [
      keys.actions.runs("o", "r", {}),
      keys.actions.run("o", "r", 5),
      keys.pull.checks("o", "r", 9),
      keys.actions.runs("o", "other", {}),
    ]);
    expect(result).toEqual([true, true, true, false]);
  });

  it("starring refreshes the repository and the starred list", async () => {
    const result = await invalidatedBy(affects.star("o", "r"), [keys.repo.detail("o", "r"), keys.viewer.repos("starred"), keys.viewer.repos("yours")]);
    expect(result).toEqual([true, true, false]);
  });
});

describe("patchQueries", () => {
  it("updates every matching query and undoes the change", async () => {
    const client = new QueryClient();
    client.setQueryData(keys.notifications.list("unread"), [1, 2]);
    client.setQueryData(keys.notifications.list("all"), [1, 2, 3]);
    client.setQueryData(keys.viewer.profile(), [1]);
    const undo = await patchQueries<number[]>(client, { queryKey: [...keys.notifications.all(), "list"] }, (items) => items.filter((i) => i !== 1));
    expect(client.getQueryData(keys.notifications.list("unread"))).toEqual([2]);
    expect(client.getQueryData(keys.notifications.list("all"))).toEqual([2, 3]);
    expect(client.getQueryData(keys.viewer.profile())).toEqual([1]);
    undo();
    expect(client.getQueryData(keys.notifications.list("unread"))).toEqual([1, 2]);
  });
});
