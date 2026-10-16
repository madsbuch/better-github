import { expect, test } from "@playwright/test";
import { activeScreen, open, trackErrors } from "./helpers";

// Pull request 482 is blocked (it needs a review) and behind main. GitHub
// reports that as BLOCKED, not BEHIND, but the branch can still be updated.
test("an out-of-date branch can be updated while merging is blocked, by merge or rebase", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/pull/482");
  const box = activeScreen(page).locator(".merge-box");
  await expect(box).toContainText("Merging is blocked");
  await expect(box).toContainText("This branch is out of date");
  await expect(box).toContainText("Update merges the latest changes from main into it.");

  await box.getByRole("button", { name: "Update branch" }).click();
  await expect(page.locator(".toast", { hasText: "Merging main into the branch…" })).toBeVisible();

  // The other way, which is remembered for next time.
  await box.getByRole("button", { name: "Ways to update the branch" }).click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toContainText("This rewrites the branch");
  await sheet.getByRole("button", { name: /Update with rebase/ }).click();
  await expect(page.locator(".toast", { hasText: "Rebasing onto main…" })).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await expect(box).toContainText("Update rebases it onto main.");

  await open(page, "/acme/rocket/pull/482");
  await expect(activeScreen(page).locator(".merge-box")).toContainText("Update rebases it onto main.");
  expect(errors).toEqual([]);
});

test("the pull request menu updates the branch too", async ({ page }) => {
  await open(page, "/acme/rocket/pull/482");
  await activeScreen(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Update branch" }).click();
  await expect(page.locator(".toast", { hasText: "Merging main into the branch…" })).toBeVisible();
});
