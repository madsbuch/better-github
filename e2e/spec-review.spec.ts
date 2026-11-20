import { expect, test, type Page } from "@playwright/test";
import { activeScreen, open, trackErrors } from "./helpers";

// Pull request 484 of acme/rocket (src/dev/mock.ts) changes four spec files:
// Retries is reworded, Resuming is new, Command line is gone and a picture
// is redrawn.
const card = (page: Page, id: string) => activeScreen(page).locator(`.spec-change[data-id="${id}"]`);
/** A card's contents are drawn when it comes near the screen: scroll to it first. */
async function shown(page: Page, id: string) {
  await card(page, id).scrollIntoViewIfNeeded();
  await expect(card(page, id).locator(".spec-change-body")).toBeVisible();
  return card(page, id);
}
const file = (page: Page, path: string) => activeScreen(page).locator(`.diff-file[data-path="${path}"]`);

test("a pull request's spec files are reviewed by what they change in the spec", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/pull/484?tab=files");

  // Before any file: how much of the spec changes, and where it now promises less.
  const summary = activeScreen(page).locator(".spec-review-summary");
  await expect(summary.locator(".spec-diff-summary")).toHaveText("3 items +1~1−16 requirements +2~2−2");
  await expect(summary.locator(".spec-weakened li")).toHaveCount(4);

  // Each item's file is a card saying what changed, with the file's verdict and viewed state.
  const retries = await shown(page, "uploads/retries");
  await expect(retries).toHaveAttribute("data-path", ".spec/uploads/retries.json");
  await expect(retries.locator(".spec-change-meta")).toContainText("Medium");
  await expect(retries.locator(".spec-change-meta")).toContainText("Takes away");
  await expect(retries.locator(".review-strip")).toContainText("1 check");
  await expect(retries.locator(".spec-diff-req .spec-req-id")).toHaveText(["R1", "R3", "R4", "R5"]);
  await expect(card(page, "uploads/resume").locator(".spec-change-meta")).toContainText("Added");
  await expect(card(page, "cli").locator(".spec-change-meta")).toContainText("Removed");
  // A picture isn't an item: it stays a file.
  await expect(file(page, ".spec/assets/backoff.png").locator(".diff-file-header .path")).toContainText("backoff.png");
  await expect(activeScreen(page).locator(".spec-change")).toHaveCount(3);

  // From the summary to the item.
  await summary.getByRole("button", { name: "Command line C1" }).click();
  await expect(card(page, "cli")).toBeInViewport();
  expect(errors).toEqual([]);
});

test("a comment on a requirement lands on its line of the file and shows at the requirement", async ({ page }) => {
  await open(page, "/acme/rocket/pull/484?tab=files");
  const retries = await shown(page, "uploads/retries");
  const r1 = retries.locator('.spec-diff-req[data-req="R1"]');
  await r1.getByRole("button", { name: "Comment on R1" }).click();

  // The sheet shows the line of the JSON the comment goes on: the one the pull request changed.
  const sheet = page.locator(".sheet");
  await expect(sheet.locator(".sheet-header")).toContainText("Comment · line");
  await expect(sheet).toContainText(".spec/uploads/retries.json");
  await expect(sheet.locator(".dl.add")).toContainText("up to three times");
  await expect(r1).toHaveAttribute("data-selected", "true");
  await sheet.locator("textarea").fill("Why three and not five?");
  await sheet.getByRole("button", { name: "Add to review" }).click();
  await expect(page.locator(".toast", { hasText: "Added to your review" })).toBeVisible();

  // The pending comment is at the requirement, not at the bottom of a JSON diff.
  await expect(r1.locator(".draft-comment")).toContainText("Why three and not five?");
  await expect(retries.locator(".draft-comment")).toHaveCount(1);
  await expect(page.locator(".bottom-bar").getByRole("button", { name: /Review/ })).toContainText("1");

  // A removed requirement takes a comment on the old side of the file.
  const r4 = retries.locator('.spec-diff-req[data-req="R4"]');
  await r4.getByRole("button", { name: "Comment on R4" }).click();
  await expect(sheet.locator(".dl.del")).toContainText('"id": "R4"');
  await sheet.locator("textarea").fill("Is cancelling gone for good?");
  await sheet.getByRole("button", { name: "Add to review" }).click();
  await expect(r4.locator(".draft-comment")).toContainText("Is cancelling gone for good?");

  // So does a field of the item.
  await retries.getByRole("button", { name: "Comment on the status" }).click();
  await expect(sheet.locator(".dl.add")).toContainText('"status": "accepted"');
  await page.keyboard.press("Escape");

  // The same comments are on the file's lines when it is shown as JSON.
  await retries.getByRole("button", { name: "File actions" }).click();
  await page.getByRole("menuitem", { name: "Show the JSON diff" }).click();
  const json = file(page, ".spec/uploads/retries.json");
  await expect(json.locator(".diff-body")).toBeVisible();
  await expect(json.locator(".draft-comment")).toHaveCount(2);
  await json.getByRole("button", { name: "File actions" }).click();
  await page.getByRole("menuitem", { name: "Show what changed in the spec" }).click();
  await expect((await shown(page, "uploads/retries")).locator(".draft-comment")).toHaveCount(2);
});

test("an item is marked viewed like the file it is", async ({ page }) => {
  await open(page, "/acme/rocket/pull/484?tab=files");
  const resume = await shown(page, "uploads/resume");
  await resume.getByRole("button", { name: "Viewed" }).click();
  await expect(resume.getByRole("button", { name: "Viewed" })).toHaveAttribute("aria-pressed", "true");
  // Viewed items fold away.
  await expect(resume.locator(".spec-change-body")).toHaveCount(0);
  await expect(activeScreen(page)).toContainText("2/7 viewed");
});

test("the spec changes are measured against where the branch started", async ({ page }) => {
  const asked: string[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("[mock] spec-root ")) asked.push(message.text().slice("[mock] spec-root ".length));
  });
  await open(page, "/acme/rocket/pull/484?tab=files");
  await expect(card(page, "uploads/retries")).toBeVisible();
  // Not main as it is now: the commit the pull request branched from.
  expect(asked).toContain("ba5eba11");
  expect(asked).not.toContain("main");
});
