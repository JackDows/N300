import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/ui",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { channel: "msedge", baseURL: "http://127.0.0.1:1420", viewport: { width: 1100, height: 760 } },
  outputDir: "../../artifacts/validation/ui-tests",
  reporter: [["list"], ["json", { outputFile: "../../artifacts/validation/ui-tests.json" }]],
  webServer: { command: "npm run dev -- --host 127.0.0.1", url: "http://127.0.0.1:1420", reuseExistingServer: !process.env.CI },
});
