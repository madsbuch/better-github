import { z } from "zod";
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

// Spec: RW1, RW3, RW4, RW5, RW9, RW10, RW11, RW13
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
  // It says what is wanted, and nothing about where it stands: there is no status.
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
  await bar(page).getByRole("button", { name: "Review & hand over" }).click();
  await expect(sheet(page).locator(".spec-diff-summary")).toHaveText("1 item ~11 user story +14 requirements +1~3");
  await expect(sheet(page).locator(".spec-diff-req:not(.spec-diff-story):not(.spec-diff-value) .spec-req-id")).toHaveText(["R1", "R2", "R3", "R5"]);
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
  expect(written).toMatchObject({ title: "Retries", requirements: [{ id: "R1", version: 2 }, { id: "R2", deprecation: { reason: "Uploads restart cheaply now." } }, { id: "R3" }, { id: "R4" }, { id: "R5" }] });
  expect(errors).toEqual([]);
});

// Spec: RW2, RW8
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

// Spec: RW6
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
  await expect(activeScreen(page).locator(".spec-item h2")).toHaveText("Resuming uploads");
  await activeScreen(page).getByRole("button", { name: "Add a requirement" }).click();
  // Its first requirement gets a prefix from its name.
  await expect(sheet(page).getByLabel("Id")).toHaveValue("RES-1");
  await sheet(page).getByLabel("What has to be true").fill("A retry asks the server how many bytes it has.");
  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();

  // An existing part: its own text, and deprecating it needs a reason.
  await open(page, "/acme/rocket/spec?ref=main&id=cli");
  await activeScreen(page).getByRole("button", { name: "Edit this part" }).click();
  await sheet(page).getByRole("checkbox", { name: /^Deprecated/ }).check();
  await expect(sheet(page).getByRole("button", { name: "Save" })).toBeDisabled();
  await sheet(page).getByLabel("Why it is no longer wanted").fill("There is an app now.");
  await sheet(page).getByRole("button", { name: "Save" }).click();
  await expect(activeScreen(page).locator(".spec-deprecation")).toContainText("There is an app now.");
  await expect(activeScreen(page).locator(".rework-item-tools .rework-mark")).toHaveText("Changed");

  await expect(bar(page)).toContainText("2 parts changed");
  await bar(page).getByRole("button", { name: "Review & hand over" }).click();
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

// Spec: RW14
test("a rework becomes a pull request that changes the spec and tells an agent what follows", async ({ page }) => {
  await open(page, "/acme/rocket/spec?ref=main&id=cli");
  await activeScreen(page).getByRole("button", { name: "Rework the spec" }).click();
  await activeScreen(page).getByRole("button", { name: "Add a requirement" }).click();
  await sheet(page).getByLabel("What has to be true").fill("`rocket --version` prints the version.");
  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();
  await bar(page).getByRole("button", { name: "Review & hand over" }).click();

  // Titled after the part, into the branch that was read.
  await expect(sheet(page).getByLabel("Pull request title")).toHaveValue("Spec: Command line");
  await expect(sheet(page)).toContainText("Into main, from a new branch.");
  await sheet(page).getByRole("button", { name: "Open a pull request" }).click();
  await expect(page.locator(".toast", { hasText: "Pull request #483 opened. Point your coding agent at it." })).toBeVisible();
  // The changes live in the pull request now: the draft is gone, and the app is at the pull request.
  await expect(page).toHaveURL(/#\/acme\/rocket\/pull\/483/);

  const sent = await page.evaluate(() => JSON.stringify(Reflect.get(window, "__specPull")));
  const calls = z.array(z.object({ path: z.string(), body: z.record(z.string(), z.unknown()) })).parse(JSON.parse(sent));
  expect(calls.map((call) => call.path.replace("/repos/acme/rocket", ""))).toEqual(["/git/trees", "/git/commits", "/git/refs", "/pulls"]);
  // One commit with the changed file, whole, on a branch of its own.
  const tree = z.object({ tree: z.array(z.object({ path: z.string(), content: z.string() })) }).parse(calls[0]?.body);
  expect(tree.tree.map((entry) => entry.path)).toEqual([".spec/cli.json"]);
  expect(JSON.parse(tree.tree[0]?.content ?? "")).toMatchObject({ title: "Command line", requirements: [{ id: "C1" }, { id: "C2", text: "`rocket --version` prints the version." }] });
  expect(calls[2]?.body.ref).toMatch(/^refs\/heads\/spec\/command-line-[0-9a-f]{6}$/);
  const pull = z.object({ title: z.string(), base: z.string(), head: z.string(), body: z.string() }).parse(calls[3]?.body);
  expect(pull).toMatchObject({ title: "Spec: Command line", base: "main" });
  expect(pull.head).toMatch(/^spec\/command-line-/);
  // The description is the handover: what changed, and what the agent does in this same pull request.
  expect(pull.body).toContain("### Command line (`.spec/cli.json`): changed");
  expect(pull.body).toContain("- C2: new (must).");
  expect(pull.body).toContain("## For the coding agent");
  expect(pull.body).toContain("requirement by requirement: C2");
  expect(pull.body).toContain("Push your commits to this branch.");
});

// Spec: RW15
test("a named value is edited with the input that fits it, and a change to what it is asks why", async ({ page }) => {
  await open(page, "/acme/rocket/spec?ref=main&id=uploads/retries");
  await activeScreen(page).getByRole("button", { name: "Rework the spec" }).click();
  const value = (id: string) => activeScreen(page).locator(`.spec-val[data-value="${id}"]`);

  // A color: the picker and the hex are one value.
  await value("color.retrying").getByRole("button", { name: "Revise" }).click();
  await expect(sheet(page).getByLabel("Color: pick")).toHaveValue("#9a6700");
  await sheet(page).getByLabel("Color: pick").fill("#1f6feb");
  await expect(sheet(page).getByLabel("Color: hex")).toHaveValue("#1f6feb");
  // What it is changed: no saving without the reason.
  await expect(sheet(page).getByRole("button", { name: "Save" })).toBeDisabled();
  await sheet(page).getByLabel("Why it changes").fill("Amber read as an error.");
  await sheet(page).getByRole("button", { name: "Save" }).click();
  await expect(value("color.retrying").locator(".rework-mark")).toHaveText("Revised");
  await expect(value("color.retrying").locator(".spec-swatch-fill").first()).toHaveCSS("background-color", "rgb(31, 111, 235)");
  await value("color.retrying").getByRole("button", { name: /show what it was before/ }).click();
  await expect(value("color.retrying").locator(".spec-history")).toContainText("Changed because Amber read as an error.");

  // A time: a number and a unit to pick.
  await value("retry.first-pause").getByRole("button", { name: "Revise" }).click();
  await expect(sheet(page).getByLabel("Time")).toHaveValue("250");
  await expect(sheet(page).getByLabel("Unit")).toHaveValue("ms");
  await page.keyboard.press("Escape");

  // A new one: its name has to be free, and its kind picks its input.
  await activeScreen(page).getByRole("button", { name: "Add a value" }).click();
  await sheet(page).getByLabel(/^Name/).fill("retry.max");
  await expect(sheet(page)).toContainText("retry.max is already in Retries.");
  await sheet(page).getByLabel(/^Name/).fill("upload.max-size");
  await sheet(page).getByLabel(/^Kind/).selectOption("number");
  await sheet(page).getByRole("spinbutton", { name: "Number" }).fill("200");
  await sheet(page).getByLabel(/What it counts/).fill("MB");
  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(value("upload.max-size").locator(".spec-val-is")).toHaveText("200 MB");

  // The handover says which values changed, to what, and why.
  const copied = clipboard(page);
  await bar(page).getByRole("button", { name: "Review & hand over" }).click();
  await expect(sheet(page).locator(".spec-diff-summary")).toHaveText("1 item ~12 values +1~1");
  await sheet(page).getByRole("button", { name: "Copy for my agent" }).click();
  await expect(page.locator(".toast", { hasText: "Copied." })).toBeVisible();
  const handover = copied()[0] ?? "";
  expect(handover).toContain("- color.retrying: was #9a6700 (dark: #d29922), now #1f6feb (dark: #d29922). Why: Amber read as an error.");
  expect(handover).toContain("- upload.max-size: new number value, 200 MB.");
  expect(handover).toContain("value by value: color.retrying, upload.max-size");
});

