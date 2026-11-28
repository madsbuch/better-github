import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { activeScreen, open, screenTitle, trackErrors } from "./helpers";

const DAY = 24 * 60 * 60_000;

/** What the fake phone has installed, kept in sessionStorage so the test can change it. */
function installedApps(now: number) {
  return [
    // Installed before Rocket 2.0 was uploaded (two days ago): an update.
    { packageName: "dev.acme.rocket", label: "Rocket", versionName: "1.4.2", versionCode: 1004002, lastUpdated: now - 3 * DAY },
    // Installed after notes.apk was last replaced (two hours ago): up to date.
    { packageName: "dev.octocat.notes", label: "Notes", versionName: "0.3.0", versionCode: 3000214, lastUpdated: now - 60 * 60_000 },
    // From no repository the viewer has.
    { packageName: "com.example.bank", label: "Bank", versionName: "9.1", versionCode: 91, lastUpdated: now - DAY },
  ];
}

/** Stands in for the phone: the installed apps and PackageInstaller (Apps.kt), and the download manager (Downloads.kt). */
async function fakePhone(page: Page) {
  await page.addInitScript((apps) => {
    const read = (key: string, fallback: string): unknown => {
      const text = sessionStorage.getItem(key);
      return JSON.parse(text === null || text === "" ? fallback : text);
    };
    const write = (key: string, value: unknown) => sessionStorage.setItem(key, JSON.stringify(value));
    const list = (key: string): unknown[] => {
      const value = read(key, "[]");
      return Array.isArray(value) ? value : [];
    };
    if (sessionStorage.getItem("fake-apps") === null) write("fake-apps", apps);
    Object.assign(window, {
      GhCommanderApps: {
        installed: () => sessionStorage.getItem("fake-apps") ?? "[]",
        icon: () => "",
        launch: (name: string) => {
          write("launched", [...list("launched"), name]);
          return true;
        },
        install: (id: string) => {
          write("installs", [...list("installs"), id]);
          write("install-status", { status: "waiting" });
          return JSON.stringify({ result: "started", id: "install-1" });
        },
        installStatus: () => sessionStorage.getItem("install-status") ?? JSON.stringify({ status: "missing" }),
      },
      GhCommanderDownloads: {
        download: () => false,
        enqueue: (_url: string, name: string) => {
          write("downloads", [...list("downloads"), name]);
          return "1";
        },
        status: () => sessionStorage.getItem("download-status") ?? JSON.stringify({ status: "running", downloadedBytes: 512, totalBytes: 1024 }),
        open: (id: string) => {
          write("opened", [...list("opened"), id]);
          return "opened";
        },
      },
    });
  }, installedApps(Date.now()));
}

const strings = z.array(z.string());
async function stored(page: Page, key: string): Promise<unknown> {
  const text = await page.evaluate((name) => sessionStorage.getItem(name), key);
  return JSON.parse(text === null || text === "" ? "null" : text);
}

// Spec: APP-1, APP-2, APP-3, APP-4, APP-7
test("apps from your repositories are a section of their own, with updates first", async ({ page }) => {
  const errors = trackErrors(page);
  await fakePhone(page);
  await open(page, "/repos");
  const navigation = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  await expect(navigation.getByRole("button")).toHaveText(["Repos", "Orgs", "Apps", "You", "Settings"]);
  await navigation.getByRole("button", { name: "Apps", exact: true }).click();
  await expect(screenTitle(page)).toHaveText("Apps");

  const screen = activeScreen(page);
  await expect(screen.locator(".group-header")).toHaveText(["Updates · 1", "Installed · 1"]);
  const rows = screen.locator(".download-row");
  await expect(rows.locator(".row-title")).toHaveText(["Rocket", "Notes"]);
  await expect(rows.nth(0).locator(".row-meta")).toHaveText(/^acme\/rocket·\s*1\.4\.2$/);
  await expect(rows.nth(0).getByRole("status")).toHaveText("New build · 2d");
  await expect(rows.nth(1).locator(".row-meta")).toHaveText(/^octocat\/notes·\s*0\.3\.0$/);
  await expect(screen).not.toContainText("Bank");

  // An app that's up to date opens.
  await screen.getByRole("button", { name: "Open Notes" }).click();
  expect(strings.parse(await stored(page, "launched"))).toEqual(["dev.octocat.notes"]);

  // The app opens its repository's latest release.
  await rows.nth(1).locator(".row").click();
  await expect(screenTitle(page)).toHaveText("Latest build");
  expect(errors).toEqual([]);
});

// Spec: APP-5, APP-6
test("one tap downloads the newest build and installs it once downloaded", async ({ page }) => {
  await fakePhone(page);
  await open(page, "/apps");
  const screen = activeScreen(page);
  await screen.getByRole("button", { name: "Update Rocket" }).click();
  await expect.poll(async () => stored(page, "downloads")).toEqual(["rocket-v2.0.0.apk"]);
  await expect(screen.getByRole("status").first()).toContainText("Downloading");

  // The download finishes: installing starts by itself, through PackageInstaller rather than the file viewer.
  await page.evaluate(() => sessionStorage.setItem("download-status", JSON.stringify({ status: "successful", downloadedBytes: 1024, totalBytes: 1024 })));
  await expect.poll(async () => stored(page, "installs")).toEqual(["1"]);
  expect(await stored(page, "opened")).toBeNull();
  await expect(screen.getByRole("status").first()).toHaveText("Confirm the installation in Android's dialog.");

  // Android installs it: the app is up to date, and remembered as coming from acme/rocket.
  await page.evaluate((now) => {
    const apps: unknown = JSON.parse(sessionStorage.getItem("fake-apps") ?? "[]");
    if (!Array.isArray(apps)) return;
    const updated: unknown[] = apps.map((app: unknown) =>
      typeof app === "object" && app !== null && "packageName" in app && app.packageName === "dev.acme.rocket" ? { ...app, versionName: "2.0.0", versionCode: 2000000, lastUpdated: now } : app,
    );
    sessionStorage.setItem("fake-apps", JSON.stringify(updated));
    sessionStorage.setItem("install-status", JSON.stringify({ status: "installed", packageName: "dev.acme.rocket", versionName: "2.0.0", versionCode: 2000000 }));
  }, Date.now());
  await expect(screen.locator(".group-header")).toHaveText(["Installed · 2"]);
  await expect(page.getByText("Installed Rocket")).toBeVisible();
  const links = await page.evaluate(() => localStorage.getItem("ghc.apps.links"));
  expect(JSON.parse(links ?? "{}")).toEqual({
    "dev.acme.rocket": { owner: "acme", repo: "rocket", assetId: 11, assetName: "rocket-v2.0.0.apk", versionCode: 2000000 },
  });
});

// Spec: APP-1
test("without the Android app there's no Apps section, and its page says why", async ({ page }) => {
  await open(page, "/apps");
  await expect(activeScreen(page)).toContainText("Apps live on your phone");
  await expect(page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("button")).toHaveText(["Repos", "Orgs", "You", "Settings"]);
});
