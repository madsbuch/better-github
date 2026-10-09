import { expect, test, type Page } from "@playwright/test";
import { activeScreen, open, trackErrors, watchForLoading } from "./helpers";

const rows = (page: Page) => page.locator(".sheet .menu-item");
const names = (page: Page) => rows(page).locator(".branch-name");
const findBranch = (page: Page) => page.getByRole("searchbox", { name: "Find a branch" });

test("the branch picker opens loaded and finds the branch you name first", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/compare?head=octocat/faster-uploads");
  const screen = activeScreen(page);
  await expect(screen.getByLabel("Title")).toBeVisible();

  const loading = await watchForLoading(page);
  await screen.getByRole("button", { name: "Branch to compare" }).click();
  // The default branch first, then the one picked now, then the newest.
  await expect(names(page).nth(0)).toHaveText("main");
  await expect(rows(page).nth(0)).toContainText("default");
  await expect(names(page).nth(1)).toHaveText("octocat/faster-uploads");
  await expect(rows(page).nth(1)).toContainText("current");

  // "staging" is the oldest of 240 branches (the last page) and many names contain it.
  await findBranch(page).fill("staging");
  await expect(names(page).first()).toHaveText("staging");
  await expect(names(page).nth(1)).toHaveText("dave/authenticom-staging-follow-up");
  await expect(names(page).first().locator("mark")).toHaveText("staging");

  // Separators can be left out.
  await findBranch(page).fill("eng629");
  await expect(names(page).first()).toHaveText("dave/eng-629-vehicle-inventory-staging");
  // All without waiting: the list was loaded before the picker opened.
  expect(await loading()).toEqual([]);

  // Enter picks the top match.
  await findBranch(page).press("Enter");
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(screen.getByRole("button", { name: "Branch to compare" })).toContainText("dave/eng-629-vehicle-inventory-staging");
  expect(page.url()).toContain("head=dave%2Feng-629-vehicle-inventory-staging");
  expect(errors).toEqual([]);
});

test("every word must match, in any order", async ({ page }) => {
  await open(page, "/acme/rocket?tab=code");
  await activeScreen(page).getByRole("button", { name: "main" }).click();
  await findBranch(page).fill("deploy fix");
  await expect(names(page)).toHaveText(["dave/fix-staging-deployment"]);
  await findBranch(page).fill("no such branch");
  await expect(page.locator(".sheet")).toContainText("No branches match");
});

test("the search starts empty each time the picker opens", async ({ page }) => {
  await open(page, "/acme/rocket?tab=code");
  await activeScreen(page).getByRole("button", { name: "main" }).click();
  await findBranch(page).fill("release");
  await page.getByRole("button", { name: "Close" }).click();
  await activeScreen(page).getByRole("button", { name: "main" }).click();
  await expect(findBranch(page)).toHaveValue("");
});
