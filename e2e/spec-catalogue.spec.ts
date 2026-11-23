import { z } from "zod";
import { expect, test, type Page } from "@playwright/test";
import { activeScreen, open, trackErrors } from "./helpers";

// The catalogue of shared specs: acme/shared-specs offers "sync" and
// "telemetry" (src/dev/mock.ts), and a part is pulled into acme/rocket as a
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
  await expect(catalogue(page)).toContainText("Sync");
  await expect(catalogue(page)).toContainText("2 requirements · 2 parts · 1 value");
  await expect(catalogue(page)).toContainText("Telemetry");
  await expect(catalogue(page).getByRole("link", { name: /^Sync/ })).toHaveAttribute("href", /#\/acme\/shared-specs\/spec\?id=sync$/);

  // Into one of your repositories.
  await catalogue(page).getByRole("button", { name: "Use in…" }).first().click();
  await sheet(page).getByRole("button", { name: /^acme\/rocket/ }).click();
  await expect(sheet(page)).toContainText(`Copies .spec/sync (2 files) from acme/shared-specs at ${TIP.slice(0, 7)}.`);
  await expect(sheet(page)).toContainText("Records it in imports in .spec/index.json.");
  await sheet(page).getByRole("button", { name: "Open pull request" }).click();
  await expect(page.locator(".toast", { hasText: "Pull request #483 opened. Point your coding agent at it." })).toBeVisible();
  await expect(page).toHaveURL(/#\/acme\/rocket\/pull\/483/);

  const calls = Calls.parse(JSON.parse(await page.evaluate(() => JSON.stringify(Reflect.get(window, "__specPull")))));
  expect(calls.map((call) => call.path.replace("/repos/acme/rocket", ""))).toEqual(["/git/blobs", "/git/blobs", "/git/trees", "/git/commits", "/git/refs", "/pulls"]);
  // The part's files are copied as they are, by object id; the root item records where from.
  const tree = z.object({ tree: z.array(z.object({ path: z.string(), content: z.string().optional(), sha: z.string().optional() })) }).parse(calls[2]?.body);
  expect(tree.tree.map((entry) => entry.path)).toEqual([".spec/index.json", ".spec/sync/index.json", ".spec/sync/pairing.json"]);
  expect(tree.tree.slice(1).every((entry) => entry.sha !== undefined && entry.content === undefined)).toBe(true);
  expect(JSON.parse(tree.tree[0]?.content ?? "")).toMatchObject({ title: "Rocket", imports: [{ at: "sync", from: "acme/shared-specs", commit: TIP }] });
  const pull = z.object({ title: z.string(), base: z.string(), body: z.string() }).parse(calls[5]?.body);
  expect(pull).toMatchObject({ title: 'Spec: use the shared part "Sync" from acme/shared-specs', base: "main" });
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
  await expect(sheet(page)).toContainText("Copies .spec/sync (2 files)");
  await expect(sheet(page).getByRole("button", { name: "Change" })).toHaveCount(0);
});

// Spec: SC6
test("an imported part says where it came from, and what this repository does differently", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/spec?ref=with-sync&id=sync");
  const banner = activeScreen(page).locator(".spec-item .banner").first();
  await expect(banner).toContainText(`Shared part from acme/shared-specs at ${TIP.slice(0, 7)}. It is changed there, not here.`);
  await expect(banner.getByRole("link", { name: /acme\/shared-specs/ })).toHaveAttribute("href", new RegExp(`#/acme/shared-specs/spec\\?ref=${TIP}&id=sync$`));
  await expect(banner).toContainText("Set here: sync.pairing-lifetime is 5min. Pairing happens at a desk.");
  await open(page, "/acme/rocket/spec?ref=with-sync&id=sync/pairing");
  await expect(activeScreen(page).locator(".spec-item .banner").first()).toContainText("Waived here: #SYN-9. Rocket pairs with a token instead.");
  // The copy is as it was copied: no problems on the outline.
  await open(page, "/acme/rocket/spec?ref=with-sync");
  await expect(activeScreen(page)).not.toContainText("isn't what was copied");
  expect(errors).toEqual([]);
});
