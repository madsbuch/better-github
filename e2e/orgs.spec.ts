import { expect, test } from "@playwright/test";
import { activeScreen, open, screenTitle, trackErrors, watchForLoading } from "./helpers";

// Spec: ORG-1, ORG-2, ORG-3
test("organizations are a section of their own, listing the ones you belong to", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "/repos");
  await expect(screenTitle(page)).toHaveText("Repositories");
  const loading = await watchForLoading(page);
  const navigation = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  await navigation.getByRole("button", { name: "Orgs", exact: true }).click();
  await expect(screenTitle(page)).toHaveText("Organizations");
  await expect(navigation.getByRole("button", { name: "Orgs", exact: true })).toHaveAttribute("aria-current", "page");

  const rows = activeScreen(page).locator(".org-row");
  await expect(rows.locator(".row-title")).toHaveText(["Acme Inc.", "octo-labs", "Rustaceans"]);
  await expect(rows.nth(0)).toContainText("Blazing fast uploads for everyone.");
  await expect(rows.nth(0).locator(".row-meta")).toHaveText(/^acme·\s*42 repositories$/);
  // One without a name goes by its login; counts read naturally.
  await expect(rows.nth(1).locator(".row-meta")).toHaveText(/^octo-labs·\s*1 repository$/);
  await expect(rows.nth(2).locator(".row-meta")).toContainText("1.3k repositories");
  // The list was loaded ahead: no spinner on the way in.
  expect(await loading()).toEqual([]);

  // Each opens the organization's page, with its repositories.
  await rows.nth(0).click();
  await expect(screenTitle(page)).toHaveText("acme");
  await page.goBack();
  await expect(screenTitle(page)).toHaveText("Organizations");
  expect(errors).toEqual([]);
});

test("your profile leads to the organizations page too", async ({ page }) => {
  await open(page, "/profile");
  await activeScreen(page).getByRole("link", { name: "Organizations" }).click();
  await expect(screenTitle(page)).toHaveText("Organizations");
});
