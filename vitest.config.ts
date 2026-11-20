import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Stylesheets are read as text by the test that checks them against the spec's values.
    css: true,
  },
});
