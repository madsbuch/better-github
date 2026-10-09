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

/**
 * Records whether a spinner or skeleton ever appears inside the screen from
 * now on (a MutationObserver, so even a single frame counts).
 */
export async function watchForLoading(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __loadingSeen: string[] }).__loadingSeen = seen;
    const check = (node: Node) => {
      if (!(node instanceof Element)) return;
      const hit = node.matches(".spinner, .skeleton") ? node : node.querySelector(".spinner, .skeleton");
      if (hit && hit.closest("section.screen")) seen.push(hit.className);
    };
    new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(check))).observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
  return () => page.evaluate(() => (window as unknown as { __loadingSeen: string[] }).__loadingSeen);
}
