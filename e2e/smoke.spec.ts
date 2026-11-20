import { expect, test } from "@playwright/test";
import { open, screenTitle, trackErrors } from "./helpers";

const SCREENS: [string, string | RegExp][] = [
  ["/", "Repositories"],
  ["/pulls", "Pull requests"],
  ["/notifications", "Inbox"],
  ["/repos", "Repositories"],
  ["/repos?tab=starred", "Repositories"],
  ["/orgs", "Organizations"],
  ["/profile", "You"],
  ["/settings", "Settings"],
  ["/settings/appearance", "Appearance"],
  ["/search?q=rocket&type=repos", "Search"],
  ["/search?q=crash&type=issues", "Search"],
  ["/search?q=alice&type=users", "Search"],
  ["/acme", "acme"],
  ["/acme/rocket", "rocket"],
  ["/acme/rocket?tab=code", "rocket"],
  ["/acme/rocket?tab=pulls", "rocket"],
  ["/acme/rocket?tab=issues", "rocket"],
  ["/acme/rocket?tab=commits", "rocket"],
  ["/acme/rocket/tree?ref=main&path=src", "src"],
  ["/acme/rocket/blob?ref=main&path=src/client.rs", "client.rs"],
  ["/acme/rocket/blob?ref=main&path=README.md", "README.md"],
  ["/acme/rocket/pull/482", /^Add retry/],
  ["/acme/rocket/pull/482?tab=files", /^Add retry/],
  ["/acme/rocket/pull/482?tab=commits", /^Add retry/],
  ["/acme/rocket/pull/482?tab=checks", /^Add retry/],
  ["/acme/rocket/issues/501", "Issue #501"],
  ["/acme/rocket/commit/1a2b3c4d5e6f", "Commit 1a2b3c4"],
  ["/acme/rocket?tab=releases", "rocket"],
  ["/acme/rocket/releases/latest", "Rocket 2.0"],
  ["/acme/rocket/releases/1", "Rocket 2.0"],
  ["/acme/rocket?tab=actions", "rocket"],
  ["/acme/rocket/compare?head=octocat/faster-uploads", "Open a pull request"],
];

for (const [path, title] of SCREENS) {
  test(`renders ${path}`, async ({ page }) => {
    const errors = trackErrors(page);
    await open(page, path);
    await expect(screenTitle(page)).toHaveText(title);
    await expect(page.locator(".spinner")).toHaveCount(0);
    await expect(page.getByText("Couldn't load this")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("signed-out users see the login screen", async ({ page }) => {
  await page.goto("/?signedOut#/");
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page.getByLabel("Your one-time code")).toHaveText("WDJB-MJHT");
});
