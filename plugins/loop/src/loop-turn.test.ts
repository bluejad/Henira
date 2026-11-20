import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHarness, type ServiceDefinition } from "@henira/kernel";
import {
  mockFinish,
  mockLlm,
  mockReasoning,
  mockText,
  mockToolCall,
  mockUsage,
} from "@henira/llm-mock";
import { sessionPlugin } from "@henira/plugin-session";
import { toolsPlugin } from "@henira/plugin-tools";
import { asHeniraContext, type Decision, type LlmService } from "@henira/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 整链装配的真实插件只有 session / tools / loop 自身；llm = mockLlm（脚本驱动），
// approval / interaction / config = 槽位桩。examples/mock e2e（commit 9）走同一套。

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-loop-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const USAGE = { inputTokens: 10, outputTokens: 5 };

function llmStub(service: LlmService): ServiceDefinition<LlmService> {
  return { name: "llm", start: () => service };
}

function approvalStub(decisions: Decision[] = ["allowed-once"]): ServiceDefinition {
  const queue = [...decisions];
  return {
    name: "approval",
    start() {
      return { requestPermission: async () => queue.shift() ?? "allowed-once" };
    },
  };
}

function interactionStub(): ServiceDefinition {
  return {
    name: "interaction",
    start() {
      return {
        ask: async () => ({ kind: "approval", requestId: "x", decision: "allowed-once" }),
        settle: () => false,
        listPending: () => [],
      };
    },
  };
}

function configStub(): ServiceDefinition {
  return {
    name: "config",
    start() {
      return {
        cwd: root,
        model: () => ({ provider: "mock", model: "mock-1" }),
        credential: async () => "k",
        get: () => undefined,
        permissionRules: async () => [],
      };
    },
  };
}

const readTool = {
  name: "read",
  description: "read",
  inputSchema: { type: "object" },
  isConcurrencySafe: true,
  execute: async () => ({ content: "file body" }),
};

import type { ToolDefinition } from "@henira/protocol";

async function startedLoop(
  script: Parameters<typeof mockLlm>[0],
  maxStepsPerTurn?: number,
  toolOverride?: ToolDefinition,
) {
  const mock = mockLlm(script);
  const sessionDir = path.join(root, "sess");
  const harness = createHarness()
    .use(sessionPlugin({ directory: sessionDir, cwd: root }))
    .use(toolsPlugin({}))
    .use(llmStub(mock.service))
    .use(approvalStub())
    .use(interactionStub())
    .use(configStub())
    .use((await import("./service.js")).loopPlugin({ maxStepsPerTurn }));
  await harness.start();
  const ctx = asHeniraContext(harness.context);
  ctx.get("tools").register(toolOverride ?? readTool);
  return { harness, ctx, loop: ctx.get("loop"), mock, sessionDir, session: ctx.get("session") };
}

async function collect(gen: AsyncIterable<{ type: string }>): Promise<{ type: string }[]> {
  const events: { type: string }[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe("turn/step 状态机（loop.md §1）", () => {
  it("纯文本回合：run() 流出 delta 与 turn-ended；账本落 system 基底 + user + assistant + request/header + step/end + turn/end", async () => {
    const { harness, loop, session } = await startedLoop([
      [mockText("你"), mockText("好"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const events = await collect(loop.run("打个招呼"));
    expect(events.at(-1)?.type).toBe("turn-ended");
    const types = session.events().map((e) => e.type);
    expect(types).toEqual([
      "system/message",
      "user/message",
      "turn/start",
      "step/start",
      "request/header",
      "assistant/message",
      "step/end",
      "turn/end",
    ]);
    const base = session.events()[0];
    expect((base.data as { key?: string }).key).toBe("loop/base");
    expect((base.data as { content: string }).content).not.toContain("面板");
    const header = session.events().find((e) => e.type === "request/header");
    const headerData =
      header === undefined
        ? undefined
        : (header.data as { toolNames: string[]; systemPromptHash: string });
    expect(headerData?.toolNames).toEqual(["read"]);
    expect(headerData?.systemPromptHash).toHaveLength(16);
    await harness.dispose();
  });

  it("工具回合：tool-call → tool-started/tool-finished 事件 → tool/result 落账 → 续步收尾（第二轮纯文本）", async () => {
    const { harness, loop, session } = await startedLoop([
      [
        mockReasoning("先看看 a.txt"),
        mockToolCall("c1", "read", '{"path":"a.txt"}'),
        mockUsage(USAGE),
        mockFinish("tool-calls"),
      ],
      [mockText("文件内容是…"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const events = await collect(loop.run("看看 a.txt"));
    expect(events.map((e) => e.type)).toContain("tool-started");
    expect(events.map((e) => e.type)).toContain("tool-finished");
    const types = session.events().map((e) => e.type);
    expect(types).toContain("tool/call");
    expect(types).toContain("tool/result");
    expect(types.filter((t) => t === "step/start")).toHaveLength(2); // 两个 step
    // 思考档批（2026-11-19）：工具轮 reasoning 与纯文本轮同形落账本——DeepSeek V4.1+
    // 带 tool_calls 的历史 assistant 回传 reasoning_content 是续轮硬要求，不落账无法回传
    const firstAssistant = session.events().find((e) => e.type === "assistant/message");
    expect(
      firstAssistant === undefined
        ? undefined
        : (firstAssistant.data as { reasoning?: string }).reasoning,
    ).toBe("先看看 a.txt");
    const derived0 = session.deriveMessages();
    const derivedToolTurn = derived0.find((m) => m.role === "assistant");
    expect(
      derivedToolTurn === undefined || derivedToolTurn.role !== "assistant"
        ? undefined
        : derivedToolTurn.reasoning,
    ).toBe("先看看 a.txt");
    const result = session.events().find((e) => e.type === "tool/result");
    expect(result === undefined ? undefined : (result.data as { content: string }).content).toBe(
      "file body",
    );
    // P1：模型可见 ⟺ 已落日志——派生历史含工具结果
    const derived = session.deriveMessages();
    expect(derived.some((m) => m.role === "tool")).toBe(true);
    await harness.dispose();
  });

  it("回合级 usage = 各步累加（两步工具回合：turn/end.usage 是合计而非末步覆盖）", async () => {
    const { harness, loop, session } = await startedLoop([
      [
        mockToolCall("c1", "read", '{"path":"a.txt"}'),
        mockUsage({ inputTokens: 10, outputTokens: 5 }),
        mockFinish("tool-calls"),
      ],
      [
        mockText("文件内容是…"),
        mockUsage({ inputTokens: 100, outputTokens: 50 }),
        mockFinish("stop"),
      ],
    ]);
    await collect(loop.run("看看 a.txt"));
    const end = session.events().find((e) => e.type === "turn/end");
    const usage =
      end === undefined
        ? undefined
        : (end.data as { usage?: Record<string, number | undefined> }).usage;
    expect(usage).toEqual({
      inputTokens: 110,
      outputTokens: 55,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    });
    await harness.dispose();
  });

  it("基底 system 块只注入一次（key 防重复，同名最新）", async () => {
    const { harness, loop, session } = await startedLoop([
      [mockText("a"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("b"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    await collect(loop.run("第一"));
    await collect(loop.run("第二"));
    const bases = session.events().filter((e) => e.type === "system/message");
    expect(bases).toHaveLength(1);
    await harness.dispose();
  });

  it("忙时投递唯一 = 排队（D-045）：run 中 send 入队并持久化 queue.json；回合末自动开新回合", async () => {
    const { harness, ctx, loop, sessionDir } = await startedLoop([
      // 第一回合：慢速文本流，留出 send() 窗口
      (req) => {
        void req;
        return new Promise((resolve) => {
          setTimeout(
            () => resolve([mockText("第一回合"), mockUsage(USAGE), mockFinish("stop")]),
            40,
          );
        });
      },
      // 队列冲刷出的第二回合
      [mockText("第二回合"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const events: string[] = [];
    // 回合已开的确定性信号：bus turn/start（先订阅再 run——固定 sleep 在慢机上是竞态）
    const turnStarted = new Promise<void>((resolve) => {
      ctx.events.on("turn/start", () => resolve());
    });
    const consuming = (async () => {
      for await (const event of loop.run("第一")) events.push(event.type);
    })();
    await turnStarted;
    const queued = await loop.send("插进来的第二问");
    expect(queued.id).not.toBe(""); // 真实队列条目
    const raw = await fs.readFile(path.join(sessionDir, "queue.json"), "utf8"); // 持久化
    expect(raw).toContain("插进来的第二问");
    await consuming;
    // 回合末队列自动冲刷：第二回合的 user/message 已落账本
    const sources = await fs.readdir(sessionDir);
    expect(sources).toContain("queue.json");
    expect(events.at(-1)).toBe("turn-ended");
    await harness.dispose();
  });

  it("插话：step 边界进场（不打断工具）——steer 条目落 user/message{source:steer} 并进本回合", async () => {
    let _toolStarted = false;
    const slowRead: ToolDefinition = {
      ...readTool,
      execute: async () => {
        _toolStarted = true;
        await new Promise((r) => setTimeout(r, 80));
        return { content: "file body" };
      },
    };
    const { harness, ctx, loop, session } = await startedLoop(
      [
        [mockToolCall("c1", "read", "{}"), mockUsage(USAGE), mockFinish("tool-calls")],
        [mockText("收到插话后收尾"), mockUsage(USAGE), mockFinish("stop")],
      ],
      undefined,
      slowRead,
    );
    // 插话广播（D-065 插话重置的观察口）：每条 steer 落账后一条 user/steer
    const steers: { turn: string; step: number }[] = [];
    ctx.events.on("user/steer", (p) => steers.push(p as { turn: string; step: number }));
    const events: { type: string }[] = [];
    const consuming = (async () => {
      for await (const event of loop.run("干活")) events.push(event);
    })();
    // 等工具真跑起来再投递——send/steer 稳定落在 80ms 工具窗内（step 边界 claim #1 已过、
    // claim #2 未到），消除与 turn 启动的竞态（原写法负载下偶发越窗，2026-11-17 批 A 复现两次）
    while (!_toolStarted) await new Promise((r) => setTimeout(r, 1));
    const queued = await loop.send("优先看这个");
    expect(queued.id).not.toBe("");
    await loop.steer(queued.id);
    await consuming;
    const steerMsg = session
      .events()
      .find((e) => e.type === "user/message" && (e.data as { source?: string }).source === "steer");
    expect(steerMsg).toBeDefined();
    expect(
      steerMsg === undefined ? undefined : (steerMsg.data as { content: string }).content,
    ).toBe("优先看这个");
    // 广播事实与账本一致：恰好一条，带 turn + step
    expect(steers).toHaveLength(1);
    expect(steers[0]?.turn).toBe((steerMsg?.data as { turn?: string } | undefined)?.turn);
    expect(typeof steers[0]?.step).toBe("number");
    void events;
    await harness.dispose();
  });

  it("重启恢复：queue.json 在新实例装载后继续冲刷（D-045 持久化语义）", async () => {
    const sessionDir = path.join(root, "sess2");
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, "queue.json"),
      JSON.stringify({
        version: 1,
        entries: [{ id: "q1", text: "重启前排队的一问", steer: false, queuedAt: 0 }],
      }),
      "utf8",
    );
    const mock = mockLlm([[mockText("重启后跑"), mockUsage(USAGE), mockFinish("stop")]]);
    const harness = createHarness()
      .use(sessionPlugin({ directory: sessionDir, cwd: root }))
      .use(toolsPlugin({}))
      .use(llmStub(mock.service))
      .use(approvalStub())
      .use(interactionStub())
      .use(configStub())
      .use((await import("./service.js")).loopPlugin());
    await harness.start();
    const ctx = asHeniraContext(harness.context);
    // 直接 send（闲时直发会开新回合）→ 队列条目随后被冲刷
    // （queue.load() 在 plugin start 内 await——harness.start() 返回即装载完毕，无需等余波）
    const loop = ctx.get("loop");
    await loop.send("触发");
    // 后台回合与队列冲刷无法 await——轮询账本直至旧条目落成新回合（固定 sleep 在慢机上有竞态）
    await vi.waitFor(
      () => {
        const texts = ctx
          .get("session")
          .events()
          .filter((e) => e.type === "user/message")
          .map((e) => (e.data as { content: string }).content);
        expect(texts).toContain("重启前排队的一问"); // 装载的旧条目被冲刷成新回合
      },
      { timeout: 2000, interval: 20 },
    );
    await harness.dispose();
  });

  it("步数上限（可选，D-045）：maxStepsPerTurn=1 时工具回合后以 max-tokens 收尾", async () => {
    const { harness, loop, session } = await startedLoop(
      [[mockToolCall("c1", "read", "{}"), mockUsage(USAGE), mockFinish("tool-calls")]],
      1,
    );
    const events = await collect(loop.run("只许一步"));
    expect(events.at(-1)).toEqual({ type: "turn-ended", reason: "max-tokens" });
    const end = session.events().find((e) => e.type === "turn/end");
    expect(end === undefined ? undefined : (end.data as { reason: string }).reason).toBe(
      "max-tokens",
    );
    await harness.dispose();
  });
});
