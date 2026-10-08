import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the real UI against the fixture backend (VITE_MOCK=1).
// Locally, point PW_CHROMIUM at an existing Chromium to skip the download.
const executablePath = process.env.PW_CHROMIUM;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: "npx vite --port 4173 --strictPort",
    env: { VITE_MOCK: "1" },
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
