// 权限模式全链 e2e（D-080 真浏览器闭环）：ask 出审批卡 → chip 切「完全访问」（风险确认卡
// 勾选确认）→ 同类写工具免卡直接执行 → 刷新保持 full（会话 ui-state 持久化）→ 切回 ask
// 无需确认 → 再写又出卡；设置弹窗第五页「权限」在场。服务端 = 进程内真 server + mock LLM
// 脚本（write 三轮）；选择器取 zh 字典。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockFinish, mockLlm, mockText, mockToolCall, mockUsage } from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

async function startServer(): Promise<{ server: HeniraServer; stop: () => Promise<void> }> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-perm-e2e-"));
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  const writeRound = [
    mockToolCall("w", "write", '{"file_path":"e2e-perm.txt","content":"x"}'),
    mockUsage({ inputTokens: 1, outputTokens: 1 }),
    mockFinish("tool-calls"),
  ] as const;
  const textRound = [
    mockText("permission flow complete"),
    mockUsage({ inputTokens: 1, outputTokens: 1 }),
    mockFinish("stop"),
  ] as const;
  const mock = mockLlm([writeRound, textRound, writeRound, textRound, writeRound, textRound]);
  const server = await createServer({
    dataDir,
    globalDir,
    llm: { name: "llm", start: () => mock.service },
    port: 0,
  });
  return {
    server,
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

test("permission mode: ask card → full auto-allow → reload keeps full → back to ask card again", async ({
  page,
}) => {
  const { server, stop } = await startServer();
  try {
    await page.goto(server.url);
    const chip = page.getByRole("button", { name: zh["composer.permission"] });
    await chip.waitFor({ state: "visible", timeout: 20_000 });
    // 默认 = 改前询问（无 data-full）
    await expect(chip).not.toHaveAttribute("data-full", "true");

    // ① ask：写 → 审批卡 → 放行 → 完成
    const area = page.getByTestId("composer-input");
    await area.fill("first write");
    await area.press("Enter");
    const card = page.getByRole("dialog", { name: zh["approval.title"] });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: zh["approval.allow"], exact: true }).click();
    await expect(page.getByText("permission flow complete").first()).toBeVisible({
      timeout: 20_000,
    });
    await shot(page, "01-ask-card.png");

    // ② chip 切完全访问：确认卡未勾选禁用 → 勾选 → 启用
    await chip.click();
    await page
      .getByRole("menuitemradio", { name: new RegExp(zh["composer.permission.full"]) })
      .click();
    const confirm = page.getByRole("dialog", { name: zh["composer.permission.confirmTitle"] });
    await expect(confirm).toBeVisible();
    const confirmBtn = confirm.getByRole("button", { name: zh["composer.permission.confirm"] });
    await expect(confirmBtn).toBeDisabled();
    await confirm.locator("input[type='checkbox']").check();
    await confirmBtn.click();
    await expect(page.locator(".henira-permission-trigger[data-full='true']")).toBeVisible();
    await shot(page, "02-full-chip.png");

    // ③ full：写免审批卡直接执行
    await area.fill("second write");
    await area.press("Enter");
    await page
      .getByText("permission flow complete")
      .nth(1)
      .waitFor({ state: "visible", timeout: 20_000 });
    await expect(page.getByRole("dialog", { name: zh["approval.title"] })).toHaveCount(0);
    await shot(page, "03-full-no-card.png");

    // ④ 刷新：full 保持（会话 ui-state 持久化——重启/刷新不回落，D-080）
    await page.reload();
    await expect(page.locator(".henira-permission-trigger[data-full='true']")).toBeVisible({
      timeout: 20_000,
    });

    // ⑤ 切回改前询问：无需确认，立即生效
    await page.getByRole("button", { name: zh["composer.permission"] }).click();
    await page
      .getByRole("menuitemradio", { name: new RegExp(zh["composer.permission.ask"]) })
      .click();
    await expect(page.locator(".henira-permission-trigger[data-full='true']")).toHaveCount(0);

    // ⑥ 再写：审批卡回来（fail-closed 恢复）
    await area.fill("third write");
    await area.press("Enter");
    await expect(page.getByRole("dialog", { name: zh["approval.title"] })).toBeVisible({
      timeout: 20_000,
    });
    await shot(page, "04-back-to-ask-card.png");

    // ⑦ 设置弹窗第五页「权限」：导航 scoping（chip 的 aria-label 同名「权限」——审批卡在场时
    //    composer 隐藏才不撞，显式收窄防回归）+ 改默认档真写盘（设置页 → PUT → GET 回读）
    await page.getByRole("button", { name: zh["settings.open"] }).click();
    const nav = page.locator(".henira-settings-nav");
    await nav.getByRole("button", { name: zh["settings.section.permission"] }).click();
    const content = page.locator(".henira-settings-content");
    await expect(content.getByText(zh["settings.permission.default"])).toBeVisible();
    await content.locator(".henira-select-trigger").click();
    await content.getByRole("option", { name: zh["composer.permission.full"] }).click();
    await expect
      .poll(async () => {
        const s = (await (await fetch(`${server.url}/api/settings`)).json()) as {
          permissionMode?: string;
        };
        return s.permissionMode;
      })
      .toBe("full");
    await shot(page, "05-settings-permission-default.png");
  } finally {
    await stop();
    await fs.rm(path.join(process.cwd(), "e2e-perm.txt"), { force: true }).catch(() => {});
  }
});
