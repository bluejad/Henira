// 命令级权限规则 e2e（R198 真浏览器闭环）：bash 审批卡四选项 → 「本会话允许此命令」落精确
// 规则 → 同命令下一回合免卡 → 权限菜单显示「本会话允许 1 条」→ 撤销 → 同命令重新出卡。
// 服务端 = 进程内真 server + mock LLM（同一命令三轮）；选择器取 zh 字典。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockFinish, mockLlm, mockText, mockToolCall, mockUsage } from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";
import { sendPrompt } from "./send-prompt.js";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

async function startServer(
  command = "echo e2e-perm-rules",
  cycles = 3,
): Promise<{ server: HeniraServer; stop: () => Promise<void>; dataDir: string }> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-perm-rules-e2e-"));
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  const bashRound = [
    mockToolCall("b", "bash", JSON.stringify({ command })),
    mockUsage({ inputTokens: 1, outputTokens: 1 }),
    mockFinish("tool-calls"),
  ] as const;
  const textRound = [
    mockText("rules flow complete"),
    mockUsage({ inputTokens: 1, outputTokens: 1 }),
    mockFinish("stop"),
  ] as const;
  const mock = mockLlm(Array.from({ length: cycles }, () => [bashRound, textRound]).flat());
  const server = await createServer({
    dataDir,
    globalDir,
    llm: { name: "llm", start: () => mock.service },
    port: 0,
  });
  return {
    server,
    dataDir,
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

test("permission rules: allow command in session → same command skips card → revoke → card returns", async ({
  page,
}) => {
  const { server, stop } = await startServer();
  try {
    await page.goto(server.url);
    const chip = page.getByRole("button", { name: zh["composer.permission"] });
    await chip.waitFor({ state: "visible", timeout: 20_000 });

    // ① bash 审批卡：四选项（一次 / 本会话允许此命令 / 本项目允许此命令 / 拒绝）
    await sendPrompt(page, "first command");
    const card = page.getByRole("dialog", { name: zh["approval.title"] });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(
      card.getByRole("button", { name: zh["approval.sessionAllowCommand"], exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: zh["approval.projectAllowCommand"], exact: true }),
    ).toBeVisible();
    await shot(page, "01-command-options.png");
    await card
      .getByRole("button", { name: zh["approval.sessionAllowCommand"], exact: true })
      .click();
    await expect(page.getByText("rules flow complete").first()).toBeVisible({ timeout: 20_000 });

    // ② 同命令再发：精确规则命中，不再出卡
    await sendPrompt(page, "second command");
    await page
      .getByText("rules flow complete")
      .nth(1)
      .waitFor({ state: "visible", timeout: 20_000 });
    await expect(page.getByRole("dialog", { name: zh["approval.title"] })).toHaveCount(0);
    await shot(page, "02-same-command-no-card.png");

    // ③ 权限菜单：本会话允许 1 条 → 规则面板逐条撤销 → 空态
    await chip.click();
    await page.getByRole("menu").waitFor({ state: "visible" });
    await expect(page.getByText(zh["composer.permission.sessionAllowed"])).toBeVisible();
    await expect(page.locator(".henira-permission-extra-count")).toHaveText(
      `1 ${zh["composer.permission.unit"]}`,
    );
    await page
      .getByRole("button", { name: new RegExp(zh["composer.permission.viewRules"]) })
      .click();
    await expect(page.getByText(zh["composer.permission.sessionRulesTitle"])).toBeVisible();
    const ruleRow = page
      .locator(".henira-permission-rule-row")
      .filter({ hasText: "echo e2e-perm-rules" });
    await expect(ruleRow).toHaveCount(1);
    await shot(page, "03-session-allowed.png");
    await ruleRow.getByRole("button", { name: zh["permission.rule.revoke"] }).click();
    await expect(page.locator(".henira-permission-rule-row")).toHaveCount(0);
    await shot(page, "04-revoked.png");
    await page.keyboard.press("Escape");

    // ④ 撤销后同命令：审批卡回来
    await sendPrompt(page, "third command");
    await expect(page.getByRole("dialog", { name: zh["approval.title"] })).toBeVisible({
      timeout: 20_000,
    });
    await shot(page, "05-card-returns.png");
  } finally {
    await stop();
  }
});

test("permission rules: allow command for project writes permissions.json → same command skips card", async ({
  page,
}) => {
  const { server, stop, dataDir } = await startServer("echo e2e-project-allow", 2);
  try {
    await page.goto(server.url);
    const chip = page.getByRole("button", { name: zh["composer.permission"] });
    await chip.waitFor({ state: "visible", timeout: 20_000 });

    // ① 卡上「本项目允许此命令」→ 真 config 链写项目 permissions.json
    await sendPrompt(page, "project command");
    const card = page.getByRole("dialog", { name: zh["approval.title"] });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card
      .getByRole("button", { name: zh["approval.projectAllowCommand"], exact: true })
      .click();
    await expect(page.getByText("rules flow complete").first()).toBeVisible({ timeout: 20_000 });
    // 权限菜单：本项目只读计数 = 1（审批痕迹行按设计不进官方对话流，入口在菜单）
    await chip.click();
    await page.getByRole("menu").waitFor({ state: "visible" });
    await expect(page.getByText(zh["composer.permission.projectAllowed"])).toBeVisible();
    await expect(page.locator(".henira-permission-extra-count")).toHaveText(
      `1 ${zh["composer.permission.unit"]}`,
    );
    await page.keyboard.press("Escape");
    await shot(page, "06-project-allowed.png");

    // 磁盘实锤：项目数据目录下的 permissions.json（version 1 + 精确命令规则）
    const projectsDir = path.join(dataDir, "projects");
    const files: string[] = [];
    for (const entry of await fs.readdir(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(projectsDir, entry.name, "permissions.json");
      if (
        await fs
          .stat(candidate)
          .then(() => true)
          .catch(() => false)
      ) {
        files.push(candidate);
      }
    }
    expect(files).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(files[0], "utf8"))).toMatchObject({
      version: 1,
      rules: [
        {
          match: { tool: "bash", commandExact: "echo e2e-project-allow" },
          decision: "allow",
        },
      ],
    });

    // ② 同命令再发：项目规则层命中（文件读取），不再出卡
    await sendPrompt(page, "project command again");
    await page
      .getByText("rules flow complete")
      .nth(1)
      .waitFor({ state: "visible", timeout: 20_000 });
    await expect(page.getByRole("dialog", { name: zh["approval.title"] })).toHaveCount(0);
    await shot(page, "07-project-same-command-no-card.png");
  } finally {
    await stop();
  }
});
