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
