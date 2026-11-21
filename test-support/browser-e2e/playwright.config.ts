// Playwright 配置（browser-e2e）：testMatch 只认 *.e2e.ts——vitest（pnpm test）与
// 浏览器 e2e（pnpm test:e2e）双轨互不干扰；headless 默认；失败 trace 留档 test-results/。
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testMatch: /.*\.e2e\.ts$/,
  outputDir: "test-results",
  forbidOnly: !!process.env.CI,
  retries: 0,
  // 单 worker：共享 server + 共享 mock 剧本（严格顺序 cursor）——并行即竞态（R171 实锤：
  // 多 worker 下后例拿到错位剧本段）。e2e 是语义锁不是速度赛。
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    headless: true,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
  },
  expect: { timeout: 10_000 },
});
