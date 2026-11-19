// 插件 UI 装载 e2e（批 C 真浏览器闭环）：目录发现 → 动态 import + import map 共享 React →
// apply(ctx) 渲染 → 新版本目录经指纹轮询自动重装（不刷新页面）→ 停用消失 →
// 安全模式不装载 → 崩溃件隔离。断言走 data 属性；轮询等待 timeout 放宽。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockLlm } from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

/** 真第三方 UI 件：只用 react（import map → 宿主 shim）+ apply(ctx) 注册 turn.tail */
async function writeUiPlugin(
  dataDir: string,
  id: string,
  version: string,
  text: string,
): Promise<void> {
  const dir = path.join(dataDir, "plugins", id, version);
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name: id, version, ui: { title: id } }),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "ui", "main.js"),
    `import React from "react";
import { jsx } from "react/jsx-runtime";

export function apply(ctx) {
  function Tail() {
    const [n] = React.useState(0);
    return jsx("div", { "data-ui-plugin": "${id}", "data-version": "${version}", "data-state": String(n), children: "${text}" });
  }
  return ctx.registerSlot("turn.tail", Tail);
}
`,
    "utf8",
  );
}

/** 渲染即抛错的崩溃件（验证 slot ErrorBoundary 隔离，不白屏） */
async function writeCrashPlugin(dataDir: string): Promise<void> {
  const dir = path.join(dataDir, "plugins", "crash-pack", "1.0.0");
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name: "crash-pack", version: "1.0.0", ui: { title: "crash" } }),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "ui", "main.js"),
    `import { jsx } from "react/jsx-runtime";

export function apply(ctx) {
  function Boom() {
    throw new Error("intentional render crash");
  }
  return ctx.registerSlot("turn.tail", Boom);
}
`,
    "utf8",
  );
}

async function startServer(): Promise<{
  server: HeniraServer;
  dataDir: string;
  globalDir: string;
  stop: () => Promise<void>;
}> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-plugins-e2e-"));
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  const server = await createServer({
    dataDir,
    globalDir,
    llm: { name: "llm", start: () => mockLlm([]).service },
    port: 0,
  });
  return {
    server,
    dataDir,
    globalDir,
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

test("UI 插件：目录装载渲染 → 新版本轮询自动重装（不刷新）→ 停用消失", async ({ page }) => {
  const { server, dataDir, globalDir, stop } = await startServer();
  try {
    await writeUiPlugin(dataDir, "hello-pack", "1.0.0", "HELLO-V1");
    await page.goto(server.url);
    const v1 = page.locator('[data-ui-plugin="hello-pack"][data-version="1.0.0"]');
    await expect(v1).toBeVisible({ timeout: 12000 }); // 首次拉清单 + import map 装载
    await shot(page, "01-hello-v1.png");

    // 写新版本目录（版本级不可变）→ 2s 指纹轮询 → dispose + 新 URL import，页面不刷新
    await writeUiPlugin(dataDir, "hello-pack", "2.0.0", "HELLO-V2");
    await expect(page.locator('[data-ui-plugin="hello-pack"][data-version="2.0.0"]')).toBeVisible({
      timeout: 12000,
    });
    await expect(v1).toHaveCount(0);
    await shot(page, "02-hello-v2-no-reload.png");

    // 停用（settings.plugins.enabled=false）→ 轮询后消失；官方界面照常在
    await fs.writeFile(
      path.join(globalDir, "settings.json"),
      JSON.stringify({
        version: 1,
        model: "mock/mock-1",
        plugins: { "hello-pack": { enabled: false } },
      }),
      "utf8",
    );
    await expect(page.locator('[data-ui-plugin="hello-pack"]')).toHaveCount(0, { timeout: 12000 });
    await expect(page.locator(".henira-composer")).toBeVisible();
    await shot(page, "03-disabled.png");
  } finally {
    await stop();
  }
});

test("安全模式不装载第三方 UI 件；双击 Alt 退出后装载", async ({ page }) => {
  const { server, dataDir, stop } = await startServer();
  try {
    await writeUiPlugin(dataDir, "hello-pack", "1.0.0", "HELLO-V1");
    await page.goto(`${server.url}/?ui=safe`);
    await expect(page.getByText(zh["app.safeMode"]).first()).toBeVisible();
    await expect(page.locator('[data-ui-plugin="hello-pack"]')).toHaveCount(0);
    await shot(page, "04-safe-mode.png");
    // 退出安全模式（双击 Alt）→ 装载
    await page.keyboard.press("Alt");
    await page.keyboard.press("Alt");
    await expect(page.locator('[data-ui-plugin="hello-pack"]')).toBeVisible({ timeout: 12000 });
  } finally {
    await stop();
  }
});

test("崩溃件隔离：该件退出渲染，官方界面与其他件照常", async ({ page }) => {
  const { server, dataDir, stop } = await startServer();
  try {
    await writeUiPlugin(dataDir, "hello-pack", "1.0.0", "HELLO-V1");
    await writeCrashPlugin(dataDir);
    await page.goto(server.url);
    await expect(page.locator('[data-ui-plugin="hello-pack"]')).toBeVisible({ timeout: 12000 });
    // 崩溃件被 ErrorBoundary 隔离：不白屏，官方输入框在场
    await expect(page.locator(".henira-composer")).toBeVisible();
    await shot(page, "05-crash-isolated.png");
  } finally {
    await stop();
  }
});

test("管理面：设置 → 插件页 → 停用 → 插件从界面消失", async ({ page }) => {
  const { server, dataDir, stop } = await startServer();
  try {
    await writeUiPlugin(dataDir, "hello-pack", "1.0.0", "HELLO-V1");
    await page.goto(server.url);
    await expect(page.locator('[data-ui-plugin="hello-pack"]')).toBeVisible({ timeout: 12000 });
    // 侧栏设置按钮 → 插件分区
    await page.getByRole("button", { name: zh["settings.open"] }).first().click();
    await page.getByRole("button", { name: zh["settings.section.plugins"] }).click();
    const row = page.locator('[data-plugin-id="hello-pack"]');
    await expect(row).toBeVisible({ timeout: 8000 });
    await shot(page, "06-admin-plugins.png");
    // 停用开关 → 宿主轮询后插件从 turn.tail 消失
    await row.locator('input[type="checkbox"]').click();
    await expect(page.locator('[data-ui-plugin="hello-pack"]')).toHaveCount(0, { timeout: 12000 });
    await shot(page, "07-admin-disabled.png");
  } finally {
    await stop();
  }
});
