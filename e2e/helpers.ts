import type { Locator, Page } from "@playwright/test";

// What the tests put on the page's window (in the browser, see the callers).
declare global {
  interface Window {
    __loadingSeen?: string[];
    __downloads?: string[][];
    finishDownloadUrl?: () => void;
  }
}

/** `value`, failing the test with `what` when it is missing. */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what}`);
  return value;
}

/** The element's bounding box; fails the test when it isn't visible. */
export async function boxOf(locator: Locator) {
  return present(await locator.boundingBox(), "a visible element");
}

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
  await page.goto(`/?load=${(loads++).toString()}#${path}`);
}

/**
 * Records whether a spinner or skeleton ever appears inside a screen or a
 * sheet from now on (a MutationObserver, so even a single frame counts).
 */
export async function watchForLoading(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    window.__loadingSeen = seen;
    const check = (node: Node) => {
      if (!(node instanceof Element)) return;
      const hit = node.matches(".spinner, .skeleton") ? node : node.querySelector(".spinner, .skeleton");
      const where = hit?.closest("section.screen, .sheet");
      if (!hit || !where) return;
      // Where it was, so a failure says which data wasn't ready.
      const title = where.querySelector(".appbar h1, .sheet-header h2")?.textContent;
      const tab = where.querySelector("[role=tab][aria-selected=true]")?.textContent.replace(/\d+$/, "");
      seen.push(`${hit.className} on "${title ?? "undefined"}"${tab !== undefined && tab !== "" ? `, ${tab} tab` : ""}`);
    };
    new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(check))).observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
  return () => page.evaluate(() => window.__loadingSeen ?? []);
}
