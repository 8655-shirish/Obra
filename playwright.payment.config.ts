import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e/payment",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  outputDir: "test-results/payment",
  use: {
    baseURL: "http://127.0.0.1:4179",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel:
          process.env.PLAYWRIGHT_CHANNEL || (process.platform === "darwin" ? "chrome" : undefined),
      },
    },
  ],
  webServer: {
    command: "pnpm exec vite --config tests/e2e/payment/vite.config.ts",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
