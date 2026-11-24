// 权限管理面 e2e（R199 真浏览器闭环）：
// ① 会话两条允许 → chip 规则面板逐条撤销 → 被撤命令重新出卡、另一条免卡；
// ② 本项目允许 → 设置 › 权限显示规则 → 逐条删除 → 文件规则消失 → 同命令重新出卡；
// ③ 预置全局 allow → 首次免卡 → 设置删除 → 同命令重新出卡。
// 服务端 = 进程内真 server + mock LLM；选择器取 zh 字典；磁盘断言在 stop 前完成。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type MockEntry,
  mockFinish,
  mockLlm,
  mockText,
  mockToolCall,
  mockUsage,
} from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import type { StreamEvent } from "@henira/protocol";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";
import { sendPrompt } from "./send-prompt.js";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

const bashRound = (id: string, command: string): readonly StreamEvent[] => [
  mockToolCall(id, "bash", JSON.stringify({ command })),
  mockUsage({ inputTokens: 1, outputTokens: 1 }),
  mockFinish("tool-calls"),
];

const textRound = (text: string): readonly StreamEvent[] => [
  mockText(text),
  mockUsage({ inputTokens: 1, outputTokens: 1 }),
  mockFinish("stop"),
];

async function startServer(
  script: readonly MockEntry[],
  globalRules?: unknown,
  projects?: readonly unknown[],
): Promise<{ server: HeniraServer; dataDir: string; stop: () => Promise<void> }> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-perm-mgmt-e2e-"));
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  if (globalRules !== undefined) {
    await fs.writeFile(
      path.join(globalDir, "permissions.json"),
      JSON.stringify(globalRules),
      "utf8",
    );
  }
  // R199 样式回归：预置长名项目，选择器弹层才会出现超宽标签（会话自建项目名很短）
  if (projects !== undefined) {
    await fs.writeFile(
      path.join(dataDir, "projects.json"),
      JSON.stringify({ version: 1, lastUpdatedAt: 0, projects }),
      "utf8",
    );
  }
  const mock = mockLlm(script);
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

async function openPermissionPage(page: Page): Promise<void> {
  await page.locator(".henira-footer-settings").click();
  const dialog = page.getByRole("dialog", { name: zh["settings.title"] });
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: zh["settings.section.permission"] }).click();
  await expect(page.getByText(zh["settings.permission.projectRules"])).toBeVisible();
}

async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: zh["settings.title"] })).toHaveCount(0);
}

async function projectRuleFiles(dataDir: string): Promise<string[]> {
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
  return files;
}

test("permission management: session rules list → revoke one → that command asks again", async ({
  page,
}) => {
  const { server, stop } = await startServer([
    bashRound("a1", "echo R199-A"),
    textRound("done A1"),
    bashRound("b1", "echo R199-B"),
    textRound("done B1"),
    bashRound("a2", "echo R199-A"),
    textRound("done A2"),
    bashRound("b2", "echo R199-B"),
    textRound("done B2"),
  ]);
  try {
    await page.goto(server.url);
    const chip = page.getByRole("button", { name: zh["composer.permission"] });
    await chip.waitFor({ state: "visible", timeout: 20_000 });
    const card = page.getByRole("dialog", { name: zh["approval.title"] });

    // ① 两条命令各自「本会话允许此命令」
    await sendPrompt(page, "run A");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card
      .getByRole("button", { name: zh["approval.sessionAllowCommand"], exact: true })
      .click();
    await expect(page.getByText("done A1").first()).toBeVisible({ timeout: 20_000 });

    await sendPrompt(page, "run B");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card
      .getByRole("button", { name: zh["approval.sessionAllowCommand"], exact: true })
      .click();
    await expect(page.getByText("done B1").first()).toBeVisible({ timeout: 20_000 });

    // ② chip → 规则面板：两条都在，撤掉 A
    await chip.click();
    await page.getByRole("menu").waitFor({ state: "visible" });
    await shot(page, "00-session-menu.png");
    await page
      .getByRole("button", { name: new RegExp(zh["composer.permission.viewRules"]) })
      .click();
    await expect(page.getByText(zh["composer.permission.sessionRulesTitle"])).toBeVisible();
    await expect(page.locator(".henira-permission-rule-row")).toHaveCount(2);
    await shot(page, "01-session-rules.png");
    const rowA = page.locator(".henira-permission-rule-row").filter({ hasText: "echo R199-A" });
    await rowA.getByRole("button", { name: zh["permission.rule.revoke"] }).click();
    await expect(page.locator(".henira-permission-rule-row")).toHaveCount(1);
    await shot(page, "02-session-revoked-one.png");
    await page.keyboard.press("Escape");

    // ③ 被撤的 A 重新出卡（拒绝收尾）；B 仍免卡
    await sendPrompt(page, "run A again");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: zh["approval.deny"], exact: true }).click();
    await expect(page.getByText("done A2").first()).toBeVisible({ timeout: 20_000 });

    await sendPrompt(page, "run B again");
    await expect(page.getByText("done B2").first()).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveCount(0);
    await shot(page, "03-session-other-still-allowed.png");
  } finally {
    await stop();
  }
});

test("permission management: project rule in settings → delete → same command asks again", async ({
  page,
}) => {
  const { server, dataDir, stop } = await startServer([
    bashRound("p1", "echo R199-PROJECT"),
    textRound("project done 1"),
    bashRound("p2", "echo R199-PROJECT"),
    textRound("project done 2"),
  ]);
  try {
    await page.goto(server.url);
    const chip = page.getByRole("button", { name: zh["composer.permission"] });
    await chip.waitFor({ state: "visible", timeout: 20_000 });
    const card = page.getByRole("dialog", { name: zh["approval.title"] });

    // ① 卡上「本项目允许此命令」→ 文件落规则
    await sendPrompt(page, "run project");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card
      .getByRole("button", { name: zh["approval.projectAllowCommand"], exact: true })
      .click();
    await expect(page.getByText("project done 1").first()).toBeVisible({ timeout: 20_000 });
    expect(await projectRuleFiles(dataDir)).toHaveLength(1);

    // ② 设置 › 权限：项目规则行 → 删除确认 → 文件规则消失
    await openPermissionPage(page);
    const row = page
      .locator(".henira-permission-rule-row")
      .filter({ hasText: "echo R199-PROJECT" });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await shot(page, "04-project-rule-in-settings.png");
    await row.getByRole("button", { name: zh["permission.rule.delete"] }).click();
    const confirm = page.getByRole("dialog", {
      name: zh["settings.permission.deleteTitle"],
    });
    await expect(confirm).toBeVisible();
    await shot(page, "05-project-delete-confirm.png");
    await confirm.locator("button.henira-danger").click();
    await expect(page.getByText(zh["settings.permission.emptyProject"])).toBeVisible({
      timeout: 20_000,
    });
    const files = await projectRuleFiles(dataDir);
    expect(files).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(files[0] as string, "utf8"))).toMatchObject({ rules: [] });
    await shot(page, "06-project-rule-deleted.png");
    await closeSettings(page);

    // ③ 同命令重新出卡
    await sendPrompt(page, "run project again");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: zh["approval.deny"], exact: true }).click();
    await expect(page.getByText("project done 2").first()).toBeVisible({ timeout: 20_000 });
    await shot(page, "07-project-card-returns.png");
  } finally {
    await stop();
  }
});

// 样式回归（R199）：长项目名 + 完整 cwd 的选项曾把弹层撑到 900px+，超宽部分被设置内容区
// 的 overflow:auto 计成横向滚动溢出（页面可被滚右、标题/行首被裁）。锁四件事：内容区零横向
// 溢出、弹层不出设置弹窗、条目省略号截断、Esc 只收弹层不连关弹窗。
test("permission management: long project labels stay inside the settings dialog", async ({
  page,
}) => {
  const projects = [
    {
      id: "seed-alpha",
      cwd: "C:\\Users\\Think\\AppData\\Local\\Temp\\henira-permission-management-e2e-alpha",
      key: "--henira-permission-management-e2e-alpha-a1b2c3d4--",
      displayName: "henira-permission-management-e2e-alpha",
      createdAt: 0,
      lastOpenedAt: 3,
      openCount: 1,
      lastSessionId: null,
    },
    {
      id: "seed-beta",
      cwd: "C:\\Users\\Think\\AppData\\Local\\Temp\\henira-permission-management-e2e-beta",
      key: "--henira-permission-management-e2e-beta-b1b2c3d4--",
      displayName: "henira-permission-management-e2e-beta",
      createdAt: 0,
      lastOpenedAt: 2,
      openCount: 1,
      lastSessionId: null,
    },
    {
      id: "seed-gamma",
      cwd: "C:\\Users\\Think\\AppData\\Local\\Temp\\henira-permission-management-e2e-long-project-name",
      key: "--r199-long-project-name-for-picker-c1b2c3d4--",
      displayName: "r199-long-project-name-for-picker",
      createdAt: 0,
      lastOpenedAt: 1,
      openCount: 1,
      lastSessionId: null,
    },
  ];
  const { server, stop } = await startServer([textRound("ok")], undefined, projects);
  try {
    await page.goto(server.url);
    await page
      .getByRole("button", { name: zh["composer.permission"] })
      .waitFor({ state: "visible", timeout: 20_000 });
    await openPermissionPage(page);

    const trigger = page.getByRole("button", {
      name: zh["settings.permission.selectProject"],
    });
    await trigger.waitFor({ state: "visible", timeout: 20_000 });
    await trigger.click();
    const listbox = page.getByRole("listbox", {
      name: zh["settings.permission.selectProject"],
    });
    await expect(listbox).toBeVisible();
    await shot(page, "11-project-picker-long-labels.png");

    const metrics = await page.evaluate(() => {
      const content = document.querySelector(".henira-settings-content") as HTMLElement;
      const dialog = document.querySelector(".henira-settings-dialog") as HTMLElement;
      const pop = document.querySelector(".henira-select-pop") as HTMLElement;
      const item = pop.querySelector("[role='option']") as HTMLElement;
      const popRect = pop.getBoundingClientRect();
      const dialogRect = dialog.getBoundingClientRect();
      return {
        contentScrollWidth: content.scrollWidth,
        contentClientWidth: content.clientWidth,
        contentScrollLeft: content.scrollLeft,
        popLeft: popRect.left,
        popRight: popRect.right,
        popWidth: popRect.width,
        dialogLeft: dialogRect.left,
        dialogRight: dialogRect.right,
        itemOverflow: getComputedStyle(item).textOverflow,
      };
    });
    expect(metrics.contentScrollWidth).toBeLessThanOrEqual(metrics.contentClientWidth + 1);
    expect(metrics.contentScrollLeft).toBe(0);
    expect(metrics.popRight).toBeLessThanOrEqual(metrics.dialogRight - 8);
    expect(metrics.popLeft).toBeGreaterThanOrEqual(metrics.dialogLeft + 8);
    expect(metrics.popWidth).toBeLessThanOrEqual(420 + 1);
    expect(metrics.itemOverflow).toBe("ellipsis");

    await page.keyboard.press("Escape");
    await expect(listbox).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: zh["settings.title"] })).toBeVisible();
    await shot(page, "12-picker-esc-keeps-settings.png");
    await closeSettings(page);
  } finally {
    await stop();
  }
});

test("permission management: global rule in settings → delete → same command asks again", async ({
  page,
}) => {
  const command = "echo R199-GLOBAL";
  const { server, dataDir, stop } = await startServer(
    [
      bashRound("g1", command),
      textRound("global done 1"),
      bashRound("g2", command),
      textRound("global done 2"),
    ],
    { version: 1, rules: [{ match: { tool: "bash", commandExact: command }, decision: "allow" }] },
  );
  try {
    await page.goto(server.url);
    const chip = page.getByRole("button", { name: zh["composer.permission"] });
    await chip.waitFor({ state: "visible", timeout: 20_000 });
    const card = page.getByRole("dialog", { name: zh["approval.title"] });

    // ① 全局 allow：首次免卡
    await sendPrompt(page, "run global");
    await expect(page.getByText("global done 1").first()).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveCount(0);

    // ② 设置 › 权限：全局规则行 → 删除
    await openPermissionPage(page);
    const row = page.locator(".henira-permission-rule-row").filter({ hasText: command });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await shot(page, "08-global-rule-in-settings.png");
    await row.getByRole("button", { name: zh["permission.rule.delete"] }).click();
    const confirm = page.getByRole("dialog", {
      name: zh["settings.permission.deleteTitle"],
    });
    await confirm.locator("button.henira-danger").click();
    await expect(page.getByText(zh["settings.permission.emptyGlobal"])).toBeVisible({
      timeout: 20_000,
    });
    const globalFile = path.join(dataDir, "config", "permissions.json");
    expect(JSON.parse(await fs.readFile(globalFile, "utf8"))).toMatchObject({ rules: [] });
    await shot(page, "09-global-rule-deleted.png");
    await closeSettings(page);

    // ③ 同命令重新出卡
    await sendPrompt(page, "run global again");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: zh["approval.deny"], exact: true }).click();
    await expect(page.getByText("global done 2").first()).toBeVisible({ timeout: 20_000 });
    await shot(page, "10-global-card-returns.png");
  } finally {
    await stop();
  }
});
