import { z } from "zod";
import { expect, test, type Page } from "@playwright/test";
import { activeScreen, open, trackErrors } from "./helpers";

// The catalogue of shared specs: acme/shared-specs offers Tandem and
// Telemetry (src/dev/mock.ts), and a part is pulled into acme/rocket as a
// pull request.
const sheet = (page: Page) => page.locator(".sheet");
const catalogue = (page: Page) => activeScreen(page).getByRole("region", { name: "acme/shared-specs" });
const TIP = "ba5eba11".padEnd(40, "0");

const Calls = z.array(z.object({ path: z.string(), body: z.record(z.string(), z.unknown()) }));

// Spec: SC1, SC2, SC3, SC4, SC5
test("a part of a shared spec is added to an app as a pull request", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/specs");
  await expect(activeScreen(page)).toContainText("No catalogues yet");
  await activeScreen(page).getByLabel("Add a catalogue").fill("acme/shared-specs");
  await activeScreen(page).getByRole("button", { name: "Add catalogue" }).click();

  // Its parts, with what they hold; each opens in the spec browser.
  await expect(catalogue(page)).toContainText("Tandem");
  await expect(catalogue(page).locator("img.spec-logo")).toHaveCount(1);
  // Only shared parts are offered: a folder without a permanent id isn't.
  await expect(catalogue(page)).not.toContainText("Drafts");
  await expect(catalogue(page)).toContainText("2 requirements · 2 parts · 1 value");
  await expect(catalogue(page)).toContainText("Telemetry");
  await expect(catalogue(page).getByRole("link", { name: /^Tandem/ })).toHaveAttribute("href", /#\/acme\/shared-specs\/spec\?id=tandem$/);

  // Into one of your repositories.
  await catalogue(page).getByRole("button", { name: "Use in…" }).first().click();
  await sheet(page).getByRole("button", { name: /^acme\/rocket/ }).click();
  await expect(sheet(page)).toContainText(`Copies .spec/tandem (3 files) from acme/shared-specs at ${TIP.slice(0, 7)}.`);
  await expect(sheet(page)).toContainText("Records it in imports in .spec/index.json.");
  await sheet(page).getByRole("button", { name: "Open pull request" }).click();
  await expect(page.locator(".toast", { hasText: "Pull request #483 opened. Point your coding agent at it." })).toBeVisible();
  await expect(page).toHaveURL(/#\/acme\/rocket\/pull\/483/);

  const calls = Calls.parse(JSON.parse(await page.evaluate(() => JSON.stringify(Reflect.get(window, "__specPull")))));
  expect(calls.map((call) => call.path.replace("/repos/acme/rocket", ""))).toEqual(["/git/blobs", "/git/blobs", "/git/blobs", "/git/trees", "/git/commits", "/git/refs", "/pulls"]);
  // The part's files are copied as they are, by object id; the root item records where from.
  const tree = z.object({ tree: z.array(z.object({ path: z.string(), content: z.string().optional(), sha: z.string().optional() })) }).parse(calls[3]?.body);
  expect(tree.tree.map((entry) => entry.path)).toEqual([".spec/index.json", ".spec/tandem/index.json", ".spec/tandem/pairing.json", ".spec/tandem/logo.png"]);
  expect(tree.tree.slice(1).every((entry) => entry.sha !== undefined && entry.content === undefined)).toBe(true);
  expect(JSON.parse(tree.tree[0]?.content ?? "")).toMatchObject({ title: "Rocket", imports: [{ id: "tandem", at: "tandem", from: "acme/shared-specs", commit: TIP }] });
  const pull = z.object({ title: z.string(), base: z.string(), body: z.string() }).parse(calls[6]?.body);
  expect(pull).toMatchObject({ title: 'Spec: use the shared part "Tandem" from acme/shared-specs', base: "main" });
  expect(pull.body).toContain("## For a coding agent");
  expect(errors).toEqual([]);
});

// Spec: SC1, SC3, SC4
test("a repository's menu adds it as a catalogue, or opens the catalogue to add a part to it", async ({ page }) => {
  await open(page, "/acme/rocket");
  await activeScreen(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Add to shared specs" }).click();
  await expect(page.locator(".toast", { hasText: "Added to your shared specs" })).toBeVisible();
  await activeScreen(page).getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Add to shared specs" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Add a shared part" }).click();
  await expect(page).toHaveURL(/#\/specs\?into=acme%2Frocket/);
  await expect(activeScreen(page)).toContainText("Pick a part to add to acme/rocket.");

  await page.evaluate(() => window.localStorage.setItem("ghc.spec-catalogues", JSON.stringify(["acme/shared-specs"])));
  await page.reload();
  // Straight to the review: the repository was chosen first.
  await catalogue(page).getByRole("button", { name: "Add" }).first().click();
  await expect(sheet(page)).toContainText("Copies .spec/tandem (3 files)");
  await expect(sheet(page).getByRole("button", { name: "Change" })).toHaveCount(0);
});

// Spec: SC2, SC6, S44
test("an imported part says where it came from, and what this repository does differently", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/spec?ref=with-sync&id=tandem");
  // A shared part is read with its logo, name and permanent id.
  const header = activeScreen(page).locator(".spec-item .spec-shared-title");
  await expect(header.locator("img.spec-logo")).toBeVisible();
  await expect(header).toContainText("Tandem");
  await expect(header).toContainText("Shared part · tandem");
  // The part itself shows the whole import.
  const panel = activeScreen(page).getByRole("region", { name: "Import" });
  await expect(panel).toContainText(`Fromacme/shared-specs at ${TIP.slice(0, 7)}`);
  await expect(panel.getByRole("link", { name: "acme/shared-specs" })).toHaveAttribute("href", new RegExp(`#/acme/shared-specs/spec\\?ref=${TIP}&id=tandem$`));
  await expect(panel).toContainText("CopyAs copied. It is changed in acme/shared-specs, not here.");
  await expect(panel).toContainText("Set here: tandem.pairing-lifetime is 5min. Pairing happens at a desk.");
  await expect(panel).toContainText("Waived here: #tandem.SYN-9. Rocket pairs with a token instead.");
  await expect(panel).toContainText("Up to date: acme/shared-specs has this part as it was copied.");
  // A part inside it says what it is part of, and what concerns it.
  await open(page, "/acme/rocket/spec?ref=with-sync&id=tandem/pairing");
  const inside = activeScreen(page).locator(".spec-item .banner").first();
  await expect(inside).toContainText("Part of Tandem (tandem), copied from acme/shared-specs.");
  await expect(inside).toContainText("Waived here: #tandem.SYN-9. Rocket pairs with a token instead.");
  // In the outline, the shared parts come first, the logo standing in for the folder icon. The copy is as copied: no problems.
  await open(page, "/acme/rocket/spec?ref=with-sync");
  const shared = activeScreen(page).getByRole("region", { name: "Shared parts" });
  await expect(shared.locator(".spec-row")).toHaveCount(1);
  await expect(shared.locator(".spec-row").locator("img.spec-logo")).toBeVisible();
  await expect(shared).toContainText("From acme/shared-specs · copied");
  await expect(shared).toContainText("1 value set · 1 waived");
  await expect(shared).not.toContainText("Update available");
  const own = activeScreen(page).getByRole("region", { name: "Own parts" });
  await expect(own).not.toContainText("Tandem");
  await expect(own).toContainText("Uploads");
  const sections = await activeScreen(page).locator("section[aria-label]").evaluateAll((all) => all.map((section) => section.getAttribute("aria-label")));
  expect(sections.indexOf("Shared parts")).toBeLessThan(sections.indexOf("Own parts"));
  await expect(activeScreen(page)).not.toContainText("isn't what was copied");
  expect(errors).toEqual([]);
});

// Spec: S44
test("a catalogue's own spec shows its shared parts with their logos", async ({ page }) => {
  await open(page, "/acme/shared-specs/spec?id=tandem");
  await expect(activeScreen(page).locator(".spec-item .spec-shared-title")).toContainText("Shared part · tandem");
  await expect(activeScreen(page).locator(".spec-item .spec-shared-title img.spec-logo")).toBeVisible();
  // Not copied from anywhere: no banner saying so.
  await expect(activeScreen(page).locator(".spec-item")).not.toContainText("Copied from");
});

// Spec: SC9
test("a part copied from an older version says so, and leads to the comparison and the update", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/spec?ref=with-old-sync");
  await expect(activeScreen(page).getByRole("region", { name: "Shared parts" })).toContainText("Update available");
  await open(page, "/acme/rocket/spec?ref=with-old-sync&id=tandem");
  const panel = activeScreen(page).getByRole("region", { name: "Import" });
  await expect(panel).toContainText("A newer version, as of");
  await expect(panel.getByRole("link", { name: "Compare" })).toHaveAttribute("href", new RegExp(`#/acme/shared-specs/spec-diff\\?base=01d5bec5\\w*&head=${TIP}$`));
  // Update opens the catalogue on that part, ready to add to this repository, even though the catalogue isn't in the list.
  await panel.getByRole("link", { name: "Update" }).click();
  await expect(page).toHaveURL(/#\/specs\?into=acme%2Frocket&from=acme%2Fshared-specs&part=tandem/);
  await expect(sheet(page)).toContainText('Add "Tandem"');
  await expect(sheet(page)).toContainText("acme/rocket");
  await expect(activeScreen(page).getByRole("button", { name: "Add to your list" })).toBeVisible();
  expect(errors).toEqual([]);
});
