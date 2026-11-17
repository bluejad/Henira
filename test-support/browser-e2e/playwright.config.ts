// Playwright 配置（browser-e2e）：testMatch 只认 *.e2e.ts——vitest（pnpm test）与
// 浏览器 e2e（pnpm test:e2e）双轨互不干扰；headless 默认；失败 trace 留档 test-results/。
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testMatch: /.*\.e2e\.ts$/,
  outputDir: "test-results",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    headless: true,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
  },
  expect: { timeout: 10_000 },
});
