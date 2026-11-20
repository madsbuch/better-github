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

// Spec: SR1, SR3, SR4, D7
test("a pull request's spec files are reviewed by what they change in the spec", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/pull/484?tab=files");

  // Before any file: how much of the spec changes, and where it now promises less.
  const summary = activeScreen(page).locator(".spec-review-summary");
  await expect(summary.locator(".spec-diff-summary")).toHaveText("3 items +1~1−13 user stories +1~26 requirements +2~2−24 values +1~2−1");
  await expect(summary.locator(".spec-weakened li")).toHaveCount(6);

  // Each item's file is a card saying what changed, with the file's verdict and viewed state.
  const retries = await shown(page, "uploads/retries");
  await expect(retries).toHaveAttribute("data-path", ".spec/uploads/retries.json");
  await expect(retries.locator(".spec-change-meta")).toContainText("Medium");
  await expect(retries.locator(".spec-change-meta")).toContainText("Takes away");
  await expect(retries.locator(".review-strip")).toContainText("1 check");
  await expect(retries.locator(".spec-diff-req:not(.spec-diff-story):not(.spec-diff-value) .spec-req-id")).toHaveText(["R1", "R3", "R4", "R5"]);
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

// Spec: SR5, SR6, SR7, SR16
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

  // A user story takes one too, on its lines of the file.
  const us3 = retries.locator('.spec-diff-story[data-story="US-3"]');
  await expect(us3.getByRole("button", { name: "Comment on US-3" })).toHaveAttribute("title", /^Comment on line \d+ of \.spec\/uploads\/retries\.json$/);
  await us3.getByRole("button", { name: "Comment on US-3" }).click();
  await expect(sheet.locator(".sheet-header")).toContainText("Comment · line");
  await sheet.locator("textarea").fill("Who asked for this?");
  await sheet.getByRole("button", { name: "Add to review" }).click();
  await expect(us3.locator(".draft-comment")).toContainText("Who asked for this?");

  // And a requirement the pull request left alone, where its diff shows it.
  await retries.getByRole("button", { name: /unchanged requirement/ }).click();
  const r2 = retries.locator('.spec-diff-req[data-req="R2"]');
  await r2.getByRole("button", { name: "Comment on R2" }).click();
  await sheet.locator("textarea").fill("Still true with 429s?");
  await sheet.getByRole("button", { name: "Add to review" }).click();
  await expect(r2.locator(".draft-comment")).toContainText("Still true with 429s?");

  // So does a field of the item.
  await retries.getByRole("button", { name: "Comment on the status" }).click();
  await expect(sheet.locator(".dl.add")).toContainText('"status": "draft"');
  await page.keyboard.press("Escape");

  // The same comments are on the file's lines when it is shown as JSON.
  await retries.getByRole("button", { name: "File actions" }).click();
  await page.getByRole("menuitem", { name: "Show the JSON diff" }).click();
  const json = file(page, ".spec/uploads/retries.json");
  // Diffs mount when they come near the viewport.
  await json.scrollIntoViewIfNeeded();
  await expect(json.locator(".diff-body")).toBeVisible();
  await expect(json.locator(".draft-comment")).toHaveCount(4);
  await json.getByRole("button", { name: "File actions" }).click();
  await page.getByRole("menuitem", { name: "Show what changed in the spec" }).click();
  await expect((await shown(page, "uploads/retries")).locator(".draft-comment")).toHaveCount(4);
});

// Spec: SR4
test("an item is marked viewed like the file it is", async ({ page }) => {
  await open(page, "/acme/rocket/pull/484?tab=files");
  const resume = await shown(page, "uploads/resume");
  await resume.getByRole("button", { name: "Viewed" }).click();
  await expect(resume.getByRole("button", { name: "Viewed" })).toHaveAttribute("aria-pressed", "true");
  // Viewed items fold away.
  await expect(resume.locator(".spec-change-body")).toHaveCount(0);
  await expect(activeScreen(page)).toContainText("2/7 viewed");
});

// Spec: SR2
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

// Spec: SR9, SR10, SR12
test("the Spec tab is for reading what a pull request changes in the spec, and nothing else", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/pull/484");
  // A pull request that changes the spec has the tab, with how many parts change.
  const tab = activeScreen(page).getByRole("tab", { name: /Spec/ });
  await expect(tab).toHaveText("Spec3");
  await tab.click();

  // No code and no JSON: the summary, the changed parts in the outline's order, and their cards.
  await expect(activeScreen(page).locator(".spec-diff-summary")).toHaveText("3 items +1~1−13 user stories +1~26 requirements +2~2−24 values +1~2−1");
  const contents = activeScreen(page).getByRole("navigation", { name: "Changed parts of the spec" });
  await expect(contents.locator(".spec-tab-progress")).toContainText("0/3 viewed");
  await expect(contents.locator(".spec-tab-entry")).toHaveText(["Uploads / RetriesChanged", "Uploads / ResumingNew", "Command lineRemoved"]);
  await expect(activeScreen(page).locator(".diff-file")).toHaveCount(3);
  await expect(activeScreen(page).locator(".diff-body")).toHaveCount(0);
  await expect(activeScreen(page).locator(".review-strip")).toHaveCount(0);

  // A reworded requirement reads as one text, with what went out and what came in marked.
  const r1 = (await shown(page, "uploads/retries")).locator('.spec-diff-req[data-req="R1"]');
  await expect(r1.locator(".spec-diff-inline")).toHaveText("An upload that fails with a network error, a 429 or a 5xx response is retried, up to fivethree times.");
  await expect(r1.locator(".spec-diff-inline del")).toHaveText("five");
  await expect(r1.locator(".spec-diff-inline ins")).toContainText(["a 429", "three"]);
  await expect(r1).toContainText("Why it changed Five retries kept phones awake for minutes.");

  // Commenting works as in the Files tab: on the file's line, shown at the requirement.
  await r1.getByRole("button", { name: "Comment on R1" }).click();
  await page.locator(".sheet textarea").fill("Three feels low for trains.");
  await page.locator(".sheet").getByRole("button", { name: "Add to review" }).click();
  await expect(r1.locator(".draft-comment")).toContainText("Three feels low for trains.");
  await expect(contents.locator(".spec-tab-entry").nth(0).locator(".counter")).toHaveText("1");

  // Viewed is the file's viewed state: the part folds, the list ticks it, and "To read" leaves it out.
  await card(page, "uploads/retries").getByRole("button", { name: "Viewed" }).click();
  await expect(contents.locator(".spec-tab-progress")).toContainText("1/3 viewed");
  await expect(card(page, "uploads/retries").locator(".spec-change-body")).toHaveCount(0);
  await activeScreen(page).getByRole("radio", { name: /To read/ }).click();
  await expect(activeScreen(page).locator(".spec-change .spec-change-title")).toHaveText(["Resuming", "Command line"]);
  // The list still leads to a part that is filtered out and folded.
  await contents.locator(".spec-tab-entry").nth(0).click();
  await expect(card(page, "uploads/retries").locator(".spec-change-body")).toBeVisible();

  // The same comment and viewed mark are in the Files tab.
  await activeScreen(page).getByRole("tab", { name: /Files/ }).click();
  await expect(activeScreen(page)).toContainText("2/7 viewed");
  // Viewed, so folded there too: open it.
  await card(page, "uploads/retries").scrollIntoViewIfNeeded();
  await card(page, "uploads/retries").locator(".diff-file-header .path").click();
  await expect(card(page, "uploads/retries").locator(".draft-comment")).toHaveCount(1);
  // And from there, a way back.
  await activeScreen(page).getByRole("button", { name: /Review in the Spec tab/ }).click();
  await expect(contents).toBeVisible();
  expect(errors).toEqual([]);
});

// Spec: SR9
test("a pull request that doesn't change the spec has no Spec tab", async ({ page }) => {
  await open(page, "/acme/rocket/pull/482");
  await expect(activeScreen(page).getByRole("tab", { name: /Files/ })).toBeVisible();
  await expect(activeScreen(page).getByRole("tab", { name: /Spec/ })).toHaveCount(0);
  // Opened at it anyway, it says so.
  await open(page, "/acme/rocket/pull/482?tab=spec");
  await expect(activeScreen(page)).toContainText("No spec changes");
});
