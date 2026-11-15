import { expect, test } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

test("startup opens repositories and keeps account-wide lists under You", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(screenTitle(page)).toHaveText("Repositories");
  await expect(page).toHaveURL(/#\/repos$/);
  await expect(activeScreen(page).getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  const navigation = page.getByRole("navigation", { name: "Main" });
  await expect(navigation.getByRole("button")).toHaveText(["Repos", "You"]);

  await navigation.getByRole("button", { name: "You", exact: true }).click();
  await activeScreen(page).getByRole("link", { name: "All pull requests" }).click();
  await expect(screenTitle(page)).toHaveText("Pull requests");
  await expect(page).toHaveURL(/#\/pulls$/);
  await page.goBack();
  await expect(screenTitle(page)).toHaveText("You");
  await activeScreen(page).getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(screenTitle(page)).toHaveText("Inbox");
  await page.goBack();
  await navigation.getByRole("button", { name: "Repos", exact: true }).click();
  await expect(screenTitle(page)).toHaveText("Repositories");
  await expect(activeScreen(page).getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("repository overview leads to reviews, releases and retrying builds", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/");
  await activeScreen(page).locator("a.row").first().click();
  await expect(screenTitle(page)).toHaveText("rocket");
  const screen = activeScreen(page);
  const tasks = screen.getByRole("group", { name: "Repository tasks" });
  await expect(tasks.getByRole("button")).toHaveCount(3);

  await tasks.getByRole("button", { name: "Review pull requests" }).click();
  await expect(screen.getByRole("tab", { name: /Pull requests/ })).toHaveAttribute("aria-selected", "true");
  await screen.locator("a.row").first().click();
  await expect(screenTitle(page)).toHaveText(/^Add retry/);
  await page.goBack();
  await screen.getByRole("tab", { name: "Overview", exact: true }).click();

  await tasks.getByRole("button", { name: "Download releases" }).click();
  await screen.locator("a.row", { hasText: "Rocket 2.0" }).click();
  await expect(screenTitle(page)).toHaveText("Rocket 2.0");
  await page.goBack();
  await screen.getByRole("tab", { name: "Overview", exact: true }).click();

  await tasks.getByRole("button", { name: "View build runs" }).click();
  await screen.locator("a.row", { hasText: "Fix clippy warnings" }).click();
  await expect(screenTitle(page)).toHaveText("Fix clippy warnings");
  await screen.getByRole("button", { name: "Re-run failed", exact: true }).click();
  await expect(page.locator(".toast", { hasText: "Re-running failed jobs" })).toBeVisible();
  await screen.getByRole("button", { name: "Re-run all", exact: true }).click();
  await expect(page.locator(".toast", { hasText: "Re-running all jobs" })).toBeVisible();
  expect(errors).toEqual([]);
});
