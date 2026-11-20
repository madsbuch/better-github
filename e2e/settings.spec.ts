import { expect, test, type Page } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

const menu = (page: Page) => activeScreen(page).getByRole("navigation", { name: "Settings" });
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

/** Counts the page cross-fades the browser is asked for from now on. */
async function countFades(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const original = document.startViewTransition.bind(document);
    window.__fades = 0;
    document.startViewTransition = (update?: () => void | Promise<void>) => {
      window.__fades = (window.__fades ?? 0) + 1;
      return original(update);
    };
  });
  return () => page.evaluate(() => window.__fades ?? 0);
}

// Spec: SET-1, SET-2, SET-3, SET-6
test("settings is a section of the app: a menu, and a page for each part", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/repos");
  const navigation = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  await navigation.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(screenTitle(page)).toHaveText("Settings");
  // On a phone the menu is the screen; each entry says what it is set to.
  await expect(menu(page).locator(".settings-entry-title")).toHaveText(["Account", "Appearance", "Code and diffs", "GitHub sign-in", "About"]);
  await expect(menu(page).getByRole("link", { name: /Account/ })).toContainText("Signed in as octocat");
  await expect(menu(page).getByRole("link", { name: /Appearance/ })).toContainText("Same as the device");
  await expect(activeScreen(page).locator(".settings-page")).toHaveCount(0);

  // A page is a screen of its own, and back returns to the menu.
  await menu(page).getByRole("link", { name: /Code and diffs/ }).click();
  await expect(screenTitle(page)).toHaveText("Code and diffs");
  await expect(menu(page)).toHaveCount(0);
  await activeScreen(page).getByLabel("Wrap long lines in files").check();
  await page.goBack();
  await expect(screenTitle(page)).toHaveText("Settings");

  // Signing out is under Account, with the rate limit.
  await menu(page).getByRole("link", { name: /Account/ }).click();
  await expect(activeScreen(page)).toContainText("API rate limit");
  await expect(activeScreen(page).getByRole("button", { name: "Sign out" })).toBeVisible();
  // The profile no longer carries settings.
  await open(page, "/profile");
  await expect(activeScreen(page).getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(activeScreen(page).getByRole("button", { name: "Sign out" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Spec: SET-7, SET-8, DS-C2
test("switching between light and dark is a fade, not a jump", async ({ page }) => {
  await open(page, "/settings/appearance");
  const fades = await countFades(page);
  const options = activeScreen(page).getByRole("radiogroup", { name: "Theme" });
  await options.getByRole("radio", { name: "Dark" }).click();
  await expect.poll(() => theme(page)).toBe("dark");
  await expect(options.getByRole("radio", { name: "Dark" })).toBeChecked();
  expect(await fades()).toBe(1);
  await options.getByRole("radio", { name: "Light" }).click();
  await expect.poll(() => theme(page)).toBe("light");
  expect(await fades()).toBe(2);
  // Picking what is already showing changes nothing, so nothing fades.
  await options.getByRole("radio", { name: "Light" }).click();
  expect(await fades()).toBe(2);

  // The choice is kept, and a fresh start paints it at once.
  await open(page, "/settings/appearance");
  expect(await theme(page)).toBe("light");
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  // Spec: SET-8
  test("the theme switches at once", async ({ page }) => {
    await open(page, "/settings/appearance");
    const fades = await countFades(page);
    await activeScreen(page).getByRole("radio", { name: "Dark" }).click();
    await expect.poll(() => theme(page)).toBe("dark");
    expect(await fades()).toBe(0);
  });
});

// Spec: SET-4, SET-5
for (const [name, use] of [
  ["a tablet", { viewport: { width: 820, height: 1180 }, hasTouch: true }],
  ["a computer", { viewport: { width: 1280, height: 860 }, hasTouch: false, isMobile: false }],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use(use);
    test("the menu stays beside the page that is open", async ({ page }) => {
      const errors = trackErrors(page);
      await open(page, "/repos");
      const rail = page.locator(".nav-rail");
      await rail.getByRole("button", { name: "Settings", exact: true }).click();
      // Both at once, with the first page open.
      await expect(menu(page)).toBeVisible();
      await expect(activeScreen(page).getByRole("region", { name: "Account" })).toBeVisible();
      await expect(menu(page).getByRole("link", { name: /Account/ })).toHaveAttribute("aria-current", "page");
      const [menuBox, pageBox] = [await menu(page).boundingBox(), await activeScreen(page).locator(".settings-page").boundingBox()];
      expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual((pageBox?.x ?? 0) + 1);

      // Picking another swaps the page; the menu and the sidebar stay.
      await menu(page).getByRole("link", { name: /Appearance/ }).click();
      await expect(activeScreen(page).getByRole("region", { name: "Appearance" })).toBeVisible();
      await expect(menu(page).getByRole("link", { name: /Appearance/ })).toHaveAttribute("aria-current", "page");
      await expect(rail.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
      await menu(page).getByRole("link", { name: /About/ }).click();
      await expect(activeScreen(page).getByRole("region", { name: "About" })).toBeVisible();
      // Pages swap in place: one step back is where Settings was entered, not the page before.
      await page.goBack();
      await expect(activeScreen(page).getByRole("region", { name: "Account" })).toBeVisible();
      await expect(menu(page).getByRole("link", { name: /Account/ })).toHaveAttribute("aria-current", "page");
      expect(errors).toEqual([]);
    });
  });
}

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 860 }, hasTouch: false, isMobile: false });
  // Spec: SET-9, K11
  test("settings open from the keyboard, and list the shortcuts", async ({ page }) => {
    await open(page, "/repos");
    await expect(screenTitle(page)).toHaveText("Repositories");
    await page.keyboard.press("Control+,");
    await expect(screenTitle(page)).toHaveText("Settings");
    await menu(page).getByRole("link", { name: /Keyboard shortcuts/ }).click();
    await expect(activeScreen(page).getByRole("region", { name: "Keyboard shortcuts" })).toContainText("Settings");
  });
});
