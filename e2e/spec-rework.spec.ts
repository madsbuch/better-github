import { expect, test, type Page } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

// Reworking acme/rocket's spec (src/dev/mock.ts): the changes stay on the
// device, and what leaves it is a handover for a coding agent.
const requirement = (page: Page, id: string) => activeScreen(page).locator(`.spec-req[data-req="${id}"]`);
const sheet = (page: Page) => page.locator(".sheet");
const bar = (page: Page) => activeScreen(page).locator(".rework-bar");

/** What the app put on the clipboard (the mock logs it). */
function clipboard(page: Page): () => string[] {
  const copied: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[mock] copy ")) copied.push(text.slice("[mock] copy ".length));
  });
  return () => copied;
}

test("requirements are revised, deprecated and added while reading, then handed to an agent", async ({ page }) => {
  const errors = trackErrors(page);
  const copied = clipboard(page);
  await open(page, "/acme/rocket/spec?ref=main&id=uploads/retries");
  // Reading, there is nothing to edit with.
  await expect(requirement(page, "R1").getByRole("button", { name: "Revise" })).toHaveCount(0);
  await activeScreen(page).getByRole("button", { name: "Rework the spec" }).click();
  await expect(bar(page)).toContainText("Reworking the spec");

  // Revise: what it means changes, so it is a new version and needs a why.
  await requirement(page, "R1").getByRole("button", { name: "Revise" }).click();
  await expect(sheet(page)).toContainText("It says now: “An upload that fails with a network error or a 5xx response is retried, up to five times.”");
  await sheet(page).getByLabel("What it should say").fill("An upload that fails is retried, up to three times.");
  await expect(sheet(page).getByRole("checkbox", { name: /This changes what it means/ })).toBeChecked();
  await expect(sheet(page).getByRole("button", { name: "Save" })).toBeDisabled();
  await sheet(page).getByLabel("Why it changes").fill("Five retries kept phones awake.");
  await sheet(page).getByRole("button", { name: "Save" }).click();
  await expect(requirement(page, "R1").locator(".spec-req-text")).toHaveText("An upload that fails is retried, up to three times.");
  await expect(requirement(page, "R1").locator(".rework-mark")).toHaveText("Revised");
  await expect(requirement(page, "R1").getByRole("button", { name: /Version 2/ })).toBeVisible();

  // A wording fix keeps its version.
  await requirement(page, "R3").getByRole("button", { name: "Revise" }).click();
  await sheet(page).getByLabel("What it should say").fill("The pause before a retry doubles each time, from 250 ms up to 30 s.");
  await sheet(page).getByRole("checkbox", { name: /This changes what it means/ }).uncheck();
  await expect(sheet(page).getByLabel("Why it changes")).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Save" }).click();
  await expect(requirement(page, "R3").locator(".spec-version")).toHaveCount(0);

  // Deprecate: it stays, with why.
  await requirement(page, "R2").getByRole("button", { name: "Deprecate" }).click();
  await sheet(page).getByLabel("Why it is no longer wanted").fill("Uploads restart cheaply now.");
  await sheet(page).getByLabel(/Replaced by/).fill("R1");
  await sheet(page).getByRole("button", { name: "Deprecate" }).click();
  await expect(requirement(page, "R2")).toHaveAttribute("data-deprecated", "true");
  await expect(requirement(page, "R2").locator(".spec-deprecation-why")).toContainText("Uploads restart cheaply now.");
  await expect(requirement(page, "R2").locator(".rework-mark")).toHaveText("Deprecated here");

  // Add: with an id nothing in the spec has.
  await activeScreen(page).getByRole("button", { name: "Add a requirement" }).click();
  await expect(sheet(page).getByLabel("Id")).toHaveValue("R5");
  await sheet(page).getByLabel("Id").fill("E1");
  await expect(sheet(page)).toContainText("E1 is already in Errors. Ids are unique in the whole spec.");
  await expect(sheet(page).getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await sheet(page).getByLabel("Id").fill("R5");
  await sheet(page).getByLabel("What has to be true").fill("A retry gives up after a minute.");
  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(requirement(page, "R5").locator(".rework-mark")).toHaveText("New");
  // It says what is wanted, nothing about what is built: no status of its own.
  await expect(requirement(page, "R5").locator(".spec-req-head")).toHaveText("R5must");

  // A user story: who wants it. It gets an id nothing in the spec has, and its requirements have to exist.
  await activeScreen(page).getByRole("button", { name: "Add a user story" }).click();
  await expect(sheet(page).getByLabel(/^Id/)).toHaveValue("US-3");
  await sheet(page).getByLabel(/^As/).fill("a traveller on hotel wifi");
  await sheet(page).getByLabel(/^I want/).fill("an upload that knows when to stop");
  await sheet(page).getByLabel(/Made true by/).fill("R5, R9");
  await expect(sheet(page)).toContainText("Not a requirement in the spec: R9.");
  await expect(sheet(page).getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await sheet(page).getByLabel(/Made true by/).fill("R5");
  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();
  const story = activeScreen(page).locator('.spec-story[data-story="US-3"]');
  await expect(story.locator(".spec-story-text")).toHaveText("As a traveller on hotel wifi, I want an upload that knows when to stop.");
  await expect(story.locator(".rework-mark")).toHaveText("New");

  // The bar counts it, and the review shows it like any change to the spec.
  await expect(bar(page)).toContainText("1 part changed");
  await expect(bar(page)).toContainText("4 requirements · not in the repository yet");
  await bar(page).getByRole("button", { name: "Review & copy" }).click();
  await expect(sheet(page).locator(".spec-diff-summary")).toHaveText("1 item ~11 user story +14 requirements +1~3");
  await expect(sheet(page).locator(".spec-diff-req:not(.spec-diff-story) .spec-req-id")).toHaveText(["R1", "R2", "R3", "R5"]);
  await expect(sheet(page).locator('.spec-diff-req[data-req="R1"]')).toContainText("Why it changed Five retries kept phones awake.");
  await sheet(page).getByLabel(/Anything else the agent should know/).fill("Keep MAX_RETRIES configurable.");
  await sheet(page).getByRole("button", { name: "Copy for my agent" }).click();
  await expect(page.locator(".toast", { hasText: "Copied. Paste it into your coding agent." })).toBeVisible();

  // The handover: what changed and why, the whole file, and what to do about the code.
  const handover = copied()[0] ?? "";
  expect(handover).toMatch(/^Update the spec of acme\/rocket, and the code to match it\./);
  expect(handover).toContain("### Uploads / Retries (`.spec/uploads/retries.json`): changed");
  expect(handover).toContain("- R1: version 1 to 2;");
  expect(handover).toContain("Why: Five retries kept phones awake.");
  expect(handover).toContain("- R2: deprecated. Why: Uploads restart cheaply now. Replaced by #R1.");
  expect(handover).toContain("A wording fix: what it means is the same.");
  expect(handover).toContain('- R5: new (must). "A retry gives up after a minute."');
  expect(handover).toContain('- US-3: new user story. "As a traveller on hotel wifi, I want an upload that knows when to stop."');
  expect(handover).toContain("## Also\n\nKeep MAX_RETRIES configurable.");
  expect(handover).toContain('    {\n      "title": "Retries",');
  expect(handover).toContain('"reason": "Five retries kept phones awake."');
  expect(handover).toContain("requirement by requirement: R1, R2, R5");
  // The file it hands over is a valid item: the app would read it back.
  const json = /### `\.spec\/uploads\/retries\.json`\n\n([\s\S]*?)\n\n## What to do/.exec(handover)?.[1] ?? "";
  const written: unknown = JSON.parse(json.replace(/^ {4}/gm, ""));
  expect(written).toMatchObject({ title: "Retries", requirements: [{ id: "R1", version: 2 }, { id: "R2", status: "deprecated" }, { id: "R3" }, { id: "R4" }, { id: "R5" }] });
  expect(errors).toEqual([]);
});

test("changes survive leaving, can be undone one by one, and reading shows the repository's spec", async ({ page }) => {
  await open(page, "/acme/rocket/spec?ref=main&id=cli");
  await activeScreen(page).getByRole("button", { name: "Rework the spec" }).click();
  await requirement(page, "C1").getByRole("button", { name: "Revise" }).click();
  await sheet(page).getByLabel("How binding it is").selectOption("should");
  // How binding it is belongs to what it means: no way around a version.
  await expect(sheet(page).getByRole("checkbox", { name: /This changes what it means/ })).toBeDisabled();
  await sheet(page).getByLabel("Why it changes").fill("Scripts ignore it anyway.");
  await sheet(page).getByRole("button", { name: "Save" }).click();
  await expect(requirement(page, "C1").locator(".spec-level")).toHaveText("should");

  // A fresh start of the app still has it.
  await open(page, "/acme/rocket/spec?ref=main&id=cli");
  await expect(requirement(page, "C1").locator(".rework-mark")).toHaveText("Revised");
  await expect(bar(page)).toContainText("1 part changed");

  // Stop reworking: the spec reads as the repository has it; the changes wait.
  await activeScreen(page).getByRole("button", { name: "Stop reworking the spec" }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(requirement(page, "C1").locator(".spec-level")).toHaveText("must");
  await activeScreen(page).getByRole("button", { name: "Rework the spec" }).click();
  await expect(requirement(page, "C1").locator(".spec-level")).toHaveText("should");

  // Undo puts the requirement back, and with nothing left there is nothing to hand over.
  await requirement(page, "C1").getByRole("button", { name: "Undo the changes to C1" }).click();
  await expect(requirement(page, "C1").locator(".spec-level")).toHaveText("must");
  await expect(bar(page)).toContainText("Reworking the spec");
});

test("a part is edited, deprecated with a reason, and new parts are added", async ({ page }) => {
  const copied = clipboard(page);
  await open(page, "/acme/rocket/spec?ref=main&id=uploads");
  await activeScreen(page).getByRole("button", { name: "Rework the spec" }).click();

  // A new part, opened to be filled in.
  await activeScreen(page).getByRole("button", { name: "Add a part to Uploads" }).click();
  await sheet(page).getByLabel("Title").fill("Resuming uploads");
  await expect(sheet(page)).toContainText(".spec/uploads/resuming-uploads.json");
  await sheet(page).getByLabel("Summary").fill("Picking up where it stopped.");
  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(screenTitle(page)).toHaveText("Resuming uploads");
  await expect(activeScreen(page).locator(".spec-item h2")).toContainText("Draft");
  await activeScreen(page).getByRole("button", { name: "Add a requirement" }).click();
  // Its first requirement gets a prefix from its name.
  await expect(sheet(page).getByLabel("Id")).toHaveValue("RES-1");
  await sheet(page).getByLabel("What has to be true").fill("A retry asks the server how many bytes it has.");
  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();

  // An existing part: its own text, and deprecating it needs a reason.
  await open(page, "/acme/rocket/spec?ref=main&id=cli");
  await activeScreen(page).getByRole("button", { name: "Edit this part" }).click();
  await sheet(page).getByLabel("Status").selectOption("deprecated");
  await expect(sheet(page).getByRole("button", { name: "Save" })).toBeDisabled();
  await sheet(page).getByLabel("Why it is no longer wanted").fill("There is an app now.");
  await sheet(page).getByRole("button", { name: "Save" }).click();
  await expect(activeScreen(page).locator(".spec-deprecation")).toContainText("There is an app now.");
  await expect(activeScreen(page).locator(".rework-item-tools .rework-mark")).toHaveText("Changed");

  await expect(bar(page)).toContainText("2 parts changed");
  await bar(page).getByRole("button", { name: "Review & copy" }).click();
  await expect(sheet(page).locator(".spec-change .spec-change-title")).toHaveText(["Resuming uploads", "Command line"]);
  await sheet(page).getByRole("button", { name: "Copy for my agent" }).click();
  await expect.poll(() => copied().length).toBe(1);
  expect(copied()[0]).toContain("### Uploads / Resuming uploads (`.spec/uploads/resuming-uploads.json`): new item");
  expect(copied()[0]).toContain("### `.spec/uploads/resuming-uploads.json` (new)");
  expect(copied()[0]).toContain('- deprecation: none to "There is an app now.".');

  // Discarding takes all of it back.
  await sheet(page).getByRole("button", { name: "Discard all" }).click();
  await expect(bar(page)).toContainText("Reworking the spec");
  await expect(activeScreen(page).locator(".spec-deprecation")).toHaveCount(0);
});
