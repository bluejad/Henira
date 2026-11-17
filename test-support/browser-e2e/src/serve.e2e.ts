// 浏览器端到端（roadmap M4 判据：serve 链路 + 截图留档；jsdom 组件级不替代本包）。
// 链路 = createServer（进程内真 server，tmp dataDir/globalDir 不碰真实家目录）
// + llm-mock 脚本化 LLM + probe 工具（非只读 → 真审批挂起）+ 自托管页面（dist-web）。
// 浏览器侧与真实用法同一条链：createClient 同源、哑渲染器行 store、审批经 REST 收答。
// 选择器一律取 locale 字典（zh）——文案改词表这里跟着改，用例字符串保持 ASCII。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockFinish, mockLlm, mockToolCall, mockUsage } from "@henira/llm-mock";
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

const mock = mockLlm([
  [mockToolCall("c1", "probe", '{"question":"ping"}'), mockUsage(USAGE), mockFinish("tool-calls")],
  finalStream(),
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
  await card.getByRole("button", { name: zh["approval.allow"] }).click();

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

  // 主题浅 → 深：设置浮层下拉，data-theme 落根容器；深色截图
  await page.getByRole("button", { name: zh["settings.open"] }).click();
  const settings = page.getByRole("dialog", { name: zh["settings.title"] });
  await expect(settings).toBeVisible();
  await settings.locator("select").first().selectOption({ label: zh["settings.theme.dark"] });
  await expect(page.locator(".henira-app[data-theme='dark']")).toHaveCount(1);
  await shot(page, "04-completed-dark.png");
});

// ── 用例 ②：安全模式双通道（判据④）——?ui=safe 入口 + 双击 Alt 切换 ──

test("safe mode: ui=safe entry and double-Alt toggle", async ({ page }) => {
  await page.goto(`${server.url}/?ui=safe`);
  const badge = page.getByText("safe mode", { exact: true });
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
