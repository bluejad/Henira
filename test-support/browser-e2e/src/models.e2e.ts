// 模型管理面板 e2e（四视图真浏览器闭环）：自定义厂商连接 → 分组/开关 → 选择器过滤 →
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
    JSON.stringify({ version: 1, model: "deepseek/deepseek-flash" }),
    "utf8",
  );
  // 预置已连接的已知厂商（断开/重连往返步用：组消失但 baseUrl 承重保留——收敛批语义）
  await fs.writeFile(
    path.join(globalDir, "models.json"),
    JSON.stringify({ providers: { deepseek: { baseUrl: "https://api.deepseek.com" } } }),
    "utf8",
  );
  await fs.writeFile(
    path.join(globalDir, "credentials.json"),
    JSON.stringify({ providers: { deepseek: "sk-e2e" } }),
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

test("模型管理（四视图）：自定义厂商连接 → 分组/开关 → 选择器过滤 → 刷新还原", async ({ page }) => {
  const ctx = await startServer();
  try {
    await page.goto(ctx.server.url);
    await expect(page.getByTestId("composer-input")).toBeVisible({
      timeout: 15_000,
    });
    // 开设置 → 模型管理页（无全局默认模型入口——用户裁定 2026-11-19；空态提示在场）
    await page.getByRole("button", { name: zh["settings.open"] }).click();
    await page.getByRole("button", { name: zh["settings.section.models"] }).click();
    await expect(page.getByText(zh["settings.models.current"])).toHaveCount(0);

    // 厂商选择页：返回在顶部工具行 + 自定义入口第一行 + DeepSeek（快照预设）
    await page.getByRole("button", { name: zh["settings.models.addProvider"] }).click();
    await expect(
      page.locator(".henira-models-toolbar").getByText(zh["settings.models.back"]),
    ).toBeVisible();
    await expect(page.locator(".henira-provider-picker .henira-picker-item").first()).toContainText(
      zh["settings.models.customEntry"],
    );
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

    // 已知厂商断开（2026-11-19 用户纠偏）：组从主列表消失；连接态只在挑选页显示
    const dsGroup = page.locator(".henira-provider-group", { hasText: "DeepSeek" });
    await expect(dsGroup).toBeVisible({ timeout: 15_000 });
    await dsGroup.locator(".henira-provider-disconnect").click();
    await expect(dsGroup).toHaveCount(0); // 断开即从面板消失（数据层 baseUrl 保留）
    // 断开当场回落（设置弹窗仍开）：目录广播通知 composer 重拉——绑定失效即切清单首个
    //（本环境唯一剩余 = my-model），不等弹窗关闭（2026-11-19 用户纠偏）
    const triggerLabel = page.locator(".henira-model-trigger-label");
    await expect(triggerLabel).toHaveText("my-model", { timeout: 15_000 });
    await expect(triggerLabel).not.toContainText("/"); // 厂商 id 不进按钮
    await page.getByRole("button", { name: zh["settings.models.addProvider"] }).click();
    const dsPicker = page.locator(".henira-provider-picker .henira-picker-item", {
      hasText: "DeepSeek",
    });
    await expect(dsPicker).toContainText(zh["settings.models.notConnected"]);

    // 关设置 → composer 触发钮保持回落后的有效模型
    await page.locator(".henira-settings-dialog .henira-dialog-head button").click();
    await expect(triggerLabel).toHaveText("my-model", { timeout: 15_000 });

    // 重连往返：挑 DeepSeek → 空 key 本地拦（词表文案、请求不出门）→ 填 key → 组回来
    await page.getByRole("button", { name: zh["settings.open"] }).click();
    await page.getByRole("button", { name: zh["settings.section.models"] }).click();
    await page.getByRole("button", { name: zh["settings.models.addProvider"] }).click();
    await dsPicker.click();
    await page.getByRole("button", { name: zh["settings.models.submit"] }).click();
    await expect(page.getByText(zh["settings.models.errKey"])).toBeVisible();
    await page.getByPlaceholder(zh["settings.models.keyPlaceholder"]).fill("sk-e2e-2");
    await page.getByRole("button", { name: zh["settings.models.submit"] }).click();
    await expect(dsGroup).toBeVisible({ timeout: 15_000 });
    // 断开止血落盘实锤：baseUrl 全程保留（重连不用再填地址）
    const modelsRaw = await fs.readFile(path.join(ctx.globalDir, "models.json"), "utf8");
    const modelsFile = JSON.parse(modelsRaw) as {
      providers?: Record<string, { baseUrl?: string }>;
    };
    expect(modelsFile.providers?.deepseek?.baseUrl).toBe("https://api.deepseek.com");
    await expect(group).toBeVisible(); // relay 组仍在（开关步在分组列表上做）

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

    // 关设置弹窗（头按钮）→ 选择器：my-model 在场（条目显示名档位；重连的 DeepSeek 也回来）
    await page.locator(".henira-settings-dialog .henira-dialog-head button").click();
    const trigger = page.getByRole("button", { name: zh["composer.model"] });
    await trigger.click();
    await expect(page.getByRole("option", { name: /my-model/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // 刷新：分组持久化（models.json 磁盘兜底）
    await page.reload();
    await expect(page.getByTestId("composer-input")).toBeVisible({
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
