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
import { chooseApprovalOption } from "./approval-choose.js";
import { sendPrompt } from "./send-prompt.js";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

/** 等会话 ui-state 真落盘（宿主 500ms 防抖；reload 的 pagehide 冲刷送达无保证）——
 *  「刷新保持」断言必须先有持久化事实，否则测到的是写读竞态而不是语义（CI 实锤一次）。 */
async function waitPermissionPersisted(page: Page, mode: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  await expect
    .poll(
      async () => {
        const list = (await (await fetch(`${origin}/api/sessions`)).json()) as { id: string }[];
        const id = list[0]?.id;
        if (id === undefined) return undefined;
        const doc = (await (
          await fetch(`${origin}/api/sessions/${encodeURIComponent(id)}/ui-state`)
        ).json()) as { permissionMode?: string };
        return doc.permissionMode;
      },
      { timeout: 5_000, message: "session ui-state did not persist" },
    )
    .toBe(mode);
}

async function startServer(
  script?: Parameters<typeof mockLlm>[0],
): Promise<{ server: HeniraServer; stop: () => Promise<void> }> {
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
  const mock = mockLlm(
    script ?? [writeRound, textRound, writeRound, textRound, writeRound, textRound],
  );
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

test("D-087 路径级允许 + 拒绝说明：同路径免卡 / 异路径再卡 / 说明落账", async ({ page }) => {
  const writeRound = (callId: string, file: string): Parameters<typeof mockLlm>[0][number] => [
    mockToolCall(callId, "write", `{"file_path":"${file}","content":"x"}`),
    mockUsage({ inputTokens: 1, outputTokens: 1 }),
    mockFinish("tool-calls"),
  ];
  const textRound = (text: string): Parameters<typeof mockLlm>[0][number] => [
    mockText(text),
    mockUsage({ inputTokens: 1, outputTokens: 1 }),
    mockFinish("stop"),
  ];
  const { server, stop } = await startServer([
    writeRound("wa1", "e2e-path-a.txt"),
    textRound("path done one"),
    writeRound("wa2", "e2e-path-a.txt"),
    textRound("path done two"),
    writeRound("wb1", "e2e-path-b.txt"),
    textRound("path done three"),
  ]);
  try {
    await page.goto(server.url);
    const title = zh["approval.title"];
    await page
      .getByRole("button", { name: zh["composer.permission"] })
      .waitFor({ state: "visible", timeout: 20_000 });

    // ① 第一次写 a：本会话允许此路径
    await sendPrompt(page, "write a");
    const card = page.getByRole("dialog", { name: title });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole("button", { name: zh["approval.sessionAllowPath"] })).toBeVisible();
    await chooseApprovalOption(card, zh["approval.sessionAllowPath"]);
    await expect(page.getByText("path done one").first()).toBeVisible({ timeout: 20_000 });
    await shot(page, "06-path-allow.png");

    // ② 写同路径：不再出卡（路径规则命中；写已存在文件的读态守卫是执行期错误，不影响卡语义）
    await sendPrompt(page, "write a again");
    await expect(page.getByText("path done two").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("dialog", { name: title })).toHaveCount(0);

    // ③ 写异路径：卡回来 + 说明框独立在场
    await sendPrompt(page, "write b");
    const second = page.getByRole("dialog", { name: title });
    await expect(second).toBeVisible({ timeout: 20_000 });
    await expect(second.getByLabel(zh["approval.feedbackAria"])).toBeVisible();

    // ④ 说明框回车 = 拒绝 + 说明：账本/快照落 feedback，痕迹行展开可见
    await second.getByLabel(zh["approval.feedbackAria"]).fill("用 pnpm");
    await second.getByLabel(zh["approval.feedbackAria"]).press("Enter");
    await expect(page.getByText("path done three").first()).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        async () => {
          const list = (await (await fetch(`${server.url}/api/sessions`)).json()) as {
            id: string;
          }[];
          const id = list[0]?.id;
          if (id === undefined) return undefined;
          const snap = (await (
            await fetch(`${server.url}/api/sessions/${encodeURIComponent(id)}/snapshot`)
          ).json()) as {
            rows: { kind: string; status?: string; decision?: string; feedback?: string }[];
          };
          return snap.rows.find(
            (row) =>
              row.kind === "approval" && row.status === "settled" && row.decision === "rejected",
          )?.feedback;
        },
        { timeout: 10_000, message: "feedback did not reach the ledger" },
      )
      .toBe("用 pnpm");
    // 官方对话流不渲染审批痕迹（既有纪律：pending 在 dock、settled 不产正文行）；
    // 说明已随账本/快照落定，这里只留截图证据
    await shot(page, "07-deny-feedback.png");
  } finally {
    await stop();
    await fs.rm(path.join(process.cwd(), "e2e-path-a.txt"), { force: true }).catch(() => {});
    await fs.rm(path.join(process.cwd(), "e2e-path-b.txt"), { force: true }).catch(() => {});
  }
});

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
    await sendPrompt(page, "first write");
    const card = page.getByRole("dialog", { name: zh["approval.title"] });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: zh["approval.allow"], exact: true }).click();
    await expect(page.getByText("permission flow complete").first()).toBeVisible({
      timeout: 20_000,
    });
    await shot(page, "01-ask-card.png");

    // ② chip 切完全访问：菜单两项各带档位图标（询问 = 手掌 / 完全访问 = 警示盾）→ 确认卡
    await chip.click();
    await page.getByRole("menu").waitFor({ state: "visible" });
    await expect(page.locator(".henira-permission-option-icon svg")).toHaveCount(2);
    await shot(page, "02-menu-icons.png");
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
    await sendPrompt(page, "second write");
    await page
      .getByText("permission flow complete")
      .nth(1)
      .waitFor({ state: "visible", timeout: 20_000 });
    await expect(page.getByRole("dialog", { name: zh["approval.title"] })).toHaveCount(0);
    await shot(page, "03-full-no-card.png");

    // ④ 刷新：full 保持（会话 ui-state 持久化——重启/刷新不回落，D-080）
    await waitPermissionPersisted(page, "full");
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
    await sendPrompt(page, "third write");
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
    await content.getByRole("button", { name: zh["settings.permission.default"] }).click();
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

test("D-088 审批卡选中 + 确认：默认首行/↑↓ 换选中/Enter 裁决；说明框聚焦即选中末行", async ({
  page,
}) => {
  const writeRound = (callId: string, file: string): Parameters<typeof mockLlm>[0][number] => [
    mockToolCall(callId, "write", `{"file_path":"${file}","content":"x"}`),
    mockUsage({ inputTokens: 1, outputTokens: 1 }),
    mockFinish("tool-calls"),
  ];
  const textRound = (text: string): Parameters<typeof mockLlm>[0][number] => [
    mockText(text),
    mockUsage({ inputTokens: 1, outputTokens: 1 }),
    mockFinish("stop"),
  ];
  // 两轮异路径：第一轮走「本会话允许此路径」，第二轮换文件重新出卡（聚焦说明框 → 拒绝 + 说明）
  const { server, stop } = await startServer([
    writeRound("kb1", "e2e-select-a.txt"),
    textRound("kb done one"),
    writeRound("kb2", "e2e-select-b.txt"),
    textRound("kb done two"),
    writeRound("kb3", "e2e-select-c.txt"),
    textRound("kb done three"),
  ]);
  try {
    await page.goto(server.url);
    await page
      .getByRole("button", { name: zh["composer.permission"] })
      .waitFor({ state: "visible", timeout: 20_000 });
    const card = page.getByRole("dialog", { name: zh["approval.title"] });

    // ① 首张卡：默认选中第 1 行并已聚焦，确认按钮在场可用
    await sendPrompt(page, "write one");
    await expect(card).toBeVisible({ timeout: 20_000 });
    const allow = card.getByRole("button", { name: zh["approval.allow"], exact: true });
    await expect(allow).toHaveClass(/is-selected/);
    await expect(allow).toBeFocused();
    const confirm = card.getByRole("button", { name: zh["approval.confirm"] });
    await expect(confirm).toBeEnabled();
    // D-089：左列表同步出现「等待确认」徽标（approval/asked 驱动 sessions.changed）
    const pendingBadge = page.locator("[data-session-pending]");
    await expect(pendingBadge).toHaveCount(1);
    await expect(pendingBadge).toContainText(zh["sessions.awaiting"]);
    await shot(page, "08-card-selection-default.png");

    // D-089：确认钮上按 Tab 也留在卡内（卡根兜底回当前选中行）
    await confirm.focus();
    await page.keyboard.press("Tab");
    await expect(allow).toBeFocused();

    // ② ↓ 移动选中 + 焦点跟随；Enter = 裁决当前选中行（第 2 行 = 本会话允许此路径）
    await page.keyboard.press("ArrowDown");
    const sessionPath = card.getByRole("button", {
      name: zh["approval.sessionAllowPath"],
      exact: true,
    });
    await expect(sessionPath).toHaveClass(/is-selected/);
    await expect(allow).not.toHaveClass(/is-selected/);
    await expect(sessionPath).toBeFocused();
    await shot(page, "09-card-selection-second.png");
    await page.keyboard.press("Enter");
    await expect(card).toHaveCount(0);
    await expect(page.getByText("kb done one").first()).toBeVisible({ timeout: 20_000 });
    await expect(pendingBadge).toHaveCount(0); // 收口信号把徽标摘掉

    // ③ 第二张卡：点说明框 → 末行选中、首行退选；空说明时确认钮禁用，填字后可用
    await sendPrompt(page, "write two");
    await expect(card).toBeVisible({ timeout: 20_000 });
    const feedback = card.getByLabel(zh["approval.feedbackAria"]);
    await feedback.click();
    await expect(card.locator(".henira-approval-feedback")).toHaveClass(/is-selected/);
    await expect(
      card.getByRole("button", { name: zh["approval.allow"], exact: true }),
    ).not.toHaveClass(/is-selected/);
    await expect(confirm).toBeDisabled();
    await shot(page, "10-card-feedback-selected.png");

    // D-089：↑ 移出说明框 → 光标跟选中回拒绝行（R206 焦点滞留回归）
    await feedback.press("ArrowUp");
    const deny = card.getByRole("button", { name: zh["approval.deny"], exact: true });
    await expect(deny).toHaveClass(/is-selected/);
    await expect(deny).toBeFocused();
    await expect(feedback).not.toBeFocused();

    // D-089：Tab 在「选项 + 说明行」循环——不回确认钮、不出卡
    await page.keyboard.press("Tab");
    await expect(feedback).toBeFocused();
    await expect(card.locator(".henira-approval-feedback")).toHaveClass(/is-selected/);
    await page.keyboard.press("Tab");
    await expect(allow).toBeFocused(); // 说明行 Tab = 回第 1 行
    await page.keyboard.press("Shift+Tab");
    await expect(feedback).toBeFocused(); // 首行 Shift+Tab = 回说明行（不再放行出卡）

    await feedback.fill("换个做法");
    await expect(confirm).toBeEnabled();
    await feedback.press("Enter"); // 说明框回车 = 拒绝 + 说明
    await expect(card).toHaveCount(0);
    await expect(page.getByText("kb done two").first()).toBeVisible({ timeout: 20_000 });
    await shot(page, "11-card-deny-feedback.png");

    // ④ 第三张卡：默认焦点在首行选项按钮上，直接 Esc = 拒绝（R206 审查回归——
    //    旧守卫排除所有 button，Esc 在默认焦点下失效）
    await sendPrompt(page, "write three");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(allow).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(page.getByText("kb done three").first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await stop();
    await fs.rm(path.join(process.cwd(), "e2e-select-a.txt"), { force: true }).catch(() => {});
    await fs.rm(path.join(process.cwd(), "e2e-select-b.txt"), { force: true }).catch(() => {});
    await fs.rm(path.join(process.cwd(), "e2e-select-c.txt"), { force: true }).catch(() => {});
  }
});
