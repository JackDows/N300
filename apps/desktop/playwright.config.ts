import { defineConfig } from "@playwright/test";
const configuration = process.env.N300_TEST_CONFIGURATION ?? "Debug";

export default defineConfig({
  testDir: "tests/desktop",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: `../artifacts/validation/desktop-tests-${configuration}`,
  reporter: [["list"], ["json", { outputFile: `../artifacts/validation/desktop-tests-${configuration}.json` }]],
});
