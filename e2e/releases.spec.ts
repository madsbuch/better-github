import { expect, test, type Page } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

/** Stands in for Android's download manager bridge (Downloads.kt), recording requests. */
async function fakeDownloadManager(page: Page) {
  await page.addInitScript(() => {
    const calls: string[][] = [];
    Object.assign(window, {
      __downloads: calls,
      GhCommanderDownloads: {
        download(url: string, name: string, mime: string) {
          calls.push([url, name, mime]);
          return true;
        },
      },
    });
  });
  return () => page.evaluate(() => (window as unknown as { __downloads: string[][] }).__downloads);
}

test("browse releases and download an asset to the phone", async ({ page }) => {
  const errors = trackErrors(page);
  const downloads = await fakeDownloadManager(page);
  await open(page, "/acme/rocket?tab=releases");
  const rows = activeScreen(page).locator("a.row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("Latest");
  await expect(rows.nth(1)).toContainText("Pre-release");

  await rows.first().click();
  await expect(screenTitle(page)).toHaveText("Rocket 2.0");
  const screen = activeScreen(page);
  await expect(screen.locator(".markdown")).toContainText("Resumable uploads");
  // Three assets and the two source archives.
  await expect(screen.getByRole("button", { name: /^Download / })).toHaveCount(5);

  await screen.getByRole("button", { name: "Download rocket-v2.0.0.apk" }).click();
  await expect(page.locator(".toast", { hasText: "Downloading rocket-v2.0.0.apk" })).toBeVisible();
  await screen.getByRole("button", { name: "Download Source code (zip)" }).click();
  await expect(page.locator(".toast", { hasText: "Downloading rocket-v2.0.0.zip" })).toBeVisible();
  expect(await downloads()).toEqual([
    ["https://objects.githubusercontent.com/mock/11", "rocket-v2.0.0.apk", "application/vnd.android.package-archive"],
    ["https://codeload.github.com/mock/v2.0.0.zip", "rocket-v2.0.0.zip", "application/zip"],
  ]);
  expect(errors).toEqual([]);
});

test("without the download manager, the link opens in the browser", async ({ page }) => {
  const opened: string[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("[mock] open")) opened.push(message.text());
  });
  await open(page, "/acme/rocket/releases/tag/v2.0.0");
  await activeScreen(page).getByRole("button", { name: "Download checksums.txt" }).click();
  await expect.poll(() => opened).toEqual(["[mock] open https://objects.githubusercontent.com/mock/13"]);
});

test("the latest release shows on the repository and opens", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket");
  await activeScreen(page).locator(".latest-release").click();
  await expect(screenTitle(page)).toHaveText("Rocket 2.0");
  await expect(page).toHaveURL(/\/releases\/tag\/v2\.0\.0/);
  expect(errors).toEqual([]);
});

test("release notifications open the release", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/notifications?filter=all");
  await activeScreen(page).getByRole("link", { name: /v2\.0\.0/ }).click();
  await expect(screenTitle(page)).toHaveText("Rocket 2.0");
  expect(errors).toEqual([]);
});

test("a release without notes or assets", async ({ page }) => {
  await open(page, "/acme/rocket/releases/tag/v1.4.2");
  await expect(screenTitle(page)).toHaveText("v1.4.2");
  await expect(activeScreen(page).getByText("No release notes.")).toBeVisible();
  // A published release always has its source.
  await expect(activeScreen(page).getByRole("button", { name: /^Download Source code/ })).toHaveCount(2);
});

test("an unknown release, with a slash in its tag", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/acme/rocket/releases/tag/release%2F9.9");
  await expect(screenTitle(page)).toHaveText("release/9.9");
  await expect(activeScreen(page).getByText("Release not found")).toBeVisible();
  expect(errors).toEqual([]);
});
