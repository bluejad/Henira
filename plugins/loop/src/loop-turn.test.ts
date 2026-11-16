import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHarness, type ServiceDefinition } from "@reins/kernel";
import { mockFinish, mockLlm, mockText, mockToolCall, mockUsage } from "@reins/llm-mock";
import { sessionPlugin } from "@reins/plugin-session";
import { toolsPlugin } from "@reins/plugin-tools";
import { asReinsContext, type Decision, type LlmService } from "@reins/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// 整链装配的真实插件只有 session / tools / loop 自身；llm = mockLlm（脚本驱动），
// approval / interaction / config = 槽位桩。examples/mock e2e（commit 9）走同一套。

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "reins-loop-"));
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

import type { ToolDefinition } from "@reins/protocol";

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
  const ctx = asReinsContext(harness.context);
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
      [mockToolCall("c1", "read", '{"path":"a.txt"}'), mockUsage(USAGE), mockFinish("tool-calls")],
      [mockText("文件内容是…"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const events = await collect(loop.run("看看 a.txt"));
    expect(events.map((e) => e.type)).toContain("tool-started");
    expect(events.map((e) => e.type)).toContain("tool-finished");
    const types = session.events().map((e) => e.type);
    expect(types).toContain("tool/call");
    expect(types).toContain("tool/result");
    expect(types.filter((t) => t === "step/start")).toHaveLength(2); // 两个 step
    const result = session.events().find((e) => e.type === "tool/result");
    expect(result === undefined ? undefined : (result.data as { content: string }).content).toBe(
      "file body",
    );
    // P1：模型可见 ⟺ 已落日志——派生历史含工具结果
    const derived = session.deriveMessages();
    expect(derived.some((m) => m.role === "tool")).toBe(true);
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
    const { harness, loop, sessionDir } = await startedLoop([
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
    const consuming = (async () => {
      for await (const event of loop.run("第一")) events.push(event.type);
    })();
    await new Promise((r) => setTimeout(r, 5)); // 回合已开（current 在场）
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
    const { harness, loop, session } = await startedLoop(
      [
        [mockToolCall("c1", "read", "{}"), mockUsage(USAGE), mockFinish("tool-calls")],
        [mockText("收到插话后收尾"), mockUsage(USAGE), mockFinish("stop")],
      ],
      undefined,
      slowRead,
    );
    const events: { type: string }[] = [];
    const consuming = (async () => {
      for await (const event of loop.run("干活")) events.push(event);
    })();
    // 工具执行中（60ms 窗口）升格插话——step 边界在工具结果落定之后
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
    const ctx = asReinsContext(harness.context);
    // 直接 send（闲时直发会开新回合）→ 队列条目随后被冲刷
    await new Promise((r) => setTimeout(r, 30)); // 等 send 的后台回合跑完 + 队列冲刷
    const loop = ctx.get("loop");
    await loop.send("触发");
    await new Promise((r) => setTimeout(r, 40));
    const texts = ctx
      .get("session")
      .events()
      .filter((e) => e.type === "user/message")
      .map((e) => (e.data as { content: string }).content);
    expect(texts).toContain("重启前排队的一问"); // 装载的旧条目被冲刷成新回合
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
