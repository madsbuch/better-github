import { expect, test } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors, watchForLoading } from "./helpers";

const PR_TITLE = /^Add retry with exponential backoff/;

test("back closes a sheet before leaving the screen", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/");
  await activeScreen(page).locator("a.row").first().click();
  await expect(screenTitle(page)).toHaveText(PR_TITLE);

  // Closing a sheet from the UI keeps the screen.
  await page.locator(".bottom-bar").getByRole("button", { name: /Comment/ }).click();
  await page.locator(".sheet-header").getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(screenTitle(page)).toHaveText(PR_TITLE);

  // The back button closes an open sheet first...
  await page.locator(".bottom-bar").getByRole("button", { name: /Review/ }).click();
  await expect(page.locator(".sheet")).toHaveCount(1);
  await page.goBack();
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(screenTitle(page)).toHaveText(PR_TITLE);

  // ...and then leaves the screen.
  await page.goBack();
  await expect(screenTitle(page)).toHaveText("Pull requests");
  await expect(page.locator(".tabbar")).toBeVisible();
  expect(errors).toEqual([]);
});

test("navigating from inside a sheet, then back", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/pull/482?tab=files");
  await activeScreen(page).locator(".diff-file").first().getByRole("button", { name: "File actions" }).click();
  await page.locator(".sheet .menu-item", { hasText: "View file" }).click();
  await expect(screenTitle(page)).toHaveText("client.rs");
  await expect(page.locator(".sheet")).toHaveCount(0);

  await page.goBack();
  await expect(screenTitle(page)).toHaveText(PR_TITLE);
  expect(page.url()).toContain("tab=files");
  await expect(page.locator(".sheet")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("picking a branch in the sheet switches the ref", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket?tab=code");
  await activeScreen(page).getByRole("button", { name: "main" }).click();
  await page.locator(".sheet .menu-item", { hasText: "release/2.0" }).click();
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(activeScreen(page).getByRole("button", { name: "release/2.0" })).toBeVisible();
  expect(page.url()).toContain("ref=release%2F2.0");
  expect(errors).toEqual([]);
});

test("bottom tabs switch root screens and keep back working", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/");
  await page.locator(".tabbar").getByRole("button", { name: "Repos" }).click();
  await expect(screenTitle(page)).toHaveText("Repositories");
  await activeScreen(page).locator("a.row").first().click();
  await expect(screenTitle(page)).toHaveText("rocket");
  await expect(page.locator(".tabbar")).toHaveCount(0);
  await page.goBack();
  await expect(screenTitle(page)).toHaveText("Repositories");
  await expect(page.locator(".tabbar")).toBeVisible();
  expect(errors).toEqual([]);
});

test("earlier screens keep their state underneath", async ({ page }) => {
  await open(page, "/");
  await activeScreen(page).getByRole("tab", { name: /Assigned/ }).click();
  await expect(page).toHaveURL(/filter=assigned/);
  await activeScreen(page).locator("a.row").first().click();
  await page.goBack();
  await expect(activeScreen(page).getByRole("tab", { name: /Assigned/ })).toHaveAttribute("aria-selected", "true");
});

test("opening a pull request from the inbox never shows a spinner", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/");
  await expect(activeScreen(page).locator("a.row").first()).toBeVisible();
  const loading = await watchForLoading(page);
  await activeScreen(page).locator("a.row").first().click();
  await expect(screenTitle(page)).toHaveText(PR_TITLE);
  await expect(activeScreen(page).locator(".timeline .event").first()).toBeVisible();
  // Its tabs were loaded in the background too.
  await activeScreen(page).getByRole("tab", { name: /Files/ }).click();
  await expect(activeScreen(page).locator(".diff-file").first()).toBeVisible();
  await activeScreen(page).getByRole("tab", { name: /Checks/ }).click();
  await expect(activeScreen(page).locator(".group-header").first()).toBeVisible();
  expect(await loading()).toEqual([]);
  expect(errors).toEqual([]);
});

test("back restores the scroll position", async ({ page }) => {
  await open(page, "/acme/rocket/pull/482");
  const content = activeScreen(page).locator(".content");
  await expect(activeScreen(page).locator(".timeline")).toBeVisible();
  const scrollable = await content.evaluate((el) => el.scrollHeight - el.clientHeight);
  test.skip(scrollable < 200, "the fixture doesn't scroll at this size");
  await content.evaluate((el) => (el.scrollTop = 200));
  await page.waitForTimeout(100);
  await activeScreen(page).locator(".timeline a.event").first().click();
  await expect(screenTitle(page)).toHaveText(/^Commit /);
  await page.goBack();
  await expect(screenTitle(page)).toHaveText(PR_TITLE);
  await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBe(200);
});
