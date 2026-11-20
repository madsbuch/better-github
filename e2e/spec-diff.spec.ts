import { expect, test, type Page } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

// acme/rocket's spec on eng-629-retries (src/dev/mock.ts) rewords, re-levels,
// adds and removes requirements of Retries, adds Resuming and drops Command line.
const items = (page: Page) => activeScreen(page).locator(".spec-change");
const item = (page: Page, id: string) => activeScreen(page).locator(`.spec-change[data-id="${id}"]`);

test("two branches' specs are compared by item and requirement", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/spec-diff?head=eng-629-retries");
  await expect(screenTitle(page)).toHaveText("Spec changes");
  await expect(activeScreen(page).locator(".spec-diff-summary")).toHaveText("3 items +1~1−13 user stories +1~26 requirements +2~2−24 values +1~2−1");
  // What a reviewer must not miss: where the spec now promises less.
  const weakened = activeScreen(page).locator(".spec-weakened");
  await expect(weakened).toContainText("6 changes take something away from the spec");
  await expect(weakened.locator("li")).toHaveText([
    "Retries Back from accepted to draft.",
    "Retries US-2 Deprecated: Nobody asked for it once retries took seconds instead of minutes.",
    // Nothing is deleted from a spec: what is no longer wanted is deprecated, with the reason.
    "Retries R4 A may requirement is deleted. Deprecate it instead, with the reason, so the record stays.",
    "Retries retry.label A named value is deleted. Deprecate it instead, with the reason, so the record stays.",
    "Command line Deleted, with 1 requirement. Deprecate it instead, with the reason, so the record stays.",
    "Command line C1 A must requirement is deleted. Deprecate it instead, with the reason, so the record stays.",
  ]);
  await expect(items(page).locator(".spec-change-title")).toHaveText(["Retries", "Resuming", "Command line"]);
  await expect(items(page).locator(".spec-change-meta .spec-diff-kind:not([data-kind=weakened])")).toHaveText(["Changed", "Added", "Removed"]);

  const retries = item(page, "uploads/retries");
  await expect(retries.locator(".spec-part > .spec-diff-move")).toHaveText("Status Accepted → Draft");
  // User stories come first: reworded in place, deprecated with why, and new.
  const stories = retries.locator(".spec-diff-story");
  await expect(stories.locator(".spec-req-id")).toHaveText(["US-1", "US-2", "US-3"]);
  await expect(stories.locator(".spec-req-head .spec-diff-kind:not([data-kind=weakened])")).toHaveText(["Changed", "Changed", "Added"]);
  await expect(stories.nth(1)).toContainText("Why it is deprecated Nobody asked for it once retries took seconds instead of minutes.");
  await expect(stories.nth(2)).toContainText("As someone running the server, I want clients to back off when I ask them to, so that a restart isn't met by a stampede.");
  await expect(stories.nth(2)).toContainText("Made true by R5");
  // Named values: what each was and is, as it looks, with why when the change says so.
  const values = retries.locator(".spec-diff-value");
  await expect(values.locator(".spec-req-id")).toHaveText(["retry.max", "color.retrying", "retry.states", "retry.label"]);
  await expect(values.nth(0).locator(".spec-value-move")).toHaveText("5 times3 times");
  await expect(values.nth(0)).toContainText("Why it changed Five retries kept phones awake for minutes.");
  await expect(values.nth(1).locator(".spec-swatch")).toHaveCount(4);
  await expect(values.nth(1)).toContainText("Nothing says why it changed.");
  await expect(values.nth(2).locator(".spec-value-entry")).toHaveText(["waiting", "retrying", "gave up"]);
  await expect(values.nth(3).locator(".spec-req-head")).toContainText("Takes away");
  const requirements = retries.locator(".spec-diff-req:not(.spec-diff-story):not(.spec-diff-value)");
  await expect(requirements.locator(".spec-req-id")).toHaveText(["R1", "R3", "R4", "R5"]);
  await expect(requirements.locator(".spec-req-head .spec-diff-kind:not([data-kind=weakened])")).toHaveText(["Changed", "Changed", "Removed", "Added"]);
  // Deleting a requirement, instead of deprecating it, is flagged.
  await expect(requirements.nth(2).locator(".spec-req-head")).toContainText("Takes away");
  // What it left alone is folded away, for context.
  await expect(retries.locator('.spec-diff-req[data-kind="unchanged"]')).toHaveCount(0);
  await retries.getByRole("button", { name: "1 unchanged requirement" }).click();
  await expect(retries.locator('.spec-diff-req[data-kind="unchanged"] .spec-req-id')).toHaveText("R2");
  // A reworded requirement: both texts, with the words that differ marked.
  await expect(requirements.nth(0).locator(".spec-diff-inline del")).toHaveText(["five"]);
  await expect(requirements.nth(0).locator(".spec-diff-inline ins")).toContainText(["429", "three"]);
  // Its meaning changed, so it is a new version, and says why.
  await expect(requirements.nth(0).locator(".spec-diff-version")).toContainText("Version 1 → 2");
  await expect(requirements.nth(0).locator(".spec-diff-version")).toContainText("Why it changed Five retries kept phones awake for minutes.");
  // R3 became binding without a new version: left for the reviewer to judge.
  await expect(requirements.nth(1).locator(".spec-same-version")).toContainText("Still version 1");
  // Only its level moved.
  await expect(requirements.nth(1).locator(".spec-diff-line")).toHaveCount(0);
  await expect(requirements.nth(1).locator(".spec-diff-move")).toHaveText("Level should → must");

  // The picture changed: both versions show.
  const figure = retries.locator(".spec-diff-figure");
  await expect(figure.locator(".spec-diff-kind")).toHaveText("Picture changed");
  await expect(figure.locator(".spec-diff-picture figcaption")).toHaveText(["Before", "After"]);
  await expect(figure.locator("img")).toHaveCount(2);
  await expect(retries.getByRole("region", { name: "Related" }).locator(".spec-diff-line")).toHaveText(["−cli", "+uploads/resume"]);

  // A new item has one status, and a removed one opens on the side that still has it.
  await expect(item(page, "uploads/resume").locator(".spec-part > .spec-diff-move")).toHaveText("Status Draft");
  await item(page, "cli").getByRole("link", { name: "Open Command line in the spec" }).click();
  await expect(screenTitle(page)).toHaveText("Command line");
  await expect(activeScreen(page).locator(".appbar-sub")).toHaveText("acme/rocket · main");
  expect(errors).toEqual([]);
});

test("the spec browser leads to the comparison, where either side can be changed", async ({ page }) => {
  await open(page, "/acme/rocket/spec?ref=eng-629-retries");
  await activeScreen(page).getByRole("link", { name: "Compare with another branch" }).click();
  await expect(items(page)).toHaveCount(3);

  // The same on both sides: nothing to show.
  await activeScreen(page).getByRole("button", { name: "Compare: eng-629-retries" }).click();
  await page.locator(".sheet .menu-item").filter({ has: page.getByText("main", { exact: true }) }).first().click();
  await expect(activeScreen(page)).toContainText("The specs are the same");

  // From the default branch there is nothing to compare with yet.
  await open(page, "/acme/rocket/spec");
  await activeScreen(page).getByRole("link", { name: "Compare with another branch" }).click();
  await expect(activeScreen(page)).toContainText("Pick a branch to compare");
});

test("a branch without a spec loses all of it", async ({ page }) => {
  await open(page, "/acme/rocket/spec-diff?head=some-branch");
  await expect(activeScreen(page).locator(".banner:not(.spec-weakened)")).toHaveText("some-branch has no spec: all of it is removed.");
  await expect(items(page).locator(".spec-change-meta .spec-diff-kind:not([data-kind=weakened])")).toHaveText(["Removed", "Removed", "Removed", "Removed", "Removed"]);
});

test("the changes can be narrowed to a kind, and to what promises less", async ({ page }) => {
  await open(page, "/acme/atlas/spec-diff?base=main&head=next");
  await expect(items(page)).toHaveCount(4);
  const chips = activeScreen(page).getByRole("radiogroup", { name: "Show" });
  await expect(chips.getByRole("radio")).toHaveText(["All 4", "Added 1", "Changed 3"]);
  await chips.getByRole("radio", { name: /Added/ }).click();
  await expect(items(page).locator(".spec-change-title")).toHaveText(["Feature 7.new"]);

  await open(page, "/acme/rocket/spec-diff?head=eng-629-retries");
  await activeScreen(page).getByRole("radio", { name: /Takes away/ }).click();
  await expect(items(page).locator(".spec-change-title")).toHaveText(["Retries", "Command line"]);
  // From the list of what promises less, straight to the item.
  await activeScreen(page).locator(".spec-weakened").getByRole("button", { name: "Command line C1" }).click();
  await expect(activeScreen(page).getByRole("radio", { name: /All/ })).toBeChecked();
  await expect(item(page, "cli")).toBeInViewport();
});

test("long text is compared paragraph by paragraph, with what didn't change folded away", async ({ page }) => {
  await open(page, "/acme/rocket/spec-diff?head=eng-629-retries");
  const prose = item(page, "uploads/retries").locator(".spec-prose").first();
  // On a phone: one column. A reworded paragraph is one text; a new list item is whole.
  await expect(prose.locator(".spec-split-row")).toHaveCount(0);
  await expect(prose.locator('.spec-prose-block[data-kind="added"]')).toHaveText("a retry waits as long as the server asks");
  await expect(prose.locator(".spec-diff-inline del")).toHaveText(["last", "last"]);
  await expect(prose.locator(".spec-diff-inline ins")).toContainText(["third", "first"]);
  // What is far from any change is one line, until asked for.
  await expect(prose).not.toContainText("Networks drop.");
  await prose.getByRole("button", { name: "3 unchanged paragraphs" }).click();
  await expect(prose).toContainText("Networks drop.");
});

test.describe("in a wide window", () => {
  test.use({ viewport: { width: 1280, height: 860 }, hasTouch: false, isMobile: false });

  test("the old is beside the new, each with its changed words marked", async ({ page }) => {
    await open(page, "/acme/rocket/spec-diff?head=eng-629-retries");
    const r1 = item(page, "uploads/retries").locator('.spec-diff-req[data-req="R1"]');
    await expect(r1.locator('.spec-split-cell[data-side="before"]')).toHaveText("An upload that fails with a network error or a 5xx response is retried, up to five times.");
    await expect(r1.locator('.spec-split-cell[data-side="before"] mark')).toHaveText(["five"]);
    await expect(r1.locator('.spec-split-cell[data-side="after"] mark')).toContainText(["429", "three"]);
    const [before, after] = [await r1.locator('.spec-split-cell[data-side="before"]').boundingBox(), await r1.locator('.spec-split-cell[data-side="after"]').boundingBox()];
    expect(after?.x ?? 0).toBeGreaterThan((before?.x ?? 0) + (before?.width ?? 0) - 1);
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 1000))).toBeLessThan(2);

    // One column is a button away, and comes back.
    await page.getByRole("button", { name: "Show in one column" }).click();
    await expect(r1.locator(".spec-split-row")).toHaveCount(0);
    await expect(r1.locator(".spec-diff-inline del")).toHaveText(["five"]);
    await page.getByRole("button", { name: "Show side by side" }).click();
    await expect(r1.locator(".spec-split-row")).toHaveCount(1);
  });
});
