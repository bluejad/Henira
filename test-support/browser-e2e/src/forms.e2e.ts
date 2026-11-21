// mock 逐形态验收套件（M4 批 A 判据③的 UI 半边）：mock 确定性重放稀有/结构形态，
// 每形态断言 + 截图留档（artifacts/10-16）。真 key 真实分布另一半在 real 采样脚本（env 门控不进 CI）。
// 覆盖：推理块折叠+usage 徽章 / 错误回合 / 审批拒绝 / 中断收尾 / 多工具并行 / 插话 steer / 输出截断。
// 选择器一律取 locale 字典（zh）或 ASCII fixture 内容；每用例独立 server（脚本按用例隔离）。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mockFinish,
  mockLlm,
  mockReasoning,
  mockText,
  mockToolCall,
  mockUsage,
} from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import type { StreamEvent, ToolDefinition } from "@henira/protocol";
import { LlmError } from "@henira/protocol";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";

const USAGE = { inputTokens: 7, outputTokens: 3 };

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

/** 每用例独立 server：脚本 + 可注册工具；结束 stop + 清理 tmp */
async function startServer(
  script: Parameters<typeof mockLlm>[0],
  tools: ToolDefinition[] = [],
): Promise<{ server: HeniraServer; dataDir: string; stop: () => Promise<void> }> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-forms-"));
  const globalDir = await fs.mkdtemp(path.join(tmpdir(), "henira-forms-cfg-"));
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  const mock = mockLlm(script);
  const server = await createServer({
    dataDir,
    globalDir,
    llm: { name: "llm", start: () => mock.service },
    port: 0,
  });
  const entry = await server.registry.create({ cwd: dataDir });
  for (const tool of tools) entry.ctx.get("tools").register(tool);
  return {
    server,
    dataDir,
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(globalDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function send(page: Page, text: string): Promise<void> {
  const area = page.getByPlaceholder(zh["composer.placeholder"]);
  await area.fill(text);
  await area.press("Enter");
}

/** 会话 id（插话 steer 端点要用） */
async function sessionIdOf(base: string): Promise<string> {
  const res = await fetch(`${base}/api/sessions`);
  const list = (await res.json()) as { id: string }[];
  return list[0].id;
}

// ── 推理块 + usage 徽章（reasoning 独立字段；step/end 用量投影）────────────

test("推理块折叠 + usage 徽章", async ({ page }) => {
  const { server, stop } = await startServer([
    [
      mockReasoning("step one, then step two."),
      mockText("Conclusion: take either half."),
      mockUsage({ inputTokens: 12, outputTokens: 4 }),
      mockFinish("stop"),
    ],
  ]);
  await page.goto(server.url);
  await send(page, "think then answer");
  await expect(page.getByText("Conclusion: take either half.")).toBeVisible();
  await expect(page.getByText(zh["row.reasoning"])).toBeVisible(); // 推理折叠 summary
  await expect(page.getByText("12↑ 4↓")).toBeVisible(); // usage 徽章（步级用量投影）
  await shot(page, "10-reasoning-usage.png");
  await stop();
});

// ── 错误回合（LlmError → 流 rejection → error 事件 → ErrorRow）───────────

test("错误回合：模型流失败落 error 行", async ({ page }) => {
  const { server, stop } = await startServer([new LlmError("LLM_STREAM", "mock stream exploded")]);
  await page.goto(server.url);
  await send(page, "trigger a failure");
  await expect(page.getByText("mock stream exploded")).toBeVisible();
  await expect(page.getByText("LLM_STREAM")).toBeVisible();
  await shot(page, "11-error-turn.png");
  await stop();
});

// ── 审批拒绝（deny → settled rejected → 回合继续）─────────────────────────

const probeTool: ToolDefinition = {
  name: "probe",
  description: "non-readonly e2e fixture (requires approval)",
  inputSchema: {
    type: "object",
    properties: { question: { type: "string" } },
    required: ["question"],
  },
  execute: async () => ({ content: "pong" }),
};

test("审批拒绝：deny → settled rejected → 回合继续", async ({ page }) => {
  const { server, stop } = await startServer(
    [
      [
        mockToolCall("c1", "probe", '{"question":"ping"}'),
        mockUsage(USAGE),
        mockFinish("tool-calls"),
      ],
      [mockText("Denied as requested."), mockUsage(USAGE), mockFinish("stop")],
    ],
    [probeTool],
  );
  await page.goto(server.url);
  await send(page, "run probe");
  const card = page.getByRole("dialog", { name: zh["approval.title"] });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: zh["approval.deny"] }).click();
  await expect(page.getByText("Denied as requested.")).toBeVisible();
  await expect(page.getByText(zh["approval.decision.rejected"], { exact: true })).toBeVisible(); // settled 痕迹行中文决策词（R171 词表化）
  await shot(page, "12-denied.png");
  await stop();
});

// ── 中断收尾（hang → 停止按钮 → turn/end{aborted} → 冻结行标 interrupted）─

test("中断：停止 → 部分文本定格 + 已中断徽章", async ({ page }) => {
  // 半截文本后挂起——MockTurn 函数形态拿 signal 织入竞速（abort 即拒绝，loop 按中断纪律收尾）
  const partialThenHang = ((_req: unknown, signal: AbortSignal) =>
    (async function* () {
      yield { type: "text-delta", text: "half written..." } as StreamEvent;
      await new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new LlmError("ABORTED", "hung until aborted")),
          { once: true },
        );
      });
    })()) as Parameters<typeof mockLlm>[0][number];
  const { server, stop } = await startServer([partialThenHang]);
  await page.goto(server.url);
  await send(page, "start and then stop me");
  const stopButton = page.getByRole("button", { name: zh["composer.stop"], exact: true });
  await expect(stopButton).toBeVisible();
  await expect(page.getByText("half written...")).toBeVisible(); // 流式行在
  await stopButton.click();
  await expect(page.getByText(zh["row.interrupted"])).toBeVisible(); // 冻结行标中断
  await shot(page, "13-interrupted.png");
  await stop();
});

// ── 多工具并行（一个 step 两个 call，各占一行）────────────────────────────

test("多工具并行：两 call 各占一行", async ({ page }) => {
  const echo: ToolDefinition = {
    name: "echo-a",
    description: "readonly fixture a",
    inputSchema: { type: "object" },
    isConcurrencySafe: true,
    execute: async () => ({ content: "a" }),
  };
  const echoB: ToolDefinition = {
    name: "echo-b",
    description: "readonly fixture b",
    inputSchema: { type: "object" },
    isConcurrencySafe: true,
    execute: async () => ({ content: "b" }),
  };
  const { server, stop } = await startServer(
    [
      [
        mockToolCall("c1", "echo-a", "{}"),
        mockToolCall("c2", "echo-b", "{}"),
        mockUsage(USAGE),
        mockFinish("tool-calls"),
      ],
      [mockText("Both tools ran."), mockUsage(USAGE), mockFinish("stop")],
    ],
    [echo, echoB],
  );
  await page.goto(server.url);
  await send(page, "run both tools");
  await expect(page.getByText("Both tools ran.")).toBeVisible();
  await expect(page.getByText("echo-a")).toBeVisible();
  await expect(page.getByText("echo-b")).toBeVisible();
  await shot(page, "14-multi-tool.png");
  await stop();
});

// ── 插话 steer（忙时入队 → steer 升格 → step 边界进场带徽章）──────────────

test("插话 steer：忙时投递升格 → step 边界进场带 steer 徽章", async ({ page }) => {
  const slow: ToolDefinition = {
    name: "slow-probe",
    description: "slow readonly fixture",
    inputSchema: { type: "object" },
    isConcurrencySafe: true,
    execute: async () => {
      // 800ms 工具窗：prompt + steer 两个 HTTP 往返必须落在窗内（150ms 在并行负载下越窗时，
      // 队列条目会被回合末冲刷成新回合 source=send——steer 徽章不出现，稳定复现于 5 worker 全量）
      await new Promise((r) => setTimeout(r, 800));
      return { content: "slow done" };
    },
  };
  const { server, stop } = await startServer(
    [
      [mockToolCall("c1", "slow-probe", "{}"), mockUsage(USAGE), mockFinish("tool-calls")],
      [mockText("Steer received."), mockUsage(USAGE), mockFinish("stop")],
    ],
    [slow],
  );
  await page.goto(server.url);
  await send(page, "start working");
  await expect(page.getByText("slow-probe")).toBeVisible(); // 工具执行窗内
  const id = await sessionIdOf(server.url);
  const queued = (await (
    await fetch(`${server.url}/api/sessions/${id}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text: "look-at-this-first" }),
    })
  ).json()) as { queued: boolean; id: string | null };
  expect(queued.queued).toBe(true);
  await fetch(`${server.url}/api/sessions/${id}/steer`, {
    method: "POST",
    body: JSON.stringify({ entryId: queued.id }),
  });
  await expect(page.getByText("Steer received.")).toBeVisible();
  await expect(page.getByText("look-at-this-first")).toBeVisible();
  await expect(page.getByText("steer", { exact: true })).toBeVisible(); // source 徽章
  await shot(page, "15-steer.png");
  await stop();
});

// ── 排队卡（E1：忙时投递可见化——面板/徽章/插话）+ 立即发送抢占 ─────────────

test("排队卡：忙时 Enter 入队 → 面板可见 → Ctrl+Enter 插话徽章 → 立即发送抢占（停当前发该条）→ 剩余条目自动续冲", async ({
  page,
}) => {
  // 半截文本后挂起：流式行在场（中断徽章可标）+ 无限窗排两条
  const partialThenHang = ((_req: unknown, signal: AbortSignal) =>
    (async function* () {
      yield { type: "text-delta", text: "half written..." } as StreamEvent;
      await new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new LlmError("ABORTED", "hung until aborted")),
          { once: true },
        );
      });
    })()) as Parameters<typeof mockLlm>[0][number];
  const { server, stop } = await startServer([
    partialThenHang,
    [mockText("Promoted reply."), mockUsage(USAGE), mockFinish("stop")],
    [mockText("Post-steer reply."), mockUsage(USAGE), mockFinish("stop")],
  ]);
  await page.goto(server.url);
  await send(page, "start working");
  await expect(page.getByText("half written...")).toBeVisible(); // 挂起回合流式行在场
  const area = page.getByPlaceholder(zh["composer.placeholder"]);
  // 忙时 Enter=排队 → 面板出现（标题 + 条目行；无插话徽章）
  await area.fill("first-queued-message");
  await area.press("Enter");
  const panel = page.getByRole("list", { name: zh["composer.queue.title"] });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("first-queued-message")).toBeVisible();
  // Ctrl+Enter=插话 → 条目带插话徽章（面板内同件区分 queue/steer）
  await area.fill("steered-while-busy");
  await area.press("Control+Enter");
  const steeredRow = panel.getByText("steered-while-busy");
  await expect(steeredRow).toBeVisible();
  await expect(panel.getByText(zh["composer.queue.badgeSteer"])).toBeVisible();
  await shot(page, "17-queue-panel.png");
  // 立即发送（抢占式）：停当前回合 + 以第一条开新回合（steer 徽章条目照常留守）
  await panel
    .getByText("first-queued-message")
    .locator("..")
    .getByRole("button", { name: zh["composer.queue.sendNow"] })
    .click();
  // 被抢占回合的流式行标已中断；提升条目回复先落
  await expect(page.getByText(zh["row.interrupted"])).toBeVisible();
  await expect(page.getByText("Promoted reply.")).toBeVisible();
  // steer 徽章条目按 D-045 插话语义在提升回合的 step 边界进场（带徽章落流），
  // 队列自此清空 → 面板退场；全程无暂停横幅（抢占不产生冻结态）
  await expect(page.getByText("steered-while-busy")).toBeVisible();
  await expect(page.getByText("steer", { exact: true })).toBeVisible(); // 流内插话徽章
  await expect(panel).toHaveCount(0);
  await expect(page.getByText(zh["composer.queue.pausedTitle"])).toHaveCount(0);
  await shot(page, "18-queue-drained.png");
  await stop();
});

// ── 中断×队列（停止 = 队列冻结不冲刷 + 暂停横幅 + 继续发送恢复）──────────────

test("中断冻结：停止 → 队列留守 + 暂停横幅 → 继续发送 → 条目逐条回复进流", async ({ page }) => {
  // 半截文本后挂起——abort 即拒绝（同 13 中断收尾的织入法）
  const partialThenHang = ((_req: unknown, signal: AbortSignal) =>
    (async function* () {
      yield { type: "text-delta", text: "half written..." } as StreamEvent;
      await new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new LlmError("ABORTED", "hung until aborted")),
          { once: true },
        );
      });
    })()) as Parameters<typeof mockLlm>[0][number];
  const { server, stop } = await startServer([
    partialThenHang,
    [mockText("Frozen entry replied."), mockUsage(USAGE), mockFinish("stop")],
    [mockText("Second entry replied."), mockUsage(USAGE), mockFinish("stop")],
  ]);
  await page.goto(server.url);
  await send(page, "start and then stop me");
  const stopButton = page.getByRole("button", { name: zh["composer.stop"], exact: true });
  await expect(stopButton).toBeVisible();
  const area = page.getByPlaceholder(zh["composer.placeholder"]);
  const panel = page.getByRole("list", { name: zh["composer.queue.title"] });
  // 忙时排两条
  await area.fill("frozen-entry-one");
  await area.press("Enter");
  await expect(panel).toBeVisible();
  await area.fill("frozen-entry-two");
  await area.press("Enter");
  await expect(panel.getByText("frozen-entry-two")).toBeVisible();
  // 停止 → 冻结：横幅标题切换 + 条目留守（不落流、不消失——修复前条目会生而为 abort 全烧掉）
  await stopButton.click();
  await expect(page.getByText(zh["composer.queue.pausedTitle"])).toBeVisible();
  await expect(panel.getByText("frozen-entry-one")).toBeVisible();
  await shot(page, "19-queue-paused.png");
  // 继续发送 → 队头条目逐条开回合、各有回复；面板排空退场
  await page.getByRole("button", { name: zh["composer.queue.resume"] }).click();
  await expect(page.getByText("Frozen entry replied.")).toBeVisible();
  await expect(page.getByText("frozen-entry-one")).toBeVisible(); // 第一条落流（面板此刻只剩第二条）
  await expect(page.getByText("Second entry replied.")).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("frozen-entry-two")).toBeVisible(); // 面板退场后流内唯一命中
  await shot(page, "20-queue-resumed.png");
  await stop();
});

// ── 输出截断（>50KB → 尾注 + truncated 徽章 + spill 落盘）────────────────

test("输出截断：徽章 + 尾注 + spill 落盘会话 artifacts/", async ({ page }) => {
  const big: ToolDefinition = {
    name: "big-output",
    description: "readonly fixture with oversized output",
    inputSchema: { type: "object" },
    isConcurrencySafe: true,
    execute: async () => ({ content: "TRUNCATION-MARK\n".padEnd(60_000, "x") }),
  };
  const { server, dataDir, stop } = await startServer(
    [
      [mockToolCall("c1", "big-output", "{}"), mockUsage(USAGE), mockFinish("tool-calls")],
      [mockText("Output inspected."), mockUsage(USAGE), mockFinish("stop")],
    ],
    [big],
  );
  await page.goto(server.url);
  await send(page, "read the big output");
  await expect(page.getByText("Output inspected.")).toBeVisible();
  await expect(page.getByText(zh["row.truncated"])).toBeVisible(); // 截断徽章
  // spill 落盘会话 artifacts/（ToolContext.artifactsDir 接线的事实断言）
  const spillPath = await findFile(dataDir, "c1.txt");
  expect(spillPath).toBeDefined();
  const spilled = await fs.readFile(spillPath as string, "utf8");
  expect(spilled).toContain("TRUNCATION-MARK");
  await shot(page, "16-truncated.png");
  await stop();
});

/** 递归找文件名（spill 落盘断言用；会话目录名含 hash 不可预知） */
async function findFile(root: string, name: string): Promise<string | undefined> {
  let found: string | undefined;
  const walk = async (dir: string): Promise<void> => {
    if (found !== undefined) return;
    for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) await walk(full);
      else if (dirent.name === name) found = full;
    }
  };
  await walk(root);
  return found;
}
