// 模型管理面板 e2e（BC 四视图真浏览器闭环）：自定义厂商连接 → 分组/开关 → 选择器过滤 →
// 刷新持久化（models.json 落盘）。选择器取 zh 字典；输入串 ASCII；断言走磁盘轮询确定性等待。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type MockEntry, mockLlm } from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

async function startServer(script: MockEntry[] = []): Promise<{
  server: HeniraServer;
  globalDir: string;
  stop: () => Promise<void>;
}> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-models-"));
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
    llm: { name: "llm", start: () => mockLlm(script).service },
    port: 0,
  });
  return {
    server,
    globalDir,
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

test("模型管理（BC 四视图）：自定义厂商连接 → 分组/开关 → 选择器过滤 → 刷新还原", async ({
  page,
}) => {
  const ctx = await startServer();
  try {
    await page.goto(ctx.server.url);
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    // 开设置 → 模型管理页（无全局默认模型入口——用户裁定 2026-11-19；空态提示在场）
    await page.getByRole("button", { name: zh["settings.open"] }).click();
    await page.getByRole("button", { name: zh["settings.section.models"] }).click();
    await expect(page.getByText(zh["settings.models.current"])).toHaveCount(0);

    // 厂商选择页：返回在顶部工具行 + 自定义入口第一行 + DeepSeek（快照预设）
    await page.getByRole("button", { name: zh["settings.models.addProvider"] }).click();
    await expect(page.locator(".henira-models-toolbar").getByText(zh["settings.models.back"]))
      .toBeVisible();
    await expect(
      page.locator(".henira-provider-picker .henira-picker-item").first(),
    ).toContainText(zh["settings.models.customEntry"]);
    await expect(page.getByText(zh["settings.models.hot"])).toBeVisible();
    await expect(page.getByText("DeepSeek").first()).toBeVisible();

    // 自定义厂商连接：显示名 / baseUrl / model-id → 提交回列表
    await page.getByText(zh["settings.models.customEntry"]).click();
    const urlInput = page.getByPlaceholder("https://api.example.com/v1");
    await expect(urlInput).toBeVisible();
    await page.locator(".henira-dialog-field").first().locator("input").fill("relay station");
    await urlInput.fill("https://relay.example.com/v1");
    await page.getByPlaceholder(zh["settings.models.formModelId"]).fill("my-model");
    await page.getByRole("button", { name: zh["settings.models.submit"] }).click();
    const group = page.locator(".henira-provider-group", { hasText: "relay station" });
    await expect(group).toBeVisible({ timeout: 15_000 });
    await expect(group.getByText("my-model")).toBeVisible();

    // 开关关 → 选择器摘除；开回 → 还原
    const sw = group.getByRole("switch", { name: /my-model/ });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false", { timeout: 15_000 });
    // hidden 落盘轮询（确定性等待）
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        const raw = await fs.readFile(path.join(ctx.globalDir, "models.json"), "utf8");
        const file = JSON.parse(raw) as {
          providers?: Record<string, { hidden?: string[] }>;
        };
        if (Object.values(file.providers ?? {}).some((p) => p.hidden?.includes("my-model"))) {
          break;
        }
      } catch {
        // 未落盘——继续轮询
      }
      if (Date.now() > deadline) throw new Error("models.json hidden not persisted within 5s");
      await page.waitForTimeout(50);
    }
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });

    // 关设置弹窗（头按钮）→ 选择器：my-model 在场（provider/model 全名）
    await page.locator(".henira-settings-dialog .henira-dialog-head button").click();
    const trigger = page.getByRole("button", { name: zh["composer.model"] });
    await trigger.click();
    await expect(page.getByRole("option", { name: /my-model/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // 刷新：分组持久化（models.json 磁盘兜底）
    await page.reload();
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: zh["settings.open"] }).click();
    await page.getByRole("button", { name: zh["settings.section.models"] }).click();
    await expect(page.locator(".henira-provider-group", { hasText: "relay station" })).toBeVisible({
      timeout: 15_000,
    });
    await shot(page, "20-models-panel.png");
  } finally {
    await ctx.stop();
  }
});
