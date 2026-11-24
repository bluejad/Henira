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
import { sendPrompt } from "./send-prompt.js";

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
  // R184：ask_user 专用工具——提问卡全链（答题 + 取消）
  [
    mockToolCall(
      "q1",
      "ask_user",
      JSON.stringify({
        questions: [
          {
            id: "pick",
            question: "Pick one option?",
            header: "Pick",
            options: [{ label: "Alpha", description: "first" }, { label: "Beta" }],
          },
        ],
      }),
    ),
    mockUsage(USAGE),
    mockFinish("tool-calls"),
  ],
  [mockText("question flow complete"), mockUsage(USAGE), mockFinish("stop")],
  [
    mockToolCall(
      "q2",
      "ask_user",
      JSON.stringify({
        questions: [
          {
            id: "again",
            question: "Ask again?",
            options: [{ label: "Yes" }, { label: "No" }],
          },
        ],
      }),
    ),
    mockUsage(USAGE),
    mockFinish("tool-calls"),
  ],
  [mockText("question canceled"), mockUsage(USAGE), mockFinish("stop")],
  // R192：多题提问——页头常驻导航 + 单选互斥（选项 ↔ 自定义）
  [
    mockToolCall(
      "q3",
      "ask_user",
      JSON.stringify({
        questions: [
          {
            id: "first",
            question: "First question?",
            header: "First",
            options: [{ label: "One" }, { label: "Two" }],
          },
          { id: "second", question: "Second question?", header: "Second" },
        ],
      }),
    ),
    mockUsage(USAGE),
    mockFinish("tool-calls"),
  ],
  [mockText("two question flow complete"), mockUsage(USAGE), mockFinish("stop")],
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

  // 站点图标：静态托管按扩展名出图（文件缺失会落 SPA fallback 返回 HTML——MIME 断言锁真身）
  const icon = await page.request.get(new URL("/favicon.svg", page.url()).toString());
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toBe("image/svg+xml");

  // 静态页出货 + 自动选中预建会话 → 输入框可编辑
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await sendPrompt(page, "run the probe tool please");

  // R182：非只读工具 → 审批接管输入座位（composer.takeover chain）——输入栏隐藏但挂载
  const card = page.getByRole("dialog", { name: zh["approval.title"] });
  await expect(card).toBeVisible();
  await expect(page.locator(".henira-composer-bar-slot")).toBeHidden();
  await shot(page, "01-approval-card.png");
  await card.getByRole("button", { name: zh["approval.allow"], exact: true }).click();
  await expect(card).toBeHidden();
  await expect(page.locator(".henira-composer-bar-slot")).toBeVisible();

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
    .filter({ hasText: "run the probe tool please" });
  await expect(originalItem).toHaveCount(1);
  await originalItem.click();
  await expect(page.getByText(FINAL_TEXT)).toBeVisible(); // 会话行随快照回来

  // 主题浅 → 深：设置浮层主题下拉（HeniraSelect 自制弹层——原生 select 退场，基础件批 2026-11-20），
  // data-theme 落根容器；深色截图
  await page.getByRole("button", { name: zh["settings.open"] }).click();
  const settings = page.getByRole("dialog", { name: zh["settings.title"] });
  await expect(settings).toBeVisible();
  // R194：设置页统一铺满内容区（不再 760 固定列左贴边留右侧死区）
  const widths = await settings.evaluate((el) => {
    const pageEl = el.querySelector(".henira-settings-page") as HTMLElement | null;
    const contentEl = el.querySelector(".henira-settings-content") as HTMLElement | null;
    return {
      page: pageEl?.getBoundingClientRect().width ?? 0,
      content: contentEl?.clientWidth ?? 0,
    };
  });
  expect(widths.content).toBeGreaterThan(600);
  expect(Math.abs(widths.page - widths.content)).toBeLessThanOrEqual(2);
  await settings.locator(".henira-select-trigger").first().click();
  await page.getByRole("option", { name: zh["settings.theme.dark"] }).click();
  await expect(page.locator(".henira-app[data-theme='dark']")).toHaveCount(1);
  await shot(page, "04-completed-dark.png");
});

// ── 用例 ①b：轮尾操作栏（E4）——时间戳/复制/fork，fork 跳子会话 ──
// 不发新 prompt（llm 脚本按序消费，插队会挪后续用例的脚本段）——复用用例①跑完的预建会话

test("turn tail actions: timestamp, copy, fork to child session", async ({ page }) => {
  await page.goto(server.url);
  // 回到用例①的原会话（含已落定 probe 回合——以回复文本收尾 = fork 可点）
  const originalItem = page
    .locator(".henira-sessions li")
    .filter({ hasText: "run the probe tool please" });
  await originalItem.click();
  await expect(page.getByText(FINAL_TEXT)).toBeVisible();

  const actions = page.locator(".henira-turn-actions").last();
  await expect(actions).toBeVisible();
  await expect(actions.locator(".henira-turn-time")).toContainText(/[\d]/);
  const forkBtn = actions.getByRole("button", { name: zh["turn.fork"] });
  await expect(forkBtn).toBeEnabled();

  const before = await page.locator(".henira-sessions li").count();
  await forkBtn.click();
  // 子会话在册（列表 +1）且选中（输入框可编辑）
  await expect(page.locator(".henira-sessions li")).toHaveCount(before + 1);
  await expect(page.getByTestId("composer-input")).toBeEnabled();
  // 子会话行 = 前缀（probe 回合的最终回复在场）
  await expect(page.getByText(FINAL_TEXT)).toBeVisible();
  await shot(page, "09-e4-fork-child.png");
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
    // R185 活体抓的回归：组内 ＋ 建完即切——新行当场选中（data-active；此前只建不切）
    await expect(pickSession.getByRole("button")).toHaveAttribute("data-active", "true");
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
    // R185 收尾：删的是当前选中会话 → 立即回落，页头不再指向被删目录（此前会留死选中）
    await expect(page.locator(".henira-header-dir")).toBeVisible();
    await expect(page.locator(".henira-header-dir")).not.toHaveText(pickBase);

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
    await expect(page.getByTestId("composer-input")).toBeVisible({
      timeout: 15_000,
    });
    // 折叠组纯本地（用户裁决 2026-11-18）：非活跃组初值收起——先展开自己目录的组再切会话
    await page.locator("button.henira-session-group", { hasText: "henira-e2e-long" }).click();
    const longItem = page.locator(".henira-sessions li button", { hasText: "henira-e2e-long" });
    await longItem.click();
    // 选中态落定才发第一枪（R184 CI 实锤：点击后立刻 fill 会赶在宿主 sessionId 提交前
    // 把消息发进旧会话——text 永远不来，后续剧本全部错位；data-active 是宿主选中态事实）
    await expect(longItem).toHaveAttribute("data-active", "true", { timeout: 15_000 });
  } finally {
    await fs.rm(longDir, { recursive: true, force: true }).catch(() => {});
  }

  // 跑 32 个文本回合 → 64 行（> 尾窗 60；脚本按调用序消费 longTurnScript 段）
  for (let i = 0; i < LONG_TURNS; i++) {
    await sendPrompt(page, `长会话问 ${i}`);
    // 等该回合落定：assistant 文本出现（行数单调——确定性事实，不用 busy 位）
    await expect(page.getByText(`回合 ${i} 正文`).first()).toBeVisible({ timeout: 15_000 });
  }
  await page.waitForTimeout(300); // 末回合投影收尾

  // 重新连接：新连接快照走尾窗 60（64 行 > 60 → hasOlder true）——这是翻页数据的前置
  await page.reload();
  await expect(page.getByTestId("composer-input")).toBeVisible({ timeout: 15_000 });
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
  // R195：圆图标钮——无可见文字、32×32、中心与输入卡同轴、悬浮在输入卡上方
  const backBox = await back.boundingBox();
  const inputBox = await page.getByTestId("composer-input").boundingBox();
  expect(backBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  if (backBox === null || inputBox === null) throw new Error("box missing");
  expect(await back.textContent()).toBe("");
  expect(Math.round(backBox.width)).toBe(32);
  expect(Math.round(backBox.height)).toBe(32);
  expect(
    Math.abs(backBox.x + backBox.width / 2 - (inputBox.x + inputBox.width / 2)),
  ).toBeLessThanOrEqual(3);
  expect(backBox.y + backBox.height).toBeLessThan(inputBox.y);
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

  // R195：跟随中内容几何变化（缩窄窗口 → 正文重排变高）仍贴底——不依赖行数据变化
  await page.setViewportSize({ width: 1000, height: 720 });
  await expect
    .poll(
      async () =>
        await conv.evaluate(
          (el) =>
            (el as HTMLElement).scrollHeight -
              (el as HTMLElement).scrollTop -
              (el as HTMLElement).clientHeight <
            64,
        ),
      { timeout: 5_000 },
    )
    .toBe(true);
  await page.screenshot({ path: `${ARTIFACTS}/13-back-to-bottom-resize-follow.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
});

// ── 用例 ⑤：官方 fs 工具经真 UI 全链（D-065 批 B）——write 审批卡收答 → read 行号 → 收尾 ──

test("fs tools: write approval card, allow, read line numbers", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await sendPrompt(page, "write and read a demo file");

  // write 非只读 → 审批卡（fail-closed 默认）；收答放行
  const card = page.getByRole("dialog", { name: zh["approval.title"] });
  await expect(card).toBeVisible();
  await shot(page, "fs-01-write-approval.png");
  await card.getByRole("button", { name: zh["approval.allow"], exact: true }).click();

  // read（只读 → 默认放行层，无卡）→ 收尾文本
  await expect(page.getByText("fs flow complete")).toBeVisible({ timeout: 15_000 });
  // R177：完成轮过程默认折叠——展开「已工作」后 read 行在场；点文件 chip 开预览弹窗
  await page
    .getByRole("button", { name: /已处理|已工作/ })
    .last()
    .click();
  const fsGroups = page.locator(".henira-work-group-head");
  if (await fsGroups.count()) await fsGroups.last().click();
  await page.locator(".henira-file-link").first().click();
  // R188：文件预览默认走右侧 tab（设置可改为弹窗）——内容同源 resolver
  await expect(page.locator(".henira-right-preview")).toContainText("alpha");
  await expect(page.locator(".henira-right-preview")).toContainText("beta");
  await shot(page, "fs-02-right-preview.png");
  // 关掉预览 tab，避免右栏开态影响后续用例（同会话 ui-state 持久化）
  await page.locator(".henira-right-tab-close").click();
  await shot(page, "fs-02-tool-rows.png");
});

// ── 用例 ⑥：官方 bash 工具真 spawn → TerminalCard（E5 keyed 注册卡全链）──

test("per-tool card: bash terminal card via keyed registration", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await sendPrompt(page, "run a bash command");

  // bash 非只读 → 审批卡 → 允许
  const card = page.getByRole("dialog", { name: zh["approval.title"] });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: zh["approval.allow"], exact: true }).click();

  await expect(page.getByText("shell flow complete")).toBeVisible({ timeout: 15_000 });
  // R177：完成轮过程折叠——展开「已工作」后再点开 bash 工具行
  await page
    .getByRole("button", { name: /已处理|已工作/ })
    .last()
    .click();
  // TerminalCard（tool.call.view.bash 官方注册）：命令 prompt 行 + stdout
  await page
    .locator('[role="button"][aria-expanded="false"]')
    .filter({ hasText: zh["tool.kind.ran"] })
    .first()
    .click();
  await expect(page.locator(".henira-command-body pre")).toHaveText("echo henira-e5-done");
  await expect(page.getByText("henira-e5-done", { exact: true })).toBeVisible();
  await shot(page, "e5-01-terminal-card.png");
});

// ── 用例 ⑥（E6）：审批卡富化——edit diff 预览 / 本会话允许 / 同工具第二次折叠免审批 ──

test("E6 approval card: diff preview, session allow, second call skip", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await sendPrompt(page, "edit two files please");

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

  // 审批痕迹不进对话流；折叠生效 = 无第二张审批卡
  await page
    .getByRole("button", { name: /已处理|已工作/ })
    .last()
    .click();
  await expect(page.getByText(zh["approval.decision.session"])).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: zh["approval.title"] })).toHaveCount(0);
  await shot(page, "e6-02-session-allowed.png");
});

// ── 用例 ⑧（R184）：ask_user 提问卡——答题收答 + 痕迹行 + 取消路径 ──────

test("R184 ask_user: question card answer and cancel", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await sendPrompt(page, "ask me a question");

  // 提问接管输入座位（chain priority 5）：bar 隐藏但挂载
  const card = page.getByRole("dialog", { name: zh["question.title"] });
  await expect(card).toBeVisible();
  await expect(page.locator(".henira-composer-bar-slot")).toBeHidden();
  await expect(card.getByText("Pick one option?")).toBeVisible();
  await shot(page, "r184-01-question-card.png");

  // 单选：键盘链到卡即通（R185/R192——焦点在卡内，↑↓/Space 不靠鼠标）：
  // ↓ 落到第一个选项 → 空格选中并推进（单题 = 提交）→ 卡离场、回合继续
  await expect.poll(() => card.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(card).toBeHidden();
  await expect(page.getByText("question flow complete")).toBeVisible({ timeout: 15_000 });

  // 痕迹行：完成轮展开后问答对在场（question + Alpha 同卡）
  await page
    .getByRole("button", { name: /已处理|已工作/ })
    .last()
    .click();
  const groups = page.locator(".henira-work-group-head");
  if ((await groups.count()) > 0) await groups.last().click();
  await expect(page.locator(".henira-question-answers")).toContainText("Pick one option?");
  await expect(page.locator(".henira-question-answers")).toContainText("Alpha");
  await shot(page, "r184-02-question-trace.png");

  // 第二次提问 → 取消整个请求（工具收 Error、回合继续）
  await sendPrompt(page, "ask me again");
  const card2 = page.getByRole("dialog", { name: zh["question.title"] });
  await expect(card2).toBeVisible();
  await card2.getByRole("button", { name: zh["question.cancel"] }).click();
  await expect(card2).toBeHidden();
  await expect(page.getByText("question canceled")).toBeVisible({ timeout: 15_000 });
});

// ── 用例 ⑨（R192）：多题导航常驻页头 + 单选互斥（选项 ↔ 自定义）────────

test("R192 question card: header pager stays put; single-select custom is exclusive", async ({
  page,
}) => {
  await page.goto(server.url);
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await sendPrompt(page, "ask me two questions");

  const card = page.getByRole("dialog", { name: zh["question.title"] });
  await expect(card).toBeVisible();
  await expect(card.getByText("First question?")).toBeVisible();

  // 导航常驻页头：footer 只有取消 + 主按钮（不随翻页出现/消失），首题上一题禁用
  const nav = card.locator(".henira-question-head .henira-question-nav");
  await expect(nav).toBeVisible();
  const prev = nav.getByRole("button", { name: zh["question.previous"] });
  const next = nav.getByRole("button", { name: zh["question.next"] });
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(nav).toContainText("1 / 2");
  await expect(card.locator(".henira-question-foot .henira-question-nav")).toHaveCount(0);
  await expect(card.locator(".henira-question-foot button")).toHaveCount(2);
  await shot(page, "r192-01-multi-question.png");

  // 下一题 → 页码/禁用态切换；上一题回退
  await next.click();
  await expect(card.getByText("Second question?")).toBeVisible();
  await expect(nav).toContainText("2 / 2");
  await expect(prev).toBeEnabled();
  await expect(next).toBeDisabled();
  await prev.click();
  await expect(card.getByText("First question?")).toBeVisible();

  // 单选互斥：输入自定义 → 无选项处于选中态，自定义行显示已选态
  const custom = card.getByPlaceholder(zh["question.customPlaceholder"]);
  await custom.fill("Other answer");
  await expect(card.locator(".henira-question-option.is-selected")).toHaveCount(0);
  await expect(card.locator(".henira-question-custom.is-selected")).toHaveCount(1);

  // 清空自定义、点选项 → 选中即推进到第二题；回退后选项仍选中且自定义为空
  await custom.fill("");
  await card.getByRole("option", { name: /One/ }).click();
  await expect(card.getByText("Second question?")).toBeVisible();
  await prev.click();
  await expect(card.getByText("First question?")).toBeVisible();
  await expect(card.locator(".henira-question-option.is-selected")).toHaveCount(1);
  await expect(card.locator(".henira-question-custom.is-selected")).toHaveCount(0);
  await expect(custom).toHaveValue("");

  // 再输入自定义 → 选项取消选中（互斥；提交只会带自定义）
  await custom.fill("Other answer");
  await expect(card.locator(".henira-question-option.is-selected")).toHaveCount(0);
  await expect(card.locator(".henira-question-custom.is-selected")).toHaveCount(1);
  await shot(page, "r192-02-exclusive.png");

  // 继续到第二题（纯文本题，空选 = 跳过）并提交
  await card.getByRole("button", { name: zh["question.continue"] }).click();
  await expect(card.getByText("Second question?")).toBeVisible();
  await card.getByRole("button", { name: zh["question.submit"] }).click();
  await expect(card).toBeHidden();
  await expect(page.getByText("two question flow complete")).toBeVisible({ timeout: 15_000 });

  // 全链载荷：痕迹行只带自定义答案（单选互斥），第二题跳过
  await page
    .getByRole("button", { name: /已处理|已工作/ })
    .last()
    .click();
  const groups = page.locator(".henira-work-group-head");
  if ((await groups.count()) > 0) await groups.last().click();
  const answers = page.locator(".henira-question-answers").last();
  await expect(answers).toContainText("Other answer");
  await expect(answers).not.toContainText("One");
  await expect(answers).toContainText(zh["question.skipped"]);
});

// ── 用例 ⑦（R176）：流式期间列表零请求 + 双窗口列表/busy 推送同步 ──────
// 独立 server（llm 脚本按调用次序消费——不占共享剧本）：断言网络面板事实，
// 不信「界面看起来对」：首载后一整回合 /api/sessions 与 /api/dirs 计数必须零增长。

test("R176: zero list requests while streaming + cross-window push sync", async ({ page }) => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "henira-e2e-r176-"));
  const globalDir = await fs.mkdtemp(path.join(tmpdir(), "henira-e2e-r176-config-"));
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  const r176Mock = mockLlm([finalStream(), finalStream()]);
  const srv = await createServer({
    dataDir: dir,
    globalDir,
    llm: { name: "llm", start: () => r176Mock.service },
    port: 0,
  });
  const entry = await srv.registry.create({ cwd: dir });
  const listHits: string[] = [];
  page.on("request", (req) => {
    const pathname = new URL(req.url()).pathname;
    if (pathname === "/api/sessions" || pathname === "/api/dirs") listHits.push(pathname);
  });
  let page2: Page | undefined;
  try {
    await page.goto(srv.url);
    await expect(page.getByTestId("composer-input")).toBeVisible();
    // 首载请求落定（SSE 长连接使 networkidle 永不成立——短等后取基线）
    await page.waitForTimeout(700);
    const baseline = listHits.length;
    expect(baseline).toBeGreaterThan(0); // 开局各拉一次（会话 + 目录）

    // ① 本窗流式回合：全程列表零请求
    await sendPrompt(page, "stream please");
    await expect(page.locator(".henira-streaming")).toBeVisible();
    await page.waitForTimeout(300);
    expect(listHits.length).toBe(baseline);
    await expect(page.getByText(FINAL_TEXT)).toBeVisible();
    expect(listHits.length).toBe(baseline); // 回合结束仍零增长（流式增量不碰列表）
    await shot(page, "r176-01-zero-list-requests.png");

    // ② 双窗口：页 B 建会话 → 页 A 靠 sessions.changed 恰好重载一次
    page2 = await page.context().newPage();
    await page2.goto(srv.url);
    await expect(page2.getByTestId("composer-input")).toBeVisible();
    const before = await page.locator(".henira-sessions li").count();
    await page2.getByRole("button", { name: zh["sessions.new"] }).click();
    await expect(page.locator(".henira-sessions li")).toHaveCount(before + 1);
    await page.waitForTimeout(400);
    expect(listHits.length - baseline).toBe(2); // 一束信号一枪 = 会话+目录各一

    // ③ 页 B 跑回合 → 页 A busy 点推送翻内存（零列表请求）
    const hitsBeforeStream = listHits.length;
    await sendPrompt(page2, "stream in window two");
    await expect(page.getByLabel(zh["sessions.busy"])).toBeVisible(); // 页 A 收到状态推送
    await expect(page2.getByText(FINAL_TEXT)).toBeVisible();
    await expect(page.getByLabel(zh["sessions.busy"])).toHaveCount(0);
    expect(listHits.length).toBe(hitsBeforeStream); // 跨窗流式同样零请求
    await shot(page, "r176-02-cross-window.png");

    // ④ 双窗口删除：页 A 跟随列表事实（会话消失）；页 B 正看着被删会话 → 跨窗口回落
    await expect(page2.locator('.henira-sessions li button[data-active="true"]')).toHaveCount(1);
    const victim = (await srv.registry.list()).find((s) => s.id !== entry.id)?.id;
    expect(victim).toBeDefined();
    const del = await fetch(`${srv.url}/api/sessions/${victim as string}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    await expect(page.locator(".henira-sessions li")).toHaveCount(before);
    // R185 收尾：页 B 不再停在已删会话（先等列表刷新落定，再看回落选中恰好一行）
    await expect(page2.locator(".henira-sessions li")).toHaveCount(1);
    await expect(page2.locator('.henira-sessions li button[data-active="true"]')).toHaveCount(1);
  } finally {
    await page2?.close();
    await srv.stop();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(globalDir, { recursive: true, force: true }).catch(() => {});
  }
});
