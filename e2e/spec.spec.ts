import { expect, test, type Page } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

// acme/rocket's .spec (src/dev/mock.ts): Uploads (with Retries and Errors
// below it) and Command line. On staging, Command line can't be read and a
// requirement id is used twice.
const rows = (page: Page) => activeScreen(page).locator(".spec-row");
const requirements = (page: Page) => activeScreen(page).locator(".spec-req:not(.spec-story)");

// Spec: S9, S10, S24, S29
test("a repository with a spec links to it, and the outline leads to its items", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket");
  const card = activeScreen(page).locator(".spec-card");
  await expect(card).toContainText("Uploads that don't give up.");
  await expect(card).toContainText("4 items · 7 requirements");
  await card.click();

  await expect(screenTitle(page)).toHaveText("Spec");
  await expect(activeScreen(page).locator(".spec-item h2")).toHaveText("Rocket");
  // "- " lines are a list, and `code` shows as code.
  await expect(activeScreen(page).locator(".spec-item li code")).toHaveText(["upload", "rocket"]);
  await expect(activeScreen(page).locator(".spec-counts")).toHaveText("4 items · 4 named values · 2 user stories · 7 requirements · 1 deprecated");
  await expect(rows(page).locator(".row-title")).toHaveText(["Uploads", "Command line"]);
  await expect(rows(page).nth(0)).toContainText("2 items · 6 requirements");

  await rows(page).nth(0).click();
  await expect(screenTitle(page)).toHaveText("Uploads");
  await expect(rows(page).locator(".row-title")).toHaveText(["Retries", "Errors"]);
  await rows(page).nth(0).click();

  await expect(activeScreen(page).locator(".breadcrumbs")).toHaveText("Spec/Uploads/Retries");
  await expect(activeScreen(page).locator(".spec-item h2")).toHaveText("Retries");
  // Who it is for comes before what it must do.
  const stories = activeScreen(page).locator(".spec-story");
  await expect(stories.locator(".spec-req-head .spec-req-id")).toHaveText(["US-1", "US-2"]);
  await expect(stories.nth(0).locator(".spec-story-text")).toHaveText("As a commuter sending a file from a train, I want the upload to survive the tunnel, so that I don't have to start it again.");
  await expect(requirements(page).locator(".spec-req-head")).toHaveText(["R1must", "R2must", "R3should", "R4may"]);
  // Named values show as what they are, and a requirement that names one shows what it is.
  const values = activeScreen(page).locator(".spec-val");
  await expect(values.locator(".spec-req-id")).toHaveText(["retry.max", "retry.first-pause", "color.retrying", "retry.label"]);
  await expect(values.nth(0).locator(".spec-val-is")).toHaveText("5 times");
  await expect(values.nth(2).locator(".spec-swatch")).toHaveCount(2);
  await expect(values.nth(2).locator(".spec-swatch-fill").first()).toHaveCSS("background-color", "rgb(154, 103, 0)");
  await expect(requirements(page).nth(2).locator('.spec-value-ref[data-value="retry.first-pause"]')).toHaveText("retry.first-pause250ms");
  await expect(activeScreen(page).locator(".spec-figure img")).toHaveAttribute("alt", /^Pauses of 250 ms/);
  await expect(activeScreen(page).locator(".spec-figure figcaption")).toHaveText("Pauses double between attempts.");

  // Back goes up the way you came.
  await page.goBack();
  await expect(screenTitle(page)).toHaveText("Uploads");
  expect(errors).toEqual([]);
});

// Spec: S15, S22
test("an item links to related items and requirements, and points at no code", async ({ page }) => {
  await open(page, "/acme/rocket/spec?ref=main&id=uploads/retries");
  // A spec isn't tied to a code base: there is no list of files.
  await expect(activeScreen(page).getByRole("region", { name: "Code" })).toHaveCount(0);

  const related = activeScreen(page).getByRole("region", { name: "Related" });
  await expect(related.locator(".spec-link")).toHaveCount(2);
  await related.locator(".spec-link").nth(0).click();
  await expect(screenTitle(page)).toHaveText("Errors");
  await expect(requirements(page).nth(0)).toHaveAttribute("data-current", "true");
  await expect(requirements(page).nth(1)).toHaveAttribute("data-current", "false");
});

// Spec: S16, S17
test("deprecated requirements are kept, folded away, with why they went", async ({ page }) => {
  await open(page, "/acme/rocket/spec?ref=main&id=uploads/errors");
  // The live requirements read as the spec; the deprecated one isn't counted among them.
  await expect(activeScreen(page).getByRole("region", { name: "Requirements", exact: true }).locator(".spec-req-id")).toHaveText(["E1", "E2"]);
  const deprecated = activeScreen(page).getByRole("region", { name: "Deprecated requirements" });
  await expect(deprecated.locator(".spec-req")).toHaveCount(0);
  await deprecated.getByRole("button", { name: "1 deprecated requirement" }).click();
  const e3 = deprecated.locator('.spec-req[data-req="E3"]');
  await expect(e3).toHaveAttribute("data-deprecated", "true");
  await expect(e3.locator(".spec-req-head")).toHaveText("E3mustDeprecated");
  await expect(e3.locator(".spec-req-text")).toHaveText("A failed upload writes the server's reply to a log file.");
  await expect(e3.locator(".spec-deprecation-why")).toContainText("The reply could hold the upload token.");
  await expect(e3.locator(".spec-deprecation-why")).toContainText("Since 2026-09-14. Replaced by E1.");
  // What replaced it is a link to the requirement.
  await e3.getByRole("link", { name: "E1" }).click();
  await expect(requirements(page).nth(0)).toHaveAttribute("data-current", "true");

  // It is still found, by why it went, and opens unfolded.
  await open(page, "/acme/rocket/spec?q=hold%20the%20upload%20token");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("E3");
  await rows(page).click();
  await expect(activeScreen(page).locator('.spec-req[data-req="E3"]')).toHaveAttribute("data-current", "true");
  await open(page, "/acme/rocket/spec");
  await expect(activeScreen(page).locator(".spec-counts")).toHaveText("4 items · 4 named values · 2 user stories · 7 requirements · 1 deprecated");
});

// Spec: S19, S20
test("a requirement shows its version, and what it said before with why that changed", async ({ page }) => {
  await open(page, "/acme/rocket/spec?ref=main&id=uploads/errors");
  const e2 = activeScreen(page).locator('.spec-req[data-req="E2"]');
  // One that never changed carries no version.
  await expect(activeScreen(page).locator('.spec-req[data-req="E1"] .spec-version')).toHaveCount(0);
  await expect(e2.locator(".spec-history")).toHaveCount(0);
  await e2.getByRole("button", { name: "Version 3: show earlier versions" }).click();

  // Newest first: each earlier version, what it said, and why it was replaced.
  const earlier = e2.locator(".spec-history li");
  await expect(earlier.locator(".spec-history-head")).toHaveText(["v2until 2026-06-21", "v1shoulduntil 2026-02-03"]);
  await expect(earlier.locator(".spec-history-text")).toHaveText([
    "Error messages in the log leave out the upload token.",
    "Error messages are written to the log.",
  ]);
  await expect(earlier.nth(0).locator(".spec-history-why")).toHaveText("Changed because The token also reached callers through UploadError.");

  // The filter finds a requirement by what it used to say.
  await open(page, "/acme/rocket/spec?q=written%20to%20the%20log");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("E2");
});

// Spec: S6
test("the outline filters items and requirements", async ({ page }) => {
  await open(page, "/acme/rocket/spec");
  await activeScreen(page).getByRole("searchbox", { name: "Filter the spec" }).fill("no error message");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("E2");
  await expect(rows(page)).toContainText("Uploads / Errors");
  await rows(page).click();
  await expect(requirements(page).nth(1)).toHaveAttribute("data-current", "true");

  // Coming back shows the results again.
  await page.goBack();
  await expect(activeScreen(page).getByRole("searchbox", { name: "Filter the spec" })).toHaveValue("no error message");
  await expect(rows(page)).toHaveCount(1);
  await activeScreen(page).getByRole("searchbox", { name: "Filter the spec" }).fill("retries");
  await expect(rows(page).locator(".row-title")).toHaveText(["Retries"]);
  await activeScreen(page).getByRole("searchbox", { name: "Filter the spec" }).fill("zzz");
  await expect(activeScreen(page)).toContainText("Nothing matches");
});

// Spec: S3
test("a file that can't be read is a problem, and the rest still shows", async ({ page }) => {
  await open(page, "/acme/rocket/spec?ref=staging");
  const problems = activeScreen(page).locator(".spec-problems");
  await expect(problems).toContainText("2 problems in this spec");
  await expect(problems.locator("li")).toHaveText([
    'cli.json Unrecognized key: "sumary"',
    // Requirement ids are unique in the whole spec, not just in their item.
    // Reported on the later of the two files, by path.
    "uploads/retries.json Requirement id R1 is already in .spec/uploads/limits.json. Ids are unique in the whole spec.",
  ]);
  await expect(rows(page).locator(".row-title")).toHaveText(["Uploads", "cli"]);
  await rows(page).nth(1).click();
  await expect(activeScreen(page).locator(".banner-danger")).toContainText("This item couldn't be read");
});

// Spec: S11
test("a repository without a spec says so", async ({ page }) => {
  await open(page, "/octocat/hello");
  await expect(activeScreen(page).locator(".repo-header")).toBeVisible();
  await expect(activeScreen(page).locator(".spec-card")).toHaveCount(0);
  await activeScreen(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Browse spec" }).click();
  await expect(activeScreen(page)).toContainText("No spec here");

  // A prompt for a coding agent to write one.
  const copied = clipboard(page);
  await activeScreen(page).getByRole("button", { name: "Copy agent prompt" }).click();
  await expect(page.locator(".toast", { hasText: "Prompt copied" })).toBeVisible();
  expect(copied()[0]).toMatch(/^Set up a spec for octocat\/hello: write a `\.spec` folder at its root\./);
  expect(copied()[0]).toContain("## The schema");
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

// Spec: S11
test("the prompt for a repository with a spec hands over its outline and problems", async ({ page }) => {
  const copied = clipboard(page);
  await open(page, "/acme/rocket");
  await activeScreen(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Copy spec prompt" }).click();
  await expect.poll(() => copied().length).toBe(1);
  expect(copied()[0]).toMatch(/^Improve the spec of acme\/rocket/);
  expect(copied()[0]).toContain("- uploads/retries: Retries (4 requirements)");
  expect(copied()[0]).not.toContain("The app found these problems");

  await open(page, "/acme/rocket/spec?ref=staging");
  await activeScreen(page).locator(".spec-problems").getByRole("button", { name: "Copy agent prompt" }).click();
  await expect.poll(() => copied().length).toBe(2);
  expect(copied()[1]).toContain('- .spec/cli.json: Unrecognized key: "sumary"');
});

// Spec: S5, S12, S13
test("a huge spec opens at once and is read as it is looked at", async ({ page }) => {
  const errors = trackErrors(page);
  // How many files' contents were asked for, in how many requests.
  const read: number[] = [];
  page.on("console", (message) => {
    const match = /^\[mock\] spec-blobs (\d+)$/.exec(message.text());
    if (match) read.push(Number(match[1]));
  });
  const files = () => read.reduce((sum, count) => sum + count, 0);

  // acme/atlas has 3,041 items in 40 areas.
  await open(page, "/acme/atlas/spec?ref=main");
  await expect(activeScreen(page).locator(".spec-item h2")).toHaveText("Atlas");
  await expect(activeScreen(page).locator(".spec-counts")).toHaveText("3,040 items");
  await expect(rows(page)).toHaveCount(40);
  await expect(rows(page).nth(0)).toContainText("Area 1");
  await expect(rows(page).nth(0)).toContainText("75 items");
  // The outline needed the root and its 40 areas, not the 3,000 items below them.
  expect(files()).toBe(41);

  // An area reads its own items; long lists come a page at a time.
  await rows(page).nth(6).click();
  await expect(screenTitle(page)).toHaveText("Area 7");
  await expect(rows(page).nth(0).locator(".row-title")).toHaveText("Feature 7.1");
  await expect(rows(page).nth(0)).toContainText("2 requirements");
  expect(files()).toBe(41 + 75);

  // Filtering looks everywhere, so it reads the rest, and says so while it does.
  await page.goBack();
  await activeScreen(page).getByRole("searchbox", { name: "Filter the spec" }).fill("needle");
  await expect(rows(page)).toHaveCount(40);
  await expect(rows(page).nth(0)).toContainText("Feature 1.42");
  expect(files()).toBe(3041);
  // Never more than a batch per request.
  expect(Math.max(...read)).toBeLessThanOrEqual(40);
  expect(errors).toEqual([]);
});

// Spec: S5
test("comparing two versions of a huge spec reads only what differs", async ({ page }) => {
  const read: number[] = [];
  page.on("console", (message) => {
    const match = /^\[mock\] spec-blobs (\d+)$/.exec(message.text());
    if (match) read.push(Number(match[1]));
  });
  await open(page, "/acme/atlas/spec-diff?base=main&head=next");
  const changed = activeScreen(page).locator(".spec-change");
  await expect(changed.locator(".spec-change-title")).toHaveText(["Feature 7.1", "Feature 7.2", "Feature 7.3", "Feature 7.new"]);
  await expect(changed.nth(0).locator(".dir")).toHaveText("Area 7 / ");
  await expect(changed.nth(0).locator(".spec-diff-inline ins")).toHaveText("100");
  // Three changed items on each side, one new, and the folders above them for their names: 9 of 6,083 files.
  expect(read.reduce((sum, count) => sum + count, 0)).toBe(9);
});
