// 浏览器端到端（roadmap M4 判据：serve 链路 + 截图留档；jsdom 组件级不替代本包）。
// 链路 = createServer（进程内真 server，tmp dataDir/globalDir 不碰真实家目录）
// + llm-mock 脚本化 LLM + probe 工具（非只读 → 真审批挂起）+ 自托管页面（dist-web）。
// 浏览器侧与真实用法同一条链：createClient 同源、哑渲染器行 store、审批经 REST 收答。
// 选择器一律取 locale 字典（zh）——文案改词表这里跟着改，用例字符串保持 ASCII。

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
import type { StreamEvent, ToolDefinition } from "@henira/protocol";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";

// ── 固定装置：脚本化 LLM + 非只读 probe 工具 ─────────────────────────

const USAGE = { inputTokens: 7, outputTokens: 3 };
const CHUNKS = [
  "probe ",
  "done: ",
  "ping ",
  "answered ",
  "with ",
  "pong. ",
  "all ",
  "systems ",
  "nominal.",
];
const FINAL_TEXT = CHUNKS.join("");

/** 逐块慢流（60ms/块）——给「流式中」留出可断言、可截图的真实窗口 */
async function* finalStream(): AsyncGenerator<StreamEvent> {
  for (const chunk of CHUNKS) {
    yield { type: "text-delta", text: chunk };
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  yield { type: "usage", usage: USAGE };
  yield { type: "finish", reason: "stop" };
}

// 用例④（长会话翻页/虚拟化）消费脚本段：32 个纯文本回合（64 行 > 快照尾窗 60）
const LONG_TURNS = 32;
const longTurnScript: MockEntry[] = Array.from({ length: LONG_TURNS }, (_, i) => [
  mockText(`回合 ${i} 正文`),
  mockFinish("stop"),
]);
const mock = mockLlm([
  [mockToolCall("c1", "probe", '{"question":"ping"}'), mockUsage(USAGE), mockFinish("tool-calls")],
  finalStream(),
  ...longTurnScript,
  // D-065 批 B：官方 fs 工具经真 UI 全链（write 审批卡 → read 行号）——defaultPreset 装配
  [
    mockToolCall("fs1", "write", '{"file_path":"e2e-demo.txt","content":"alpha\\nbeta\\n"}'),
    mockUsage(USAGE),
    mockFinish("tool-calls"),
  ],
  [
    mockToolCall("fs2", "read", '{"file_path":"e2e-demo.txt"}'),
    mockUsage(USAGE),
    mockFinish("tool-calls"),
  ],
  [mockText("fs flow complete"), mockUsage(USAGE), mockFinish("stop")],
  // E5：官方 bash 工具真 spawn——TerminalCard 全链（官方 keyed 注册卡 + 命令行 + 分色输出）
  [
    mockToolCall("sh1", "bash", '{"command":"echo henira-e5-done"}'),
    mockUsage(USAGE),
    mockFinish("tool-calls"),
  ],
  [mockText("shell flow complete"), mockUsage(USAGE), mockFinish("stop")],
  // E6：审批卡富化——edit 形状参数（diff 预览数据源）+ 同工具两连调（本会话允许 → 第二次折叠免审批）
  [
    mockToolCall(
      "e6a",
      "edit",
      '{"file_path":"e6-demo.txt","old_string":"one\\ntwo","new_string":"one\\nTWO"}',
    ),
    mockToolCall("e6b", "edit", '{"file_path":"e6-other.txt","old_string":"a","new_string":"b"}'),
    mockUsage(USAGE),
    mockFinish("tool-calls"),
  ],
  [mockText("e6 approval flow complete"), mockUsage(USAGE), mockFinish("stop")],
]);

/** llm 槽位包装（examples/mock 同款）：mockLlm 给的是 LlmService，槽位要 ServiceDefinition */
const mockLlmSlot = { name: "llm", start: () => mock.service };

/** 非只读（无 isConcurrencySafe）→ 默认放行层不放 → 审批缝真挂起（tools-approval §3） */
const probeTool: ToolDefinition = {
  name: "probe",
  description: "Probe tool that requires approval (non-readonly e2e fixture)",
  inputSchema: {
    type: "object",
    properties: { question: { type: "string" } },
    required: ["question"],
  },
  execute: async () => ({ content: "pong" }),
};

// ── server 生命周期：两个用例共用一台（llm 脚本按调用次序消费）────────

let server: HeniraServer;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-e2e-data-"));
  const globalDir = await fs.mkdtemp(path.join(tmpdir(), "henira-e2e-config-"));
  // llm 是桩，配置仍要有默认模型可解析（examples/mock 同款最小 settings）
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  server = await createServer({ dataDir, globalDir, llm: mockLlmSlot, port: 0 });
  const entry = await server.registry.create({ cwd: dataDir });
  entry.ctx.get("tools").register(probeTool);
});

test.afterAll(async () => {
  await server?.stop();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

// ── 截图留档（artifacts/ 不入库；CI 上传 artifact）──────────────────

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

// ── 用例 ①：serve 链路回合——审批收答 / 流式渲染 / 新会话 / 双主题 ──

test("serve chain: approval settle, streaming render, sessions, themes", async ({ page }) => {
  await page.goto(server.url);

  // 静态页出货 + 自动选中预建会话 → 输入框可编辑
  const textarea = page.getByPlaceholder(zh["composer.placeholder"]);
  await expect(textarea).toBeVisible();
  await textarea.fill("run the probe tool please");
  await textarea.press("Enter");

  // busy：发送钮换停止钮（D-045 单口 busy 形态）
  await expect(page.getByRole("button", { name: zh["composer.stop"] })).toBeVisible();

  // 审批卡真挂起（非只读工具）→ 截图 → 点「允许」收答（REST settle）
  const card = page.getByRole("dialog", { name: zh["approval.title"] });
  await expect(card).toBeVisible();
  await shot(page, "01-approval-card.png");
  await card.getByRole("button", { name: zh["approval.allow"], exact: true }).click();

  // 工具执行 → 第二次模型调用慢流 → 流式行透明度浮现窗口截图
  const streaming = page.locator(".henira-streaming");
  await expect(streaming).toBeVisible();
  await shot(page, "02-streaming.png");

  // 完成：全文渲染、思考指示消失、恢复发送钮
  await expect(page.getByText(FINAL_TEXT)).toBeVisible();
  await expect(page.getByText(zh["conversation.thinking"])).toBeHidden();
  await expect(page.getByRole("button", { name: zh["composer.send"] })).toBeVisible();
  await shot(page, "03-completed-light.png");

  // 「+ 新会话」走 POST /api/sessions：列表 2 条；点回原会话（列表按更新时间排序，新会话在前）
  await page.getByRole("button", { name: zh["sessions.new"] }).click();
  await expect(page.locator(".henira-sessions li")).toHaveCount(2);
  const originalItem = page
    .locator(".henira-sessions li")
    .filter({ hasText: path.basename(dataDir) });
  await expect(originalItem).toHaveCount(1);
  await originalItem.click();
  await expect(page.getByText(FINAL_TEXT)).toBeVisible(); // 会话行随快照回来

  // 主题浅 → 深：设置浮层主题下拉（HeniraSelect 自制弹层——原生 select 退场，基础件批 2026-11-20），
  // data-theme 落根容器；深色截图
  await page.getByRole("button", { name: zh["settings.open"] }).click();
  const settings = page.getByRole("dialog", { name: zh["settings.title"] });
  await expect(settings).toBeVisible();
  await settings.locator(".henira-select-trigger").first().click();
  await page.getByRole("option", { name: zh["settings.theme.dark"] }).click();
  await expect(page.locator(".henira-app[data-theme='dark']")).toHaveCount(1);
  await shot(page, "04-completed-dark.png");
});

// ── 用例 ②：安全模式双通道（判据④）——?ui=safe 入口 + 双击 Alt 切换 ──

test("safe mode: ui=safe entry and double-Alt toggle", async ({ page }) => {
  await page.goto(`${server.url}/?ui=safe`);
  // 徽标文案走字典（app.safeMode 死键活化——shell 不再硬编码英文）
  const badge = page.getByText(zh["app.safeMode"], { exact: true });
  await expect(badge).toBeVisible();
  await shot(page, "05-safe-mode.png");

  // 双击 Alt 运行时切换：安全模式 → 正常 → 安全模式（600ms 双击窗口内）
  await page.keyboard.press("Alt");
  await page.keyboard.press("Alt");
  await expect(badge).toBeHidden();
  await page.keyboard.press("Alt");
  await page.keyboard.press("Alt");
  await expect(badge).toBeVisible();
});

// ── 用例 ③：目录区（R127 三拍板）——新增目录弹窗 / 按目录新建会话 / 右键删除 ──

test("directory area: add dir dialog, per-dir session, right-click delete", async ({ page }) => {
  const pickDir = await fs.mkdtemp(path.join(tmpdir(), "henira-e2e-pick-"));
  try {
    await page.goto(server.url);

    // 区头 hover 才显「＋目录」（opacity+pointer-events 联动——先 hover 宿主行再点）
    const header = page.locator(".henira-sidebar-header");
    await header.hover();
    await page.getByRole("button", { name: zh["dirs.add"] }).click();
    const dialog = page.getByRole("dialog", { name: zh["dirs.add"] });
    await expect(dialog).toBeVisible();
    // 目录树根（此电脑）与路径输入框双通道；手敲绝对路径直接确定（树懒展开受真盘符影响不断言）
    await expect(dialog.getByText(zh["dirs.computer"])).toBeVisible();
    await dialog.getByPlaceholder(zh["dirs.pathPlaceholder"]).fill(pickDir);
    await shot(page, "06-directory-dialog.png");
    await dialog.getByRole("button", { name: zh["dirs.confirm"] }).click();
    await expect(dialog).toBeHidden();

    // 空登记目录也显示（组头 = 目录名 + 0 徽标）
    const pickBase = path.basename(pickDir);
    const groupBtn = page.locator("button.henira-session-group", { hasText: pickBase });
    await expect(groupBtn).toBeVisible();

    // 目录行 hover 显 ＋ → 在该目录新建会话（createSession({cwd}) → 自动登记 + li 出现）
    const groupRow = page.locator(".henira-group-row", { hasText: pickBase });
    await groupRow.hover();
    await groupRow.getByRole("button", { name: zh["menu.newSession"] }).click();
    const pickSession = page.locator(".henira-sessions li").filter({ hasText: pickBase });
    await expect(pickSession).toHaveCount(1);
    await shot(page, "07-directory-session.png");

    // 右键会话 → 删除 → 确认弹窗（「永久删除」）→ 行消失
    await pickSession.click({ button: "right" });
    await page.getByRole("button", { name: zh["menu.delete"] }).click();
    const confirm = page.getByRole("dialog", { name: zh["sessions.deleteTitle"] });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(zh["sessions.deleteMessage"])).toBeVisible();
    await shot(page, "08-delete-confirm.png");
    await confirm.getByRole("button", { name: zh["menu.delete"] }).click();
    await expect(pickSession).toHaveCount(0);

    // 右键目录 → 删除目录 → 确认（登记条目移除——无会话目录随之消失）
    await groupBtn.click({ button: "right" });
    await page.getByRole("button", { name: zh["menu.deleteDir"] }).click();
    const dirConfirm = page.getByRole("dialog", { name: zh["dirs.deleteTitle"] });
    await expect(dirConfirm).toBeVisible();
    await dirConfirm.getByRole("button", { name: zh["menu.delete"] }).click();
    await expect(groupBtn).toHaveCount(0);
  } finally {
    await fs.rm(pickDir, { recursive: true, force: true }).catch(() => {});
  }
});

// ── 用例 ④：长会话（批 A'）——快照尾窗 / 虚拟化窗口挂载 / 滚顶翻页不跳顶 / 回底按钮 ──

test("long conversation: snapshot tail window, virtualization, loadOlder, back-to-bottom", async ({
  page,
}) => {
  // 专属会话：D-063 后 boot 还原"上次选中"（上一用例点回的原会话），本用例必须显式切进
  // 自己的空会话——回合计数与「回合 0 在顶」断言都以独占会话为前提
  const longDir = await fs.mkdtemp(path.join(tmpdir(), "henira-e2e-long-"));
  try {
    await server.registry.create({ cwd: longDir });
    await page.goto(server.url);
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    // 折叠组纯本地（用户裁决 2026-11-18）：非活跃组初值收起——先展开自己目录的组再切会话
    await page.locator("button.henira-session-group", { hasText: "henira-e2e-long" }).click();
    await page.locator(".henira-sessions li button", { hasText: "henira-e2e-long" }).click();
  } finally {
    await fs.rm(longDir, { recursive: true, force: true }).catch(() => {});
  }

  // 跑 32 个文本回合 → 64 行（> 尾窗 60；脚本按调用序消费 longTurnScript 段）
  const textarea = page.getByPlaceholder(zh["composer.placeholder"]);
  for (let i = 0; i < LONG_TURNS; i++) {
    await textarea.fill(`长会话问 ${i}`);
    await textarea.press("Enter");
    // 等该回合落定：assistant 文本出现（行数单调——确定性事实，不用 busy 位）
    await expect(page.getByText(`回合 ${i} 正文`).first()).toBeVisible({ timeout: 15_000 });
  }
  await page.waitForTimeout(300); // 末回合投影收尾

  // 重新连接：新连接快照走尾窗 60（64 行 > 60 → hasOlder true）——这是翻页数据的前置
  await page.reload();
  await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300); // 快照帧应用 + 首帧渲染

  // 虚拟化生效：挂载的轮块（[data-index]）远小于总轮数（32 轮——可视窗 + overscan 2）
  const mounted = await page.locator(".henira-conversation [data-index]").count();
  expect(mounted).toBeLessThan(10);
  await page.screenshot({ path: `${ARTIFACTS}/09-long-tail-window.png` });

  // 真实滚轮连滚到顶（上滚手势解除跟随——与真实用户路径一致；程序化 scrollTop 不解除，
  // 跟随中的贴底语义会把视口拽回底部，那不是翻页路径）
  const conv = page.locator(".henira-conversation");
  await conv.hover();
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, -600);
    const top = await conv.evaluate((el) => (el as HTMLElement).scrollTop);
    if (top < 4) break;
  }
  // 滚顶触发 loadOlder：前插后首个虚拟块（data-index=0）从「回合 2」变「回合 0」
  // （scrollHeight 随挂载窗口浮动不可靠——虚拟化下用块内容断言）
  await expect
    .poll(
      async () =>
        await conv.evaluate(() => {
          const first = document.querySelector(".henira-conversation [data-index='0']");
          return first?.textContent?.includes("回合 0") ? true : undefined;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  // 阅读位置稳定（前插不跳顶的用户可感知结果）：翻页前视口顶部内容（回合 2）仍可见
  await expect(page.getByText("问 2")).toBeVisible();
  await page.screenshot({ path: `${ARTIFACTS}/10-load-older-prepended.png` });

  // 回底按钮：离底即出现（滚轮上滚已解除跟随）→ 点击回底 → 按钮消失
  const back = page.getByRole("button", { name: zh["conversation.backToBottom"] });
  await expect(back).toBeVisible();
  await page.screenshot({ path: `${ARTIFACTS}/11-back-to-bottom-visible.png` });
  await back.click();
  await expect(back).toBeHidden();
  const atBottom = await conv.evaluate(
    (el) =>
      (el as HTMLElement).scrollHeight -
        (el as HTMLElement).scrollTop -
        (el as HTMLElement).clientHeight <
      64,
  );
  expect(atBottom).toBe(true);
  await page.screenshot({ path: `${ARTIFACTS}/12-back-at-bottom.png` });
});

// ── 用例 ⑤：官方 fs 工具经真 UI 全链（D-065 批 B）——write 审批卡收答 → read 行号 → 收尾 ──

test("fs tools: write approval card, allow, read line numbers", async ({ page }) => {
  await page.goto(server.url);
  const textarea = page.getByPlaceholder(zh["composer.placeholder"]);
  await expect(textarea).toBeVisible();
  await textarea.fill("write and read a demo file");
  await textarea.press("Enter");

  // write 非只读 → 审批卡（fail-closed 默认）；收答放行
  const card = page.getByRole("dialog", { name: zh["approval.title"] });
  await expect(card).toBeVisible();
  await shot(page, "fs-01-write-approval.png");
  await card.getByRole("button", { name: zh["approval.allow"], exact: true }).click();

  // read（只读 → 默认放行层，无卡）→ 收尾文本
  await expect(page.getByText("fs flow complete")).toBeVisible({ timeout: 15_000 });
  // read 工具行折叠体默认不挂 DOM（row-chrome 展开才渲染）→ 点开 read 行再断言内容。
  // E5 读取卡把 `N\t` 格式拆成行号 gutter + 内容列（两个 span）——按内容文本断言
  await page.locator("[aria-expanded]").filter({ hasText: "read" }).first().click();
  await expect(page.getByText("alpha")).toBeVisible();
  await expect(page.getByText("beta")).toBeVisible();
  await shot(page, "fs-02-tool-rows.png");
});

// ── 用例 ⑥：官方 bash 工具真 spawn → TerminalCard（E5 keyed 注册卡全链）──

test("per-tool card: bash terminal card via keyed registration", async ({ page }) => {
  await page.goto(server.url);
  const textarea = page.getByPlaceholder(zh["composer.placeholder"]);
  await expect(textarea).toBeVisible();
  await textarea.fill("run a bash command");
  await textarea.press("Enter");

  // bash 非只读 → 审批卡 → 允许
  const card = page.getByRole("dialog", { name: zh["approval.title"] });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: zh["approval.allow"], exact: true }).click();

  await expect(page.getByText("shell flow complete")).toBeVisible({ timeout: 15_000 });
  // TerminalCard（tool.call.view.bash 官方注册）：命令 prompt 行 + stdout（meta 分色通道）。
  // stdout 是真 spawn 回执（"henira-e5-done\r\n"）——exact 断言只命中输出 pre，不误配命令行
  await page.locator("[aria-expanded]").filter({ hasText: "bash" }).first().click();
  await expect(page.getByText("echo henira-e5-done")).toBeVisible();
  await expect(page.getByText("henira-e5-done", { exact: true })).toBeVisible();
  await shot(page, "e5-01-terminal-card.png");
});

// ── 用例 ⑥（E6）：审批卡富化——edit diff 预览 / 本会话允许 / 同工具第二次折叠免审批 ──

test("E6 approval card: diff preview, session allow, second call skip", async ({ page }) => {
  await page.goto(server.url);
  const textarea = page.getByPlaceholder(zh["composer.placeholder"]);
  await expect(textarea).toBeVisible();
  await textarea.fill("edit two files please");
  await textarea.press("Enter");

  // 审批卡：edit 形状参数 → per-tool 预览体（diff add 行）+ 三选项集（bash 族才不提供本会话允许）
  const card = page.getByRole("dialog", { name: zh["approval.title"] });
  await expect(card).toBeVisible();
  await expect(card.getByText("e6-demo.txt")).toBeVisible();
  await expect(card.getByText("TWO", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: zh["approval.sessionAllow"] })).toBeVisible();
  await shot(page, "e6-01-approval-diff-preview.png");

  // 本会话允许（scope:'session'）→ c1 执行 → c2 折叠免审批直接执行 → 回合完成
  await card.getByRole("button", { name: zh["approval.sessionAllow"] }).click();
  await expect(page.getByText("e6 approval flow complete")).toBeVisible({ timeout: 15_000 });

  // settled 留痕：决策原文 + 「· 本会话」标记；折叠生效 = 无第二张审批卡
  await expect(page.getByText("allowed-once · 本会话")).toBeVisible();
  await expect(page.getByRole("dialog", { name: zh["approval.title"] })).toHaveCount(0);
  await shot(page, "e6-02-session-allowed.png");
});
