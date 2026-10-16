import { expect, test, type Page } from "@playwright/test";
import { activeScreen, open, trackErrors } from "./helpers";

// acme/rocket's .review-rules (src/dev/mock.ts) rates the three files of
// pull request 482 high, medium (no rule covers it) and low.
const files = (page: Page) => activeScreen(page).locator(".diff-file");
const verdict = (page: Page, i: number) => files(page).nth(i).locator(".diff-file-header .risk");
const notes = (page: Page, i: number) => files(page).nth(i).locator(".review-notes");

test("each file shows its verdict and everything to check, riskiest first", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/pull/482?tab=files");

  await expect(files(page).nth(0)).toHaveAttribute("data-path", "src/client.rs");
  await expect(verdict(page, 0)).toHaveText("High");
  await expect(files(page).nth(1)).toHaveAttribute("data-path", "assets/logo.png");
  await expect(verdict(page, 1)).toHaveText("Medium");
  await expect(files(page).nth(2)).toHaveAttribute("data-path", "README.md");
  await expect(verdict(page, 2)).toHaveText("Low");

  // Every instruction of every rule matching the file, highest risk first, above the diff.
  await expect(notes(page, 0).locator("li")).toHaveText([
    /^Retries only repeat requests that are safe to repeat/,
    "Backoff has a ceiling, so a dead server can't stall the app forever.",
    "Errors reach the caller with the server's message.",
  ]);
  await expect(notes(page, 0).locator(".review-notes-why")).toHaveText("Matched src/client.rs (high), src/** (medium)");

  // Low-risk (and viewed) files start collapsed.
  await expect(notes(page, 2)).toHaveCount(0);
  await files(page).nth(2).locator(".diff-file-header .path").click();
  await expect(notes(page, 2).locator("li")).toHaveText(["Is it still true?"]);
  await files(page).nth(1).locator(".diff-file-header .path").click();
  await expect(notes(page, 1).locator("li")).toHaveText(["No rule covers this file. Consider adding one."]);

  await expect(activeScreen(page).locator(".review-summary")).toContainText("High 0/1 viewed");
  expect(errors).toEqual([]);
});

test("approving with a high-risk file not marked viewed asks first", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/pull/482?tab=files");
  const review = page.locator(".bottom-bar").getByRole("button", { name: /Review/ });
  const sheet = page.locator(".sheet");

  await review.click();
  await page.getByRole("radio", { name: /Approve/ }).check();
  await expect(sheet.locator(".banner")).toContainText("A high-risk file isn't marked viewed");
  await expect(sheet.locator(".banner")).toContainText("src/client.rs");
  await expect(page.getByRole("button", { name: "Approve anyway" })).toBeVisible();
  // Commenting doesn't need it.
  await page.getByRole("radio", { name: /Comment/ }).check();
  await expect(sheet.locator(".banner")).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  // Once it's viewed, approving is a plain submit.
  await files(page).nth(0).getByRole("button", { name: "Viewed" }).click();
  await expect(activeScreen(page).locator(".review-summary")).toContainText("High 1/1 viewed");
  await review.click();
  await page.getByRole("radio", { name: /Approve/ }).check();
  await expect(sheet.locator(".banner")).toHaveCount(0);
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.locator(".toast", { hasText: "Approved" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a change to the rules is high risk and judged by the rules it replaces", async ({ page }) => {
  await open(page, "/acme/rocket/pull/483?tab=files");
  await expect(activeScreen(page).locator(".banner")).toContainText("This pull request changes .review-rules. The verdicts here use the rules on main");
  await expect(files(page).nth(0)).toHaveAttribute("data-path", ".review-rules");
  await expect(verdict(page, 0)).toHaveText("High");
  await expect(notes(page, 0).locator("li")).toHaveText(["This file decides how every change is reviewed. Check that no rule was weakened or removed."]);
  // Its "low src/**" doesn't apply yet.
  await expect(files(page).nth(1)).toHaveAttribute("data-path", "src/client.rs");
  await expect(verdict(page, 1)).toHaveText("High");
});

/** What the app put on the clipboard (the mock logs it). */
function clipboard(page: Page): () => string[] {
  const copied: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[mock] copy ")) copied.push(text.slice("[mock] copy ".length));
  });
  return () => copied;
}

test("a repository without rules offers a prompt to have an agent write them", async ({ page }) => {
  const errors = trackErrors(page);
  const copied = clipboard(page);
  await open(page, "/octocat/hello/pull/1?tab=files");
  await expect(files(page).first()).toBeVisible();
  await expect(activeScreen(page).locator(".diff-file-header .risk")).toHaveCount(0);
  await expect(activeScreen(page).locator(".review-summary")).toContainText("No .review-rules on main, the branch this merges into.");
  await activeScreen(page).getByRole("button", { name: "Copy agent prompt" }).click();
  await expect(page.locator(".toast", { hasText: "Prompt copied" })).toBeVisible();
  expect(copied()).toHaveLength(1);
  expect(copied()[0]).toMatch(/^Set up review rules for octocat\/hello: write a `\.review-rules` file at its root\./);
  expect(copied()[0]).toContain("## The format");
  expect(errors).toEqual([]);
});

test("rules only on the pull request's own branch are pointed out, not used", async ({ page }) => {
  await open(page, "/octocat/drafting/pull/1?tab=files");
  await expect(activeScreen(page).locator(".review-summary")).toContainText(
    "This pull request's branch has a .review-rules, but main doesn't. Verdicts use the rules on main",
  );
  await expect(activeScreen(page).locator(".diff-file-header .risk")).toHaveCount(0);
  await expect(activeScreen(page).getByRole("button", { name: "Copy agent prompt" })).toHaveCount(0);
});

test("the prompt for a repository with rules hands them over to improve", async ({ page }) => {
  const copied = clipboard(page);
  await open(page, "/acme/rocket/pull/482?tab=files");
  await activeScreen(page).locator(".review-summary").getByRole("button", { name: "Copy agent prompt" }).click();
  await expect(page.locator(".toast", { hasText: "Prompt copied" })).toBeVisible();
  expect(copied()[0]).toMatch(/^Improve the review rules of acme\/rocket/);
  expect(copied()[0]).toContain("## The current rules (on main)\n\n    # How carefully changes to Rocket need reviewing.");

  // The repository's menu has it too.
  await open(page, "/acme/rocket");
  await activeScreen(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Copy review rules prompt" }).click();
  await expect.poll(() => copied().length).toBe(2);
  expect(copied()[1]).toBe(copied()[0]);
});
