import { expect, test, type Locator, type Page } from "@playwright/test";
import { activeScreen, boxOf, open, present, screenTitle, trackErrors } from "./helpers";

async function expectWithinViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const viewport = present(page.viewportSize(), "a viewport");
  // Resizing across the breakpoint changes the sheet's entrance animation.
  await expect.poll(async () => {
    const bounds = await locator.boundingBox();
    return bounds !== null && bounds.x >= 0 && bounds.y >= 0
      && bounds.x + bounds.width <= viewport.width + 1
      && bounds.y + bounds.height <= viewport.height + 1;
  }).toBe(true);
}

async function expectNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const viewport of [{ width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
  test.describe(`tablet ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, screen: viewport, hasTouch: true, reducedMotion: "reduce" });

    test("navigation stays beside the content on root and detail screens", async ({ page }) => {
      const errors = trackErrors(page);
      await open(page, "/");
      const navigation = page.getByRole("navigation", { name: "Main" });
      await expect(navigation).toBeVisible();
      const rail = await boxOf(navigation);
      const content = await boxOf(activeScreen(page));
      expect(rail.height).toBeGreaterThan(rail.width);
      expect(rail.x + rail.width).toBeLessThanOrEqual(content.x + 1);
      await expectWithinViewport(page, navigation);
      await expect(page.locator(".tabbar")).toBeHidden();
      await expect(screenTitle(page)).toHaveText("Repositories");
      await expect(navigation.getByRole("button")).toHaveText(["Repos", "Orgs", "You", "Settings"]);

      await activeScreen(page).locator("a.row").first().tap();
      await expect(screenTitle(page)).toHaveText("rocket");
      await activeScreen(page).getByRole("button", { name: "Review pull requests" }).tap();
      await activeScreen(page).locator("a.row").first().tap();
      await expect(screenTitle(page)).toHaveText(/^Add retry/);
      await expect(navigation).toBeVisible();
      await navigation.getByRole("button", { name: "Repos", exact: true }).tap();
      await expect(screenTitle(page)).toHaveText("Repositories");
      await expect(navigation.getByRole("button", { name: "Repos", exact: true })).toHaveAttribute("aria-current", "page");
      await activeScreen(page).locator("a.row").first().tap();
      await expect(screenTitle(page)).toHaveText("rocket");
      await navigation.getByRole("button", { name: "You", exact: true }).tap();
      await expect(screenTitle(page)).toHaveText("You");
      await expectNoPageOverflow(page);
      expect(errors).toEqual([]);
    });

    test("wide diffs support touch comments in an inset dialog", async ({ page }) => {
      const errors = trackErrors(page);
      await open(page, "/acme/rocket/pull/482?tab=files");
      const file = activeScreen(page).locator(".diff-file").first();
      await expect(file).toBeVisible();
      expect((await boxOf(file)).width).toBeGreaterThan(viewport.width * 0.65);
      await expectNoPageOverflow(page);

      await activeScreen(page).locator(".dl.add").nth(2).tap();
      const dialog = page.getByRole("dialog", { name: /Comment · line/ });
      await expectWithinViewport(page, dialog);
      const bounds = await boxOf(dialog);
      expect(bounds.x).toBeGreaterThan(0);
      expect(bounds.y).toBeGreaterThan(0);
      expect(bounds.width).toBeLessThan(viewport.width);
      await dialog.locator("textarea").fill("Keep this comment readable on a tablet.");
      await expectWithinViewport(page, dialog.getByRole("button", { name: "Add to review" }));
      await dialog.getByRole("button", { name: "Add to review" }).tap();
      await expect(dialog).toHaveCount(0);
      const draft = activeScreen(page).locator(".draft-comment");
      await expect(draft).toContainText("Keep this comment readable on a tablet.");
      const content = activeScreen(page).locator(".content");
      // A window this wide shows the two sides next to each other; wrapping is for one column.
      const oneColumn = activeScreen(page).getByRole("button", { name: "Show in one column" });
      if (viewport.width >= 1100) {
        await expect(file.locator(".diff-body").first()).toHaveClass("diff-body split");
        await oneColumn.tap();
      } else {
        await expect(oneColumn).toHaveCount(0);
      }
      for (const wrap of [true, false]) {
        if (!wrap) await activeScreen(page).getByRole("button", { name: "Toggle line wrap" }).tap();
        await expect(file.locator(".diff-body").first()).toHaveClass(wrap ? /\bwrap\b/ : /^diff-body$/);
        const bounds = await boxOf(draft);
        const pane = await boxOf(content);
        expect(bounds.x).toBeGreaterThanOrEqual(pane.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
      }
      await expectNoPageOverflow(page);

      await page.locator(".bottom-bar").getByRole("button", { name: /Review/ }).tap();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.goBack();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(screenTitle(page)).toHaveText(/^Add retry/);
      expect(errors).toEqual([]);
    });
  });
}

test.describe("resizing and split-screen", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true, reducedMotion: "reduce" });

  test("an open comment survives phone and short tablet layouts", async ({ page }) => {
    const errors = trackErrors(page);
    await open(page, "/acme/rocket/pull/482?tab=files");
    await activeScreen(page).locator(".dl.add").nth(2).tap();
    const dialog = page.getByRole("dialog", { name: /Comment · line/ });
    const comment = "Retain this draft when rotating or resizing.";
    await dialog.locator("textarea").fill(comment);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".nav-rail")).toBeHidden();
    await expect(page.locator(".tabbar")).toHaveCount(0);
    await expectWithinViewport(page, dialog);
    await expect(dialog.locator("textarea")).toHaveValue(comment);

    // A short viewport approximates a landscape tablet with the keyboard open.
    await page.setViewportSize({ width: 768, height: 420 });
    await expect(page.locator(".nav-rail")).toBeVisible();
    await expectWithinViewport(page, dialog);
    await expect(dialog.locator("textarea")).toHaveValue(comment);
    await expectWithinViewport(page, dialog.getByRole("button", { name: "Add to review" }));
    await dialog.getByRole("button", { name: "Add to review" }).tap();
    await expect(activeScreen(page).locator(".draft-comment")).toContainText(comment);
    await expectNoPageOverflow(page);

    await page.locator(".nav-rail").getByRole("button", { name: "Repos", exact: true }).tap();
    await expect(screenTitle(page)).toHaveText("Repositories");
    await page.setViewportSize({ width: 600, height: 800 });
    await expect(page.locator(".nav-rail")).toBeHidden();
    await expect(page.locator(".tabbar")).toBeVisible();
    const screen = await boxOf(activeScreen(page));
    const tabs = await boxOf(page.locator(".tabbar"));
    expect(screen.y + screen.height).toBeLessThanOrEqual(tabs.y + 1);
    await page.locator(".tabbar").getByRole("button", { name: "You", exact: true }).tap();
    await expect(screenTitle(page)).toHaveText("You");
    expect(errors).toEqual([]);
  });

  test("a short tablet window can scroll to the last menu action", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 320 });
    await open(page, "/acme/rocket/pull/482");
    await activeScreen(page).getByRole("button", { name: "More", exact: true }).tap();
    const menu = page.getByRole("menu", { name: "Pull request" });
    await expectWithinViewport(page, menu);
    const scroller = menu.locator(".sheet-menu");
    expect(await scroller.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
    const bounds = await boxOf(scroller);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const lastAction = menu.getByRole("menuitem", { name: "Close pull request", exact: true });
    await expect(lastAction).toBeInViewport({ ratio: 1 });
    await lastAction.tap();
    await expect(menu).toHaveCount(0);
    await expect(page.locator(".toast", { hasText: "Pull request closed" })).toBeVisible();
  });
});
