import { expect, test } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

test("open a pull request from a branch you just pushed", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/");
  // Only your own fresh branch without a pull request is suggested.
  const prompts = activeScreen(page).locator(".branch-prompt");
  await expect(prompts).toHaveCount(1);
  await expect(prompts).toContainText("octocat/faster-uploads");
  await prompts.getByRole("link", { name: /Compare & pull request/ }).click();

  await expect(screenTitle(page)).toHaveText("Open a pull request");
  const screen = activeScreen(page);
  // Prefilled like GitHub: the branch name for several commits, and the repository's template.
  await expect(screen.getByLabel("Title")).toHaveValue("Octocat/faster uploads");
  await expect(screen.getByLabel("Description")).toHaveValue(/## What changed/);
  await expect(screen.locator(".new-pull")).toContainText("2 commits");
  await expect(screen.locator(".new-pull")).toContainText("1 commit behind main");

  await screen.getByRole("tab", { name: /Commits/ }).click();
  await expect(screen.locator("a.row")).toHaveCount(2);
  await screen.getByRole("tab", { name: /Files/ }).click();
  await expect(screen.locator(".diff-file").first()).toBeVisible();
  await screen.getByRole("tab", { name: "Pull request" }).click();

  await screen.getByLabel("Title").fill("Stream uploads in chunks");
  await screen.getByRole("tab", { name: "Preview" }).click();
  await expect(screen.locator(".markdown")).toContainText("What changed");
  await screen.getByRole("tab", { name: "Write" }).click();

  await screen.getByRole("button", { name: /Request reviews/ }).click();
  const sheet = page.locator(".sheet");
  await sheet.getByPlaceholder("Find people").fill("ali");
  await sheet.getByRole("checkbox", { name: /alice/ }).click();
  await expect(sheet.getByRole("checkbox", { name: /alice/ })).toHaveAttribute("aria-checked", "true");
  // You can't review your own pull request.
  await expect(sheet.getByRole("checkbox", { name: /octocat/ })).toHaveCount(0);
  await sheet.getByRole("button", { name: /Done \(1\)/ }).click();
  await expect(screen.locator(".chip.active", { hasText: "alice" })).toBeVisible();

  await screen.getByRole("button", { name: "Create pull request" }).click();
  await expect(page.locator(".toast", { hasText: "Pull request opened" })).toBeVisible();
  await expect(page).toHaveURL(/\/acme\/rocket\/pull\/483/);
  await expect(screenTitle(page)).toHaveText(/^Add retry/);

  // The new pull request replaced the form: back returns to the inbox.
  await page.goBack();
  await expect(screenTitle(page)).toHaveText("Pull requests");
  expect(errors).toEqual([]);
});

test("an already open pull request is linked instead of a second one", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/compare?head=alice/upload-retries");
  await expect(activeScreen(page).locator(".banner")).toContainText("already open");
  await activeScreen(page).getByRole("link", { name: /#482/ }).click();
  await expect(page).toHaveURL(/\/acme\/rocket\/pull\/482/);
  expect(errors).toEqual([]);
});

test("switching the base branch in its sheet keeps back working", async ({ page }) => {
  await open(page, "/acme/rocket?tab=pulls");
  await activeScreen(page).getByRole("link", { name: "New pull request" }).click();
  await activeScreen(page).locator("button.row").first().click();
  await activeScreen(page).getByRole("button", { name: "Base branch" }).click();
  await page.locator(".sheet .menu-item", { hasText: "release/2.0" }).click();
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(activeScreen(page).getByRole("button", { name: "Base branch" })).toContainText("release/2.0");
  expect(page.url()).toContain("base=release%2F2.0");
  // No leftover sheet entry: one back leaves the screen.
  expect(page.url()).not.toMatch(/[?&]o=/);
  await page.goBack();
  await expect(screenTitle(page)).toHaveText("rocket");
});

test("branches without new commits have nothing to open", async ({ page }) => {
  await open(page, "/acme/rocket/compare?base=main&head=main");
  await expect(activeScreen(page).getByText("Nothing to compare")).toBeVisible();
  await expect(activeScreen(page).getByRole("button", { name: /Create/ })).toHaveCount(0);
});

test("a half-written pull request is kept until it's opened", async ({ page }) => {
  await open(page, "/acme/rocket/compare?head=octocat/faster-uploads");
  await activeScreen(page).getByLabel("Title").fill("Work in progress title");
  await open(page, "/acme/rocket/compare?head=octocat/faster-uploads");
  await expect(activeScreen(page).getByLabel("Title")).toHaveValue("Work in progress title");
});

test("start from the repository's pull requests and pick a branch", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket?tab=pulls");
  await activeScreen(page).getByRole("link", { name: "New pull request" }).click();
  await expect(screenTitle(page)).toHaveText("Open a pull request");
  // Recently updated branches, newest first; the base branch isn't offered.
  const branches = activeScreen(page).locator("button.row");
  await expect(branches.first()).toContainText("octocat/faster-uploads");
  await expect(activeScreen(page).locator("button.row", { hasText: /^main/ })).toHaveCount(0);
  await branches.first().click();
  await expect(activeScreen(page).getByLabel("Title")).toHaveValue("Octocat/faster uploads");
  expect(page.url()).toContain("head=octocat%2Ffaster-uploads");
  expect(errors).toEqual([]);
});

test("dismissed suggestions stay dismissed", async ({ page }) => {
  await open(page, "/");
  await activeScreen(page).getByRole("button", { name: "Dismiss octocat/faster-uploads" }).click();
  await expect(activeScreen(page).locator(".branch-prompt")).toHaveCount(0);
  await open(page, "/");
  await expect(activeScreen(page).locator("a.row").first()).toBeVisible();
  await expect(activeScreen(page).locator(".branch-prompt")).toHaveCount(0);
});
