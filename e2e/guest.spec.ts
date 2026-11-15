import { expect, test, type Page } from "@playwright/test";
import { activeScreen, screenTitle, trackErrors } from "./helpers";

async function startAsGuest(page: Page) {
  await page.goto("/?signedOut");
  await page.getByRole("button", { name: "Browse without signing in" }).click();
  await expect(screenTitle(page)).toHaveText("Repositories");
}

async function addProfile(page: Page, login: string) {
  const screen = activeScreen(page);
  await screen.getByLabel("Add a profile").fill(login);
  await screen.getByRole("button", { name: "Add profile" }).click();
}

test("guests follow profiles and see their public repositories", async ({ page }) => {
  const errors = trackErrors(page);
  await startAsGuest(page);
  const navigation = page.getByRole("navigation", { name: "Main" });
  await expect(navigation.getByRole("button")).toHaveText(["Repos", "Profiles"]);

  const screen = activeScreen(page);
  await expect(screen.getByText("Follow profiles to see their repositories")).toBeVisible();
  await addProfile(page, "acme");
  await expect(screen.locator("a.row")).toHaveText([/acme\/rocket/, /acme\/web/]);

  await navigation.getByRole("button", { name: "Profiles", exact: true }).click();
  await expect(screenTitle(page)).toHaveText("Profiles");
  await addProfile(page, "https://github.com/octocat");
  await expect(activeScreen(page).getByRole("link", { name: /The Octocat/ })).toBeVisible();
  await addProfile(page, "nobody-here");
  await expect(activeScreen(page).getByRole("alert")).toHaveText("There's no user or organization called nobody-here.");

  // Public repositories only, newest first, filterable by profile.
  await navigation.getByRole("button", { name: "Repos", exact: true }).click();
  const repos = activeScreen(page).locator("a.row");
  await expect(repos).toHaveText([/acme\/rocket/, /acme\/web/, /octocat\/better-github/]);
  await activeScreen(page).getByRole("radio", { name: "octocat" }).click();
  await expect(repos).toHaveText([/octocat\/better-github/]);
  await activeScreen(page).getByRole("radio", { name: "All" }).click();

  // The list survives a restart.
  await page.reload();
  await expect(screenTitle(page)).toHaveText("Repositories");
  await expect(repos).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("guests browse a repository's public information", async ({ page }) => {
  const errors = trackErrors(page);
  await startAsGuest(page);
  await addProfile(page, "acme");
  await activeScreen(page).locator("a.row", { hasText: "acme/rocket" }).click();
  await expect(screenTitle(page)).toHaveText("rocket");

  const screen = activeScreen(page);
  await expect(screen.getByRole("tab")).toHaveText(["Overview", "Releases", "Actions", "Code", "Commits"]);
  await expect(screen.getByRole("button", { name: /^(Star|Unstar)$/ })).toHaveCount(0);
  await expect(screen.getByText("Blazing fast uploads for everyone").first()).toBeVisible();
  await expect(screen.getByRole("link", { name: /Rocket 2.0/ })).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Install" })).toBeVisible();

  await screen.getByRole("tab", { name: "Code" }).click();
  await screen.getByRole("link", { name: "Cargo.toml" }).click();
  await expect(screenTitle(page)).toHaveText("Cargo.toml");
  await page.goBack();

  await activeScreen(page).getByRole("tab", { name: "Releases" }).click();
  await expect(activeScreen(page).getByText("2.0 release candidate")).toBeVisible();

  // The owner's public profile.
  await activeScreen(page).getByRole("tab", { name: "Overview" }).click();
  await activeScreen(page).getByRole("link", { name: "acme", exact: true }).click();
  await expect(activeScreen(page).getByRole("heading", { name: "Acme Inc." })).toBeVisible();
  await expect(activeScreen(page).locator("a.row")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("guests can remove profiles and go to sign-in", async ({ page }) => {
  await startAsGuest(page);
  await addProfile(page, "acme");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Profiles", exact: true }).click();
  await activeScreen(page).getByRole("button", { name: "Remove acme" }).click();
  await expect(activeScreen(page).getByText("No profiles yet")).toBeVisible();

  await activeScreen(page).getByRole("button", { name: "Sign in to GitHub" }).click();
  await expect(page.getByRole("button", { name: "Browse without signing in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Browse without signing in" })).toBeVisible();
});
