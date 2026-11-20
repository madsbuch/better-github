import { devices, expect, test } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

// A desktop window: a mouse that hovers, a keyboard, no touch.
test.use({ ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } });

// Spec: K3, DS-L1
test("the layout uses the window: a sidebar with names, and no bottom tabs", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/repos");
  const rail = page.locator(".nav-rail");
  await expect(rail).toBeVisible();
  await expect(page.locator(".tabbar")).toBeHidden();
  await expect(rail.getByRole("button", { name: "Repos" })).toHaveCSS("flex-direction", "row");
  expect((await rail.boundingBox())?.width).toBe(200);
  expect(errors).toEqual([]);
});

// Spec: K9, K10, ORG-6
test("keyboard shortcuts go to search, back and forward, and to the main sections", async ({ page }) => {
  await open(page, "/repos");
  await expect(screenTitle(page)).toHaveText("Repositories");
  await page.keyboard.press("/");
  await expect(screenTitle(page)).toHaveText("Search");
  // The search field has focus, and typing a slash into it is just a slash.
  await expect(activeScreen(page).getByRole("searchbox")).toBeFocused();
  await page.keyboard.type("a/b");
  await expect(activeScreen(page).getByRole("searchbox")).toHaveValue("a/b");

  await page.keyboard.press("Escape");
  await expect(activeScreen(page).getByRole("searchbox")).not.toBeFocused();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(screenTitle(page)).toHaveText("Repositories");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(screenTitle(page)).toHaveText("Search");
  await page.keyboard.press("Control+3");
  await expect(page.locator(".nav-rail button[aria-current=page]")).toHaveText("You");
  await page.keyboard.press("Control+2");
  await expect(screenTitle(page)).toHaveText("Organizations");
  await page.keyboard.press("Control+1");
  await expect(screenTitle(page)).toHaveText("Repositories");
  await page.keyboard.press("Control+k");
  await expect(screenTitle(page)).toHaveText("Search");
});

// Spec: K7, K8
test("menus and dialogs work from the keyboard", async ({ page }) => {
  await open(page, "/acme/rocket");
  const more = activeScreen(page).getByRole("button", { name: "More" });
  await more.click();
  const items = page.getByRole("menuitem");
  // Focus moves into the menu; the arrows move through it and wrap.
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(items.last()).toBeFocused();

  // Escape closes it and focus returns to the button that opened it.
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(screenTitle(page)).toHaveText("rocket");

  // Enter picks an item.
  await more.click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".toast", { hasText: "Link copied" })).toBeVisible();
});

// Spec: K6, K7
test("only the dialog on top closes on Escape, and Tab stays inside it", async ({ page }) => {
  await open(page, "/acme/rocket/pull/482?tab=files");
  await page.locator(".bottom-bar").getByRole("button", { name: /Review/ }).click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toHaveCount(1);
  // With a keyboard, the dialog's text field is ready to type in.
  await expect(sheet.locator("textarea").first()).toBeFocused();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest(".sheet") instanceof Element)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(screenTitle(page)).toContainText("Add retry");
});

// Spec: K5
test("a screen refreshes from its button and from the keyboard, without reloading the page", async ({ page }) => {
  await open(page, "/acme/rocket");
  await expect(activeScreen(page).locator(".repo-header")).toBeVisible();
  await page.evaluate(() => {
    window.__loadingSeen = ["still the same page"];
  });
  const refresh = activeScreen(page).getByRole("button", { name: "Refresh" });
  await expect(refresh).toBeVisible();
  // Its name shows when the pointer rests on it.
  await refresh.hover();
  await expect(refresh).toHaveAttribute("title", "Refresh");
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await page.keyboard.press("Control+r");
  await expect(refresh).toBeEnabled();
  await expect(activeScreen(page).locator(".repo-header")).toBeVisible();
  expect(await page.evaluate(() => window.__loadingSeen)).toEqual(["still the same page"]);
});

// Spec: K4
test("rows and buttons respond to the pointer", async ({ page }) => {
  await open(page, "/repos");
  const row = activeScreen(page).locator("a.row").first();
  await expect(row).toBeVisible();
  const before = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
  await row.hover();
  await expect.poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
});

// Spec: K11
test("settings list the shortcuts", async ({ page }) => {
  await open(page, "/settings/shortcuts");
  await expect(activeScreen(page).getByRole("region", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(activeScreen(page).locator(".shortcut-keys").first()).toContainText("/");
});

// Spec: K12, K13
test("wide windows show diffs side by side, and lines on either side take comments", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/pull/482?tab=files");
  const file = activeScreen(page).locator('.diff-file[data-path="src/client.rs"]');
  const rows = file.locator(".dl-row");
  await expect(file.locator(".diff-body.split")).toBeVisible();
  // An unchanged line is on both sides; a replaced one has the old text left and the new right.
  await expect(rows.nth(0).locator(".dl.ctx")).toHaveCount(2);
  const replaced = rows.filter({ has: page.locator(".dl.del") }).first();
  await expect(replaced.locator(".dl").nth(0)).toHaveClass(/del/);
  await expect(replaced.locator(".dl").nth(0).locator(".dl-num")).toHaveText("18");
  await expect(replaced.locator(".dl").nth(1)).toHaveClass(/add/);
  await expect(replaced.locator(".dl").nth(1).locator(".dl-num")).toHaveText("20");
  // An added line with nothing removed next to it leaves the left side blank.
  await expect(rows.filter({ has: page.locator(".dl.empty") }).first().locator(".dl").nth(1)).toHaveClass(/add/);
  // Neither side scrolls sideways.
  expect(await file.locator(".diff-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  // Commenting on the old side anchors there.
  await replaced.locator(".dl.del").click();
  await expect(page.locator(".sheet")).toBeVisible();
  await expect(replaced.locator(".dl.del")).toHaveClass(/selected/);
  await page.keyboard.press("Escape");

  // It's a preference, and narrow windows always get one column.
  await open(page, "/settings/code");
  await activeScreen(page).getByLabel("Show diffs side by side in wide windows").uncheck();
  await open(page, "/acme/rocket/pull/482?tab=files");
  await expect(file.locator(".dl").first()).toBeVisible();
  await expect(file.locator(".diff-body.split")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Spec: K14
test("a narrower window keeps diffs in one column", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await open(page, "/acme/rocket/pull/482?tab=files");
  const file = activeScreen(page).locator('.diff-file[data-path="src/client.rs"]');
  await expect(file.locator(".dl").first()).toBeVisible();
  await expect(file.locator(".diff-body.split")).toHaveCount(0);
});
