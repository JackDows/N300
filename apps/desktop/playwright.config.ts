import { defineConfig } from "@playwright/test";
const configuration = process.env.N300_TEST_CONFIGURATION ?? "Debug";

export default defineConfig({
  testDir: "tests/desktop",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: `../../modules/edifier-n300/artifacts/validation/desktop-tests-${configuration}`,
  reporter: [["list"], ["json", { outputFile: `../../modules/edifier-n300/artifacts/validation/desktop-tests-${configuration}.json` }]],
});
