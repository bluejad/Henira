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
import {
  asHeniraContext,
  type ContextReading,
  type Decision,
  LlmError,
  type LlmRequest,
  type LlmService,
  type PreStepValue,
} from "@henira/protocol";
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
      return { requestPermission: async () => ({ decision: queue.shift() ?? "allowed-once" }) };
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

function configStub(contextWindow?: number): ServiceDefinition {
  return {
    name: "config",
    start() {
      return {
        cwd: root,
        // 窗口未声明 = 未知（§4.3：阈值仍按缺省 128K，输出不封顶）
        model: () => ({
          provider: "mock",
          model: "mock-1",
          ...(contextWindow !== undefined ? { contextWindow } : {}),
        }),
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
  seen?: LlmRequest[],
  llmOverride?: LlmService,
  contextWindow?: number,
) {
  const mock = mockLlm(script);
  const llm: LlmService =
    llmOverride ??
    (seen === undefined
      ? mock.service
      : {
          async *stream(req, signal) {
            seen.push(req);
            yield* mock.service.stream(req, signal);
          },
        });
  const sessionDir = path.join(root, "sess");
  const harness = createHarness()
    .use(sessionPlugin({ directory: sessionDir, cwd: root }))
    .use(toolsPlugin({}))
    .use(llmStub(llm))
    .use(approvalStub())
    .use(interactionStub())
    .use(configStub(contextWindow))
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

  it("每次模型请求携带会话 id（厂商路由头取值；多步回合内不变）", async () => {
    const seen: LlmRequest[] = [];
    const { harness, loop, session } = await startedLoop(
      [
        [
          mockToolCall("c1", "read", '{"path":"a.txt"}'),
          mockUsage(USAGE),
          mockFinish("tool-calls"),
        ],
        [mockText("完成"), mockUsage(USAGE), mockFinish("stop")],
      ],
      undefined,
      undefined,
      seen,
    );
    await collect(loop.run("读一下"));
    const sessionId = session.header().id;
    expect(seen).toHaveLength(2);
    expect(seen.map((req) => req.sessionId)).toEqual([sessionId, sessionId]);
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
    const { harness, ctx, loop, sessionDir, session } = await startedLoop([
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
    // 回合末队列自动冲刷：第二回合的 user/message 已落账本，且带排队条目 id（D-086）
    const sources = await fs.readdir(sessionDir);
    expect(sources).toContain("queue.json");
    expect(events.at(-1)).toBe("turn-ended");
    const users = session
      .events()
      .filter((e) => e.type === "user/message")
      .map((e) => e.data as { content: string; queueId?: string });
    expect(users.find((d) => d.content === "第一")?.queueId).toBeUndefined(); // 直接发送不带
    expect(users.find((d) => d.content === "插进来的第二问")?.queueId).toBe(queued.id); // 冲刷回合带
    await harness.dispose();
  });

  it("E1 排队面：pending()/remove() 读写队列；queue/changed 随变更广播（enqueue/升格/remove/冲刷）", async () => {
    // 当前回合用显式闸放行：固定 sleep 在并行负载下会让回合在断言前收尾（慢机竞态——
    // 与 R189 无关的既有 flaky 家族；闸门让「回合进行中」成为确定事实）
    let releaseFirstTurn!: () => void;
    const firstTurnGate = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });
    const { harness, ctx, loop } = await startedLoop([
      (req) => {
        void req;
        return firstTurnGate.then(() => [mockText("一"), mockUsage(USAGE), mockFinish("stop")]);
      },
      [mockText("二"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("三"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const changes: number[] = [];
    ctx.events.on("queue/changed", (p) =>
      changes.push((p as { queue: { id: string }[] }).queue.length),
    );
    const turnStarted = new Promise<void>((resolve) => {
      ctx.events.on("turn/start", () => resolve());
    });
    const consuming = (async () => {
      for await (const event of loop.run("第一")) void event;
    })();
    await turnStarted;
    const q1 = await loop.send("排队一");
    const q2 = await loop.send("排队二");
    expect(loop.pending().map((e) => e.id)).toEqual([q1.id, q2.id]); // 快照读取
    await loop.steer(q1.id); // 升格 → 广播（条数不变仍广播）
    expect(await loop.remove(q2.id)).toBe(true);
    expect(await loop.remove("q不存在")).toBe(false);
    expect(loop.pending().map((e) => e.id)).toEqual([q1.id]); // 删除生效
    releaseFirstTurn(); // 放行当前回合 → 回合末冲刷 q1（升格条目作新回合跑掉）
    await consuming;
    expect(loop.pending()).toHaveLength(0); // 回合末冲刷清空（升格条目作新回合跑掉）
    expect(changes).toContain(2);
    expect(changes).toContain(1);
    expect(changes.at(-1)).toBe(0);
    await harness.dispose();
  });

  it("E1 插话入队：send(prompt,{steer:true}) 忙时直接以插话身份入队（REST/facade 通道引擎底座）", async () => {
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
        [mockText("收到直插后收尾"), mockUsage(USAGE), mockFinish("stop")],
      ],
      undefined,
      slowRead,
    );
    const steers: unknown[] = [];
    ctx.events.on("user/steer", (p) => steers.push(p));
    const consuming = (async () => {
      for await (const event of loop.run("干活")) void event;
    })();
    while (!_toolStarted) await new Promise((r) => setTimeout(r, 1));
    const queued = await loop.send("直插的话", { steer: true });
    expect(queued.id).not.toBe("");
    expect(queued.steer).toBe(true); // 入队即插话身份（一步到位，无需二跳升格）
    await consuming;
    const steerMsg = session
      .events()
      .find((e) => e.type === "user/message" && (e.data as { source?: string }).source === "steer");
    expect(
      steerMsg === undefined ? undefined : (steerMsg.data as { content: string }).content,
    ).toBe("直插的话");
    expect(steers).toHaveLength(1);
    await harness.dispose();
  });

  it("E1 立即发送抢占：promote 排队中间条目 = abort 当前 + 该条先跑 + 前面条目留守 + 回合末自动续冲", async () => {
    const { harness, loop, session } = await startedLoop([
      "hang", // 首回合挂住 → 被 promote 打断
      [mockText("中间条目回复"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("队首条目回复"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const consuming = (async () => {
      for await (const _ of loop.run("首回合挂住")) void _;
    })();
    await new Promise((r) => setTimeout(r, 20));
    await loop.send("队首条目");
    const q2 = await loop.send("中间条目");
    const promoted = await loop.promote(q2.id);
    expect(promoted).toBe(true);
    await consuming; // 被抢占回合 aborted 收尾
    expect(await loop.promote("q不存在")).toBe(false); // 不存在：不 abort 在跑的回合
    // 完成判据 = 两条回复都在场（提升回合 + 续冲回合；mock 秒完成，turn/end 计数有竞态）
    const getContents = () =>
      session
        .events()
        .filter((e) => e.type === "assistant/message")
        .map((e) => (e.data as { content: string }).content);
    while (!getContents().includes("中间条目回复") || !getContents().includes("队首条目回复")) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // user 行次序实锤插队：首回合提问 → 被提升的中间条目 → 留守的队首条目
    const userTexts = session
      .events()
      .filter((e) => e.type === "user/message")
      .map((e) => (e.data as { content: string }).content);
    expect(userTexts).toEqual(["首回合挂住", "中间条目", "队首条目"]);
    const contents = session
      .events()
      .filter((e) => e.type === "assistant/message")
      .map((e) => (e.data as { content: string }).content);
    expect(contents).toContain("中间条目回复");
    expect(contents).toContain("队首条目回复");
    expect(loop.pending()).toHaveLength(0);
    expect(loop.paused()).toBe(false); // 抢占不产生冻结态（瞬态置位已被 clearPause 收掉）
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

describe("第 1 层地基：五字段 usage / loop/pre-step / 计量与封顶（compaction.md §6.1）", () => {
  it("usage 五字段原样落 step/end 与 turn/end", async () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
      reasoningTokens: 2,
    };
    const { harness, loop, session } = await startedLoop([
      [mockText("hi"), mockUsage(usage), mockFinish("stop")],
    ]);
    await collect(loop.run("五字段"));
    const stepEnd = session.events().find((e) => e.type === "step/end");
    expect((stepEnd?.data as { usage?: unknown } | undefined)?.usage).toMatchObject(usage);
    const turnEnd = session.events().find((e) => e.type === "turn/end");
    expect((turnEnd?.data as { usage?: unknown } | undefined)?.usage).toMatchObject(usage);
    await harness.dispose();
  });

  it("loop/pre-step 派发：载荷带模型/会话/回合/步/余量读数，监听器可替换 messages", async () => {
    const seen: LlmRequest[] = [];
    const { harness, ctx, loop, session } = await startedLoop(
      [[mockText("ok"), mockUsage(USAGE), mockFinish("stop")]],
      undefined,
      undefined,
      seen,
    );
    let captured: PreStepValue | undefined;
    ctx.events.onWaterfall("loop/pre-step", (value, next) => {
      captured = value as PreStepValue;
      return next({
        ...(value as PreStepValue),
        messages: [
          ...(value as PreStepValue).messages,
          { role: "user", content: "injected-by-hook" },
        ],
      });
    });
    await collect(loop.run("看看余量"));
    expect(captured).toBeDefined();
    expect(captured?.sessionId).toBe(session.header().id);
    expect(captured?.turn).toMatch(/^t-/);
    expect(captured?.step).toBe(1);
    expect(captured?.model.provider).toBe("mock");
    expect(captured?.context.size).toBe(128_000);
    expect(captured?.context.estimated).toBe(true); // 首步无锚点
    expect(captured?.context.used).toBeGreaterThan(0);
    // 替换后的 messages 真的进了请求
    const last = seen[0]?.messages.at(-1);
    expect(last).toEqual({ role: "user", content: "injected-by-hook" });
    await harness.dispose();
  });

  it("余量活态：contextUsage() 有读数、context/changed 已广播；闲时 isBusy 为假", async () => {
    const { harness, ctx, loop } = await startedLoop([
      [mockText("ok"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const readings: number[] = [];
    ctx.events.on("context/changed", (payload) => {
      readings.push((payload as { context: { used: number } }).context.used);
    });
    await collect(loop.run("量一下"));
    const usage = loop.contextUsage();
    expect(usage?.size).toBe(128_000);
    expect(usage?.used).toBeGreaterThan(0);
    expect(readings.length).toBeGreaterThanOrEqual(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loop.isBusy()).toBe(false);
    await harness.dispose();
  });

  it("重启恢复：装载旧账本后 restoreContext() 按最近请求的模型重算余量并广播（§4.11）", async () => {
    const sessionDir = path.join(root, "sess-restore");
    // 第一实例：跑一轮落下 request/header + step/end usage
    const first = createHarness()
      .use(sessionPlugin({ directory: sessionDir, cwd: root }))
      .use(toolsPlugin({}))
      .use(llmStub(mockLlm([[mockText("hi"), mockUsage(USAGE), mockFinish("stop")]]).service))
      .use(approvalStub())
      .use(interactionStub())
      .use(configStub())
      .use((await import("./service.js")).loopPlugin());
    await first.start();
    const firstCtx = asHeniraContext(first.context);
    firstCtx.get("tools").register(readTool);
    await collect(firstCtx.get("loop").run("种账本"));
    await first.dispose();

    // 第二实例（同目录 = 重启）：装载后没有活态读数
    const second = createHarness()
      .use(sessionPlugin({ directory: sessionDir, cwd: root }))
      .use(toolsPlugin({}))
      .use(llmStub(mockLlm([[mockText("x"), mockUsage(USAGE), mockFinish("stop")]]).service))
      .use(approvalStub())
      .use(interactionStub())
      .use(configStub())
      .use((await import("./service.js")).loopPlugin());
    await second.start();
    const ctx2 = asHeniraContext(second.context);
    ctx2.get("tools").register(readTool);
    const loop2 = ctx2.get("loop");
    expect(loop2.contextUsage()).toBeUndefined();
    const readings: ContextReading[] = [];
    ctx2.events.on("context/changed", (payload) => {
      readings.push((payload as { context: ContextReading }).context);
    });
    await loop2.restoreContext?.();
    const reading = loop2.contextUsage();
    expect(reading).toBeDefined();
    expect(reading?.estimated).toBe(false); // 账本有 usage → 锚点成立（不是整面估算）
    expect(reading?.size).toBe(128_000);
    // 锚点 input + 锚点步携带输出；锚后没有新消息
    expect(reading?.used).toBe(USAGE.inputTokens + USAGE.outputTokens);
    expect(readings).toHaveLength(1);
    // 已有活态读数不覆盖（热路径语义）
    const before = loop2.contextUsage()?.used;
    await loop2.restoreContext?.();
    expect(loop2.contextUsage()?.used).toBe(before);
    await second.dispose();
  });

  it("从未请求过的会话 restoreContext() 不建读数（余量入口保持空，不猜）", async () => {
    const { harness, loop } = await startedLoop([
      [mockText("x"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    expect(loop.contextUsage()).toBeUndefined();
    await loop.restoreContext?.();
    expect(loop.contextUsage()).toBeUndefined();
    await harness.dispose();
  });

  it("主请求按剩余窗口封顶：只在 0 < 剩余 < 基线时带 maxTokens（§4.3）", async () => {
    // 190K 字母 ≈ 95K token（字母 0.5/token）+ 系统/工具 → 剩余约 31K < 32K 基线
    const seenSmall: LlmRequest[] = [];
    const small = await startedLoop(
      [[mockText("ok"), mockUsage(USAGE), mockFinish("stop")]],
      undefined,
      undefined,
      seenSmall,
      undefined,
      128_000,
    );
    await collect(small.loop.run("短"));
    expect(seenSmall[0]?.maxTokens).toBeUndefined(); // 远离窗口不封顶
    await small.harness.dispose();

    const seenBig: LlmRequest[] = [];
    const big = await startedLoop(
      [[mockText("ok"), mockUsage(USAGE), mockFinish("stop")]],
      undefined,
      undefined,
      seenBig,
      undefined,
      128_000,
    );
    await collect(big.loop.run("a".repeat(190_000)));
    const cap = seenBig[0]?.maxTokens;
    expect(cap).toBeDefined();
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThan(32_000);
    await big.harness.dispose();
  });

  it("窗口未知（模型未声明）不封顶：剩余再小也不带 maxTokens（§4.3）", async () => {
    const seen: LlmRequest[] = [];
    const { harness, loop } = await startedLoop(
      [[mockText("ok"), mockUsage(USAGE), mockFinish("stop")]],
      undefined,
      undefined,
      seen,
    );
    await collect(loop.run("a".repeat(190_000))); // 同样的用量：已知窗口会封顶
    expect(seen[0]?.maxTokens).toBeUndefined();
    await harness.dispose();
  });

  it("loop/request-failed：监听器置 retry → 原步重发、不落 error 行、两条 request/header", async () => {
    let calls = 0;
    const seen: LlmRequest[] = [];
    const mock = mockLlm([[mockText("ok"), mockUsage(USAGE), mockFinish("stop")]]);
    const llm: LlmService = {
      async *stream(req, signal) {
        calls += 1;
        seen.push(req);
        if (calls === 1) throw new LlmError("CONTEXT_OVERFLOW", "overflow", 400);
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, loop, session } = await startedLoop(
      [],
      undefined,
      undefined,
      undefined,
      llm,
    );
    const attempts: number[] = [];
    ctx.events.onWaterfall("loop/request-failed", (value, next) => {
      attempts.push((value as { retries: number }).retries);
      return next({ ...(value as object), retry: true });
    });
    await collect(loop.run("重发一次"));
    expect(seen).toHaveLength(2);
    expect(attempts).toEqual([0]);
    expect(session.events().filter((event) => event.type === "request/header")).toHaveLength(2);
    expect(session.events().filter((event) => event.type === "error")).toHaveLength(0);
    expect(session.events().filter((event) => event.type === "assistant/message")).toHaveLength(1);
    await harness.dispose();
  });

  it("硬线：压缩后仍到硬线 → 拒绝发送（无 LLM 调用，fatal error CONTEXT_UNCOMPACTABLE）", async () => {
    const seen: LlmRequest[] = [];
    const { harness, loop, session } = await startedLoop([], undefined, undefined, seen);
    await collect(loop.run("a".repeat(300_000))); // ≈150K token > 127K 硬线
    expect(seen).toHaveLength(0);
    const error = session.events().find((event) => event.type === "error");
    expect(error?.data).toMatchObject({ code: "CONTEXT_UNCOMPACTABLE", fatal: true });
    await harness.dispose();
  });

  it("重试前硬线复检：request-failed 与重发之间表面涨回硬线上 → 同样拒绝（I-13）", async () => {
    const seen: LlmRequest[] = [];
    const mock = mockLlm([[mockText("ok"), mockUsage(USAGE), mockFinish("stop")]]);
    const llm: LlmService = {
      async *stream(req, signal) {
        seen.push(req);
        if (seen.length === 1) throw new LlmError("CONTEXT_OVERFLOW", "overflow", 400);
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, loop, session } = await startedLoop(
      [],
      undefined,
      undefined,
      undefined,
      llm,
    );
    ctx.events.onWaterfall("loop/request-failed", async (value, next) => {
      // 模拟两次尝试之间表面暴涨（如巨型插话/工具结果落账）越过硬线
      await ctx.get("session").append({
        type: "user/message",
        data: { turn: "t-surge", step: 0, content: "a".repeat(300_000), source: "send" },
      });
      return next({ ...(value as object), retry: true });
    });
    await collect(loop.run("重试遇硬线"));
    expect(seen).toHaveLength(1); // 第二次请求从未发出
    const error = session.events().find((event) => event.type === "error");
    expect(error?.data).toMatchObject({ code: "CONTEXT_UNCOMPACTABLE", fatal: true });
    await harness.dispose();
  });

  it("request-failed 重试后再派发：context 用重试前重算的新读数（不陈回首次）", async () => {
    const seen: LlmRequest[] = [];
    const mock = mockLlm([[mockText("never"), mockUsage(USAGE), mockFinish("stop")]]);
    let calls = 0;
    const llm: LlmService = {
      async *stream(req, signal) {
        calls += 1;
        seen.push(req);
        if (calls <= 2) throw new LlmError("CONTEXT_OVERFLOW", "overflow", 400); // 两次都溢出
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, loop } = await startedLoop([], undefined, undefined, undefined, llm);
    const readings: number[] = [];
    ctx.events.onWaterfall("loop/request-failed", async (value, next) => {
      const typed = value as { retries: number; context: { used: number } };
      readings.push(Math.round(typed.context.used));
      if (typed.retries === 0) {
        // 两次尝试之间表面变大：重试前实测读数应当跟着涨，不被陈回首次
        await ctx.get("session").append({
          type: "user/message",
          data: { turn: "t-grow", step: 0, content: "a".repeat(100_000), source: "send" },
        });
        return next({ ...(value as object), retry: true });
      }
      return next(value);
    });
    await collect(loop.run("两次溢出"));
    expect(seen).toHaveLength(2); // 重算后未到硬线，第二次真发出
    expect(readings).toHaveLength(2);
    expect(readings[1]).toBeGreaterThan(readings[0] + 40_000); // 100K 字母 ≈ 50K token
    await harness.dispose();
  });
});
