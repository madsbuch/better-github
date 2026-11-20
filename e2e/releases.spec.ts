import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

/** JSON the fake download bridge keeps in sessionStorage, read on the test's side. */
async function stored(page: Page, key: string, fallback: string): Promise<unknown> {
  const text = await page.evaluate((name) => sessionStorage.getItem(name), key);
  return JSON.parse(text === null || text === "" ? fallback : text);
}

const DownloadRecords = z.record(z.string(), z.unknown());
const downloadRecords = async (page: Page) => DownloadRecords.parse(await stored(page, "native-downloads", "{}"));
const openedDownloads = async (page: Page) => z.array(z.string()).parse(await stored(page, "opened-downloads", "null"));

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
  return () => page.evaluate(() => window.__downloads ?? []);
}

/** DownloadManager survives a web-view reload; persist the fake's records too. */
async function trackedDownloadManager(page: Page) {
  await page.addInitScript(() => {
    const read = (key: string, fallback: string): unknown => {
      const text = sessionStorage.getItem(key);
      return JSON.parse(text === null || text === "" ? fallback : text);
    };
    const saved = (): Record<string, unknown> => {
      const value = read("native-downloads", "{}");
      return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
    };
    const flag = (key: string) => {
      const value = sessionStorage.getItem(key);
      return value !== null && value !== "" ? value : null;
    };
    Object.assign(window, {
      GhCommanderDownloads: {
        download() { throw new Error("Expected the tracked download bridge"); },
        enqueue(url: string, name: string, mime: string) {
          if (flag("fail-enqueue") !== null) return "";
          const records = saved();
          const id = (Object.keys(records).length + 1).toString();
          records[id] = { status: "running", downloadedBytes: 512, totalBytes: 1024 };
          sessionStorage.setItem("native-downloads", JSON.stringify(records));
          sessionStorage.setItem("last-download", JSON.stringify({ url, name, mime, id }));
          return id;
        },
        status(id: string) {
          return JSON.stringify(saved()[id] ?? { status: "missing", downloadedBytes: 0, totalBytes: 0 });
        },
        open(id: string) {
          const value = read("opened-downloads", "[]");
          const opened: unknown[] = Array.isArray(value) ? value : [];
          opened.push(id);
          sessionStorage.setItem("opened-downloads", JSON.stringify(opened));
          return flag("open-result") ?? "opened";
        },
      },
    });
  });
}

async function finishDownload(page: Page, status = "successful", reason?: string, count = 1) {
  await expect.poll(async () => Object.keys(await downloadRecords(page)).length).toBe(count);
  const records = await downloadRecords(page);
  const last = z.object({ id: z.string() }).parse(await stored(page, "last-download", "null"));
  records[last.id] = { status, downloadedBytes: 1024, totalBytes: 1024, reason };
  await page.evaluate((json) => sessionStorage.setItem("native-downloads", json), JSON.stringify(records));
}

test("a completed APK opens from its release and stays available after a reload", async ({ page }) => {
  const errors = trackErrors(page);
  await trackedDownloadManager(page);
  await open(page, "/acme/rocket/releases/tag/v2.0.0");
  const download = activeScreen(page).getByRole("button", { name: "Download rocket-v2.0.0.apk", exact: true });
  await download.click();
  await expect(download).toBeDisabled();
  await expect(activeScreen(page).getByText("Downloading · 512 B of 1 KB")).toBeVisible();
  await finishDownload(page);
  const openFile = activeScreen(page).getByRole("button", { name: "Open rocket-v2.0.0.apk", exact: true });
  await expect(openFile).toBeEnabled();
  await openFile.click();
  expect(await openedDownloads(page)).toEqual(["1"]);

  await page.reload();
  await expect(openFile).toBeEnabled();
  await openFile.click();
  expect(await openedDownloads(page)).toEqual(["1", "1"]);
  expect(Object.keys(await downloadRecords(page))).toHaveLength(1);
  // Only the native ID is saved; signed download links must not persist in app storage.
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("ghc.download."))
        .map((key) => localStorage.getItem(key)),
    ),
  ).toEqual(["1"]);
  expect(errors).toEqual([]);
});

test("APK permission, missing files, and failed downloads have a recovery action", async ({ page }) => {
  await trackedDownloadManager(page);
  await open(page, "/acme/rocket/releases/tag/v2.0.0");
  const screen = activeScreen(page);
  await screen.getByRole("button", { name: "Download rocket-v2.0.0.apk", exact: true }).click();
  await finishDownload(page);
  const openFile = screen.getByRole("button", { name: "Open rocket-v2.0.0.apk", exact: true });
  await page.evaluate(() => sessionStorage.setItem("open-result", "permission_required"));
  await openFile.click();
  await expect(screen.getByRole("status")).toContainText("Allow Better GitHub to install apps");
  await page.evaluate(() => { sessionStorage.removeItem("open-result"); window.dispatchEvent(new Event("focus")); });
  await openFile.click();
  await expect(screen.getByRole("status")).toContainText("Downloaded");

  await page.evaluate(() => sessionStorage.setItem("open-result", "missing"));
  await openFile.click();
  const retry = screen.getByRole("button", { name: "Retry download rocket-v2.0.0.apk", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await finishDownload(page, "failed", "Not enough storage space. Free some space and try again.", 2);
  await expect(retry).toBeEnabled();
  await expect(screen.getByRole("status")).toContainText("Not enough storage space");
  await retry.click();
  await finishDownload(page, "successful", undefined, 3);
  await expect(openFile).toBeEnabled();
  expect(Object.keys(await downloadRecords(page))).toHaveLength(3);
});

test("download start failures stay retryable and unsupported files stay downloaded", async ({ page }) => {
  await trackedDownloadManager(page);
  await open(page, "/acme/rocket/releases/tag/v2.0.0");
  await page.evaluate(() => sessionStorage.setItem("fail-enqueue", "yes"));
  const download = activeScreen(page).getByRole("button", { name: "Download checksums.txt", exact: true });
  await download.click();
  await expect(page.locator(".toast")).toContainText("Couldn't start the download");
  await expect(download).toBeEnabled();
  await page.evaluate(() => sessionStorage.removeItem("fail-enqueue"));
  await download.click();
  await finishDownload(page);
  await page.evaluate(() => sessionStorage.setItem("open-result", "no_handler"));
  const openFile = activeScreen(page).getByRole("button", { name: "Open checksums.txt", exact: true });
  await openFile.click();
  await expect(activeScreen(page).getByRole("status")).toContainText("No installed app can open this file");
  await expect(openFile).toBeEnabled();
  await activeScreen(page).getByRole("button", { name: "Download checksums.txt again", exact: true }).click();
  await expect.poll(async () => Object.keys(await downloadRecords(page)).length).toBe(2);
});

test("signing out prevents a pending URL request from starting a download", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await trackedDownloadManager(page);
  await open(page, "/acme/rocket/releases/tag/v2.0.0");
  await page.evaluate(async () => {
    // Defer the fixture transport while navigation/sign-out continue normally.
    const modulePath = "/src/lib/backend.ts";
    const module: unknown = await import(modulePath);
    const backend: unknown = typeof module === "object" && module !== null && "backend" in module ? module.backend : null;
    if (typeof backend !== "object" || backend === null) throw new Error("src/lib/backend.ts exports no backend");
    Object.assign(backend, {
      downloadUrl: () =>
        new Promise<string>((resolve) => {
          window.finishDownloadUrl = () => resolve("https://objects.githubusercontent.com/mock/11");
        }),
    });
  });
  await activeScreen(page).getByRole("button", { name: "Download rocket-v2.0.0.apk", exact: true }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Settings", exact: true }).click();
  await activeScreen(page).getByRole("link", { name: /Account/ }).click();
  await activeScreen(page).getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Better GitHub", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const finish = window.finishDownloadUrl;
    if (finish === undefined) throw new Error("No download link was requested");
    finish();
    await Promise.resolve();
  });
  expect(await page.evaluate(() => sessionStorage.getItem("native-downloads"))).toBeNull();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ghc.download.")))).toEqual([]);
});

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
