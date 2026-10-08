import { expect, test } from "@playwright/test";
import { activeScreen, open, trackErrors } from "./helpers";

test("comment on a line, suggest a change and submit the review", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/pull/482?tab=files");

  // Tap an added line to open the comment sheet.
  await activeScreen(page).locator(".dl.add").nth(2).click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toContainText("line 20");
  await sheet.locator("textarea").fill("Name this MAX_ATTEMPTS?");
  await sheet.getByRole("button", { name: "Suggest a change" }).click();
  await expect(sheet.locator("textarea")).toHaveValue(/```suggestion\n {4}timeout: Duration,\n```/);
  await sheet.getByRole("button", { name: "Add to review" }).click();

  // The pending comment shows inline and on the Review button.
  await expect(page.locator(".draft-comment")).toHaveCount(1);
  const reviewButton = page.locator(".bottom-bar").getByRole("button", { name: /Review/ });
  await expect(reviewButton).toContainText("1");

  await reviewButton.click();
  await page.getByRole("radio", { name: /Approve/ }).check();
  await page.getByRole("button", { name: /Submit review \(1 comment\)/ }).click();
  await expect(page.locator(".toast", { hasText: "Approved" })).toBeVisible();
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(page.locator(".draft-comment")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("pending comments survive a reload", async ({ page }) => {
  await open(page, "/acme/rocket/pull/482?tab=files");
  await activeScreen(page).locator(".dl.del").first().click();
  await page.locator(".sheet textarea").fill("Why remove this?");
  await page.getByRole("button", { name: "Add to review" }).click();
  await expect(page.locator(".draft-comment")).toHaveCount(1);

  await open(page, "/acme/rocket/pull/482?tab=files");
  await expect(page.locator(".draft-comment")).toContainText("Why remove this?");
});

test("merge sheet offers the repository's merge methods", async ({ page }) => {
  await open(page, "/acme/rocket/pull/482");
  await page.locator(".bottom-bar").getByRole("button", { name: /Merge/ }).click();
  const sheet = page.locator(".sheet");
  await expect(sheet.getByRole("radio", { name: /Squash and merge/ })).toBeChecked();
  await expect(sheet.getByRole("radio", { name: /Rebase/ })).toHaveCount(0);
  // Blocked by branch protection: merging needs the admin override.
  const confirm = sheet.getByRole("button", { name: "Confirm squash and merge" });
  await expect(confirm).toBeDisabled();
  await sheet.getByText("Use your administrator privileges").click();
  await expect(confirm).toBeEnabled();
});
