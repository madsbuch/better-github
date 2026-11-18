import { expect, test } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

test("actions tab lists runs and filters by workflow and status", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket?tab=actions");
  const rows = activeScreen(page).locator("a.row");
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("Add retry with exponential backoff");

  await activeScreen(page).getByRole("tab", { name: "Release", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Release v2.0.0");
  expect(page.url()).toContain("workflow=12");

  await activeScreen(page).getByRole("tab", { name: "All workflows" }).click();
  await activeScreen(page).getByRole("tab", { name: "Failed" }).click();
  expect(page.url()).toContain("status=failure");
  expect(errors).toEqual([]);
});

test("a failed job shows its errors and the failing step's log", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket?tab=actions");
  await activeScreen(page).locator("a.row", { hasText: "Fix clippy warnings" }).click();
  await expect(screenTitle(page)).toHaveText("Fix clippy warnings");
  // The first error annotation shows on the job without opening it.
  const job = activeScreen(page).locator("a.row", { hasText: "clippy" });
  await expect(job).toContainText("unused variable");

  await job.click();
  await expect(screenTitle(page)).toHaveText("clippy");
  // The failed step opens by itself and shows its own output only.
  const log = activeScreen(page).locator(".log");
  await expect(log).toHaveCount(1);
  await expect(log).toContainText("Process completed with exit code 101.");
  await expect(log).not.toContainText("Current runner version");
  await expect(log.locator(".log-error")).toHaveCount(1);
  await expect(log.locator(".ansi-fg-1", { hasText: "error" })).toHaveCount(1);

  // Other steps open on tap.
  await activeScreen(page).getByRole("button", { name: /Set up job/ }).click();
  await expect(activeScreen(page).locator(".log").first()).toContainText("Current runner version");
  await expect(activeScreen(page).locator(".bottom-bar")).toContainText("Re-run job");

  await page.goBack();
  await expect(screenTitle(page)).toHaveText("Fix clippy warnings");
  expect(errors).toEqual([]);
});

test("a running job shows live steps and explains where the log is", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/actions/runs/9001/job/9101");
  await expect(screenTitle(page)).toHaveText("build (windows-latest)");
  await expect(activeScreen(page).locator(".banner")).toContainText("Steps update live");
  await expect(activeScreen(page).locator(".step-row")).toHaveCount(3);
  await expect(activeScreen(page).locator(".log")).toHaveCount(0);
  await expect(activeScreen(page).locator(".bottom-bar")).toContainText("Cancel run");
  expect(errors).toEqual([]);
});

test("pull request checks open their job in the app", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/pull/482?tab=checks");
  await activeScreen(page).locator("a.row", { hasText: "clippy" }).click();
  await expect(page).toHaveURL(/\/actions\/runs\/9002\/job\/9102/);
  await expect(screenTitle(page)).toHaveText("clippy");
  expect(errors).toEqual([]);
});

test("failed and cancelled runs offer re-running just the failed jobs", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/actions/runs/9002");
  await expect(screenTitle(page)).toHaveText("Fix clippy warnings");
  await expect(activeScreen(page).locator(".bottom-bar")).toContainText("Re-run failed");

  await open(page, "/acme/rocket/actions/runs/9003");
  await expect(screenTitle(page)).toHaveText("Release v2.0.0");
  const bar = activeScreen(page).locator(".bottom-bar");
  await expect(bar).toContainText("Re-run all");
  await expect(bar).toContainText("Re-run failed");

  await open(page, "/acme/rocket/actions/runs/9000");
  await expect(screenTitle(page)).toHaveText("Bump tokio");
  await expect(activeScreen(page).locator(".bottom-bar")).toContainText("Re-run all");
  await expect(activeScreen(page).locator(".bottom-bar")).not.toContainText("Re-run failed");
  expect(errors).toEqual([]);
});
