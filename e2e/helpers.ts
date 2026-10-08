import type { Page } from "@playwright/test";

export const activeScreen = (page: Page) => page.locator("section.screen:not(.hidden)");
export const screenTitle = (page: Page) => activeScreen(page).locator(".appbar h1");

/** Collects uncaught errors and console errors for the page. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

let loads = 0;

/** Loads the app fresh at an in-app path (a new document, not a hash change). */
export async function open(page: Page, path: string) {
  await page.goto(`/?load=${loads++}#${path}`);
}
