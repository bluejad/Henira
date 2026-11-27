// 压缩主体集成（compaction.md §6.2、§5 F-1/F-2 前置面）：压力触发 → 选区 → 同形摘要
// （系统提示 + 工具表随行）→ 原子替换 → compaction/* 事件 → 压缩行完成；账本原事件不动。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHarness, type ServiceDefinition } from "@henira/kernel";
import { mockFinish, mockLlm, mockText, mockToolCall, mockUsage } from "@henira/llm-mock";
import { loopPlugin } from "@henira/plugin-loop";
import { sessionPlugin } from "@henira/plugin-session";
import { toolsPlugin } from "@henira/plugin-tools";
import {
  asHeniraContext,
  COMPACTION_INSTRUCTIONS_MAX,
  type Decision,
  estimateMessages,
  LlmError,
  type LlmRequest,
  type LlmService,
  type ModelConfig,
  rebuildProjection,
  type SessionEvent,
  type ToolDefinition,
} from "@henira/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compactionPlugin } from "./index.js";
import { SUMMARY_MARKER } from "./prompt.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-compaction-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const USAGE = { inputTokens: 10, outputTokens: 5 };

function llmStub(service: LlmService): ServiceDefinition<LlmService> {
  return { name: "llm", start: () => service };
}
function approvalStub(): ServiceDefinition {
  return {
    name: "approval",
    start: () => ({
      requestPermission: async (): Promise<{ decision: Decision }> => ({
        decision: "allowed-once",
      }),
    }),
  };
}
function interactionStub(): ServiceDefinition {
  return {
    name: "interaction",
    start: () => ({
      ask: async () => ({ kind: "approval", requestId: "x", decision: "allowed-once" }),
      settle: () => false,
      listPending: () => [],
    }),
  };
}
function configStub(
  contextWindow = 128_000,
  models?: Record<string, ModelConfig>,
): ServiceDefinition {
  const fallback: ModelConfig = { provider: "mock", model: "mock-1", contextWindow };
  return {
    name: "config",
    start: () => ({
      cwd: root,
      // 关键：窗口在场（阈值按即将请求的模型算）；显式 id 走表，表里没有 = 不可解析
      model: (id?: string) => {
        if (id === undefined || models === undefined) return fallback;
        const hit = models[id];
        if (hit === undefined) throw new Error(`unknown model ${id}`);
        return hit;
      },
      credential: async () => "k",
      get: () => undefined,
      permissionRules: async () => [],
    }),
  };
}

const readTool: ToolDefinition = {
  name: "read",
  description: "read",
  inputSchema: { type: "object" },
  isConcurrencySafe: true,
  execute: async () => ({ content: "file body" }),
};

async function assemble(
  llm: LlmService,
  contextWindow = 128_000,
  models?: Record<string, ModelConfig>,
) {
  const harness = createHarness()
    .use(sessionPlugin({ directory: path.join(root, "sess"), cwd: root }))
    .use(toolsPlugin({}))
    .use(llmStub(llm))
    .use(approvalStub())
    .use(interactionStub())
    .use(configStub(contextWindow, models))
    .use(loopPlugin())
    .use(compactionPlugin());
  await harness.start();
  const ctx = asHeniraContext(harness.context);
  ctx.get("tools").register(readTool);
  return { harness, ctx, loop: ctx.get("loop"), session: ctx.get("session") };
}

/** 等队列冲刷链彻底收口（D-092：手动压缩是队列项，request() 返回时执行可能还没开始） */
async function waitSettled(
  loop: { isBusy(): boolean; pending(): unknown[] },
  timeout = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (loop.isBusy() || loop.pending().length > 0) {
    if (Date.now() > deadline) throw new Error("loop did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function started() {
  const seen: LlmRequest[] = [];
  const mock = mockLlm([
    // 摘要请求：正文必须远小于被遮蔽量（I-7）
    [
      mockText("compressed summary: goals, files, next steps"),
      mockUsage(USAGE),
      mockFinish("stop"),
    ],
    // 压缩后的主请求
    [mockText("done"), mockUsage(USAGE), mockFinish("stop")],
  ]);
  const llm: LlmService = {
    async *stream(req, signal) {
      seen.push(req);
      yield* mock.service.stream(req, signal);
    },
  };
  const assembled = await assemble(llm);
  return { ...assembled, seen };
}

async function collect(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of iterable) {
    // drain
  }
}

/** 预置 20 对旧历史（每条约 6K token）：总用量远超 128K 的压力线。
 *  offset：补历史时换一批 turn id——派生按 key 去重，同 id 的第二批会被丢掉 */
async function seedHistory(
  events: { append(input: { type: string; data: unknown }): Promise<SessionEvent> },
  count = 20,
  offset = 0,
) {
  for (let index = 0; index < count; index += 1) {
    const turn = `t-old-${offset + index}`;
    await events.append({
      type: "user/message",
      data: { turn, step: 0, content: "x".repeat(12_000), source: "send" },
    });
    await events.append({
      type: "assistant/message",
      data: {
        turn,
        step: 1,
        content: "y".repeat(12_000),
        model: "mock/mock-1",
        finishReason: "stop",
      },
    });
  }
}

describe("plugin-compaction 主体（compaction.md §4.4–§4.7）", () => {
  it("压力触发一次压缩：同形摘要 → 原子替换 → 压缩行 completed；原事件不删", async () => {
    const { harness, ctx, seen } = await started();
    const session = ctx.get("session");
    await seedHistory(session);
    const active: boolean[] = [];
    ctx.events.on("compaction/active", (payload) => {
      active.push((payload as { active: boolean }).active);
    });
    const before = session.events().length;

    for await (const _event of ctx.get("loop").run("继续")) {
      // drain
    }

    // 摘要请求先于主请求；同模型、同工具表、同会话头，末条是压缩指令
    expect(seen).toHaveLength(2);
    const summary = seen[0];
    const main = seen[1];
    expect(summary?.model).toEqual({ provider: "mock", model: "mock-1", contextWindow: 128_000 });
    expect(summary?.tools.map((tool) => tool.name)).toEqual(["read"]);
    expect(summary?.sessionId).toBe(session.header().id);
    expect(summary?.messages.at(-1)?.role).toBe("user");
    expect((summary?.messages.at(-1) as { content: string } | undefined)?.content).toContain(
      "Compress the conversation above",
    );
    expect(summary?.messages.some((message) => message.role === "system")).toBe(true);
    expect(summary?.maxTokens).toBeDefined();
    expect(summary?.maxTokens).toBeLessThanOrEqual(20_000);
    // I-14：摘要输入 + 摘要预算不超硬线
    expect(summary === undefined ? Infinity : estimateMessages(summary.messages)).toBeLessThan(
      127_000,
    );

    // 主请求拿到的是压缩后的表面：首条是替换摘要，旧历史只剩尾部保留段
    expect((main?.messages[0] as { content: string } | undefined)?.content).toContain(
      SUMMARY_MARKER,
    );
    expect(main?.messages.length).toBeLessThan(summary?.messages.length ?? 0);

    // 账本：起点 / 摘要 / 替换 / 终点；原事件一条不少（只追加）
    const types = session.events().map((event) => event.type);
    expect(types.filter((type) => type === "compaction/start")).toHaveLength(1);
    expect(types.filter((type) => type === "compaction/summary")).toHaveLength(1);
    expect(types.filter((type) => type === "compaction/end")).toHaveLength(1);
    expect(types.filter((type) => type === "error")).toHaveLength(0);
    const replace = session
      .events()
      .find(
        (event) =>
          event.type === "user/message" &&
          (event.data as { source?: string }).source === "compaction" &&
          (event.data as { surfaceOp?: unknown }).surfaceOp !== undefined,
      );
    expect(replace).toBeDefined();
    expect(session.events().length).toBeGreaterThan(before);
    // 旧事件仍在账本里（I-6）
    expect(
      session
        .events()
        .filter(
          (event) =>
            event.type === "user/message" &&
            (event.data as { content?: string }).content === "x".repeat(12_000),
        ),
    ).toHaveLength(20);

    // 投影：压缩行 completed + 摘要正文；替换记录不投影成用户气泡
    const projection = rebuildProjection(session.events());
    const row = projection.rows.find((candidate) => candidate.kind === "compaction");
    expect(row).toMatchObject({ kind: "compaction", state: "completed", trigger: "auto" });
    expect((row as { summary?: string }).summary).toContain("compressed summary");
    expect(
      projection.rows.filter(
        (candidate) => candidate.kind === "user" && candidate.rowId.startsWith("u:"),
      ).length,
    ).toBe(21); // 20 条旧用户消息 + 本次「继续」（替换记录不投影）

    // 活态：开始 true、结束 false
    expect(active).toEqual([true, false]);
    await harness.dispose();
  });

  it("溢出恢复：loop/request-failed 压缩后原步重发；原始溢出不留 error 行（F-1）", async () => {
    const seen: LlmRequest[] = [];
    const mock = mockLlm([
      [mockText("overflow summary"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("recovered"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    let first = true;
    const llm: LlmService = {
      async *stream(req, signal) {
        seen.push(req);
        if (first) {
          first = false;
          throw new LlmError("CONTEXT_OVERFLOW", "maximum context length exceeded", 400, {
            limit: 128_000,
            actual: 140_000,
          });
        }
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, session } = await assemble(llm);
    await seedHistory(session, 8); // 低于压力线：本次压缩只由溢出触发

    await collect(ctx.get("loop").run("继续"));

    expect(seen).toHaveLength(3); // 溢出主请求 → 摘要 → 重发
    expect(seen[1]?.messages.at(-1)?.role).toBe("user");
    expect((seen[1]?.messages.at(-1) as { content: string } | undefined)?.content).toContain(
      "Compress the conversation above",
    );
    expect((seen[2]?.messages[0] as { content: string } | undefined)?.content).toContain(
      SUMMARY_MARKER,
    );
    expect(session.events().filter((event) => event.type === "error")).toHaveLength(0);
    expect(session.events().filter((event) => event.type === "request/header")).toHaveLength(2); // 溢出原步 + 重发各一条
    const start = session.events().find((event) => event.type === "compaction/start");
    expect((start?.data as { cause?: { code: string } } | undefined)?.cause?.code).toBe(
      "CONTEXT_OVERFLOW",
    );
    const row = rebuildProjection(session.events()).rows.find(
      (candidate) => candidate.kind === "compaction",
    );
    expect(row).toMatchObject({ state: "completed" });
    await harness.dispose();
  });

  it("熔断 F-7：摘要连续失败 3 次 → 停自动压缩并广播；手动未接前不再尝试", async () => {
    let summaryCalls = 0;
    const mock = mockLlm(
      Array.from({ length: 4 }, () => [mockText("ok"), mockUsage(USAGE), mockFinish("stop")]),
    );
    const llm: LlmService = {
      async *stream(req, signal) {
        const last = req.messages.at(-1);
        if (
          last?.role === "user" &&
          typeof last.content === "string" &&
          last.content.includes("Compress the conversation above")
        ) {
          summaryCalls += 1;
          throw new Error("summary boom");
        }
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, session } = await assemble(llm);
    await seedHistory(session, 20);
    const breakerEvents: unknown[] = [];
    ctx.events.on("compaction/breaker", (payload) => breakerEvents.push(payload));

    for (let index = 0; index < 4; index += 1) {
      await collect(ctx.get("loop").run(`继续${index}`));
    }
    expect(summaryCalls).toBe(3); // 第 4 回合熔断后不再尝试
    expect(
      breakerEvents.some((event) => (event as { reason?: string }).reason === "failures"),
    ).toBe(true);
    expect(session.events().filter((event) => event.type === "compaction/end").length).toBe(3);
    await harness.dispose();
  });

  it("小窗口（<32K）不做模型摘要：直接无模型阶梯替换超长步单元", async () => {
    const seen: LlmRequest[] = [];
    const mock = mockLlm([[mockText("ok"), mockUsage(USAGE), mockFinish("stop")]]);
    const llm: LlmService = {
      async *stream(req, signal) {
        seen.push(req);
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, session } = await assemble(llm, 16_000);
    await session.append({
      type: "user/message",
      data: { turn: "t-big", step: 0, content: "run the big tool", source: "send" },
    });
    await session.append({
      type: "assistant/message",
      data: {
        turn: "t-big",
        step: 1,
        content: "calling",
        model: "mock/mock-1",
        finishReason: "tool-calls",
      },
    });
    await session.append({
      type: "tool/call",
      data: { turn: "t-big", step: 1, callId: "c-big", name: "read", arguments: '{"path":"big"}' },
    });
    await session.append({
      type: "tool/result",
      data: {
        turn: "t-big",
        step: 1,
        callId: "c-big",
        isError: false,
        content: "x".repeat(100_000),
        durationMs: 1,
      },
    });

    await collect(ctx.get("loop").run("继续"));

    expect(seen).toHaveLength(1); // 只有主请求：无摘要调用
    expect(
      seen[0]?.messages.some(
        (message) => message.role === "user" && message.content.includes("[compacted tool step]"),
      ),
    ).toBe(true);
    const replace = session
      .events()
      .find(
        (event) =>
          event.type === "user/message" &&
          (event.data as { source?: string }).source === "compaction-digest",
      );
    expect(replace).toBeDefined();
    const start = session.events().find((event) => event.type === "compaction/start");
    expect((start?.data as { digestUnits?: number } | undefined)?.digestUnits).toBe(1);
    const row = rebuildProjection(session.events()).rows.find(
      (candidate) => candidate.kind === "compaction",
    );
    expect(row).toMatchObject({ state: "completed", digestUnits: 1 });
    await harness.dispose();
  });

  it("手动压缩：闲时立即执行（维护回合），说明并入摘要指令", async () => {
    const seen: LlmRequest[] = [];
    const mock = mockLlm([[mockText("manual summary"), mockUsage(USAGE), mockFinish("stop")]]);
    const llm: LlmService = {
      async *stream(req, signal) {
        seen.push(req);
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, session, loop } = await assemble(llm);
    await seedHistory(session, 20);
    const skippedEvents: unknown[] = [];
    ctx.events.on("compaction/skipped", (payload) => skippedEvents.push(payload));
    const response = await ctx.get("compaction").request({ instructions: "keep the file list" });
    expect(response.state).toBe("accepted");
    await waitSettled(loop);
    expect(skippedEvents).toHaveLength(0); // 真跑了就不发「已跳过」回执
    expect(seen).toHaveLength(1);
    expect((seen[0]?.messages.at(-1) as { content: string } | undefined)?.content).toContain(
      "keep the file list",
    );
    const start = session.events().find((event) => event.type === "compaction/start");
    expect((start?.data as { trigger?: string } | undefined)?.trigger).toBe("manual");
    expect((start?.data as { turn?: string } | undefined)?.turn).toMatch(/^m-/);
    const row = rebuildProjection(session.events()).rows.find(
      (candidate) => candidate.kind === "compaction",
    );
    expect(row).toMatchObject({ state: "completed", trigger: "manual" });
    await harness.dispose();
  });

  it("手动压缩：历史不足 → skipped；说明超限 → rejected", async () => {
    const mock = mockLlm([]);
    const { harness, ctx, loop } = await assemble(mock.service);
    const skippedEvents: unknown[] = [];
    ctx.events.on("compaction/skipped", (payload) => skippedEvents.push(payload));
    // D-092：受理 = 入队；历史不足在消费时跳过（不落压缩行）——结果经活态告诉界面
    expect((await ctx.get("compaction").request()).state).toBe("accepted");
    await waitSettled(loop);
    expect(
      ctx
        .get("session")
        .events()
        .filter((event) => event.type === "compaction/start"),
    ).toHaveLength(0);
    expect(skippedEvents).toEqual([
      expect.objectContaining({ reason: "history-insufficient", id: expect.any(String) }),
    ]);
    const tooLong = await ctx.get("compaction").request({
      instructions: "x".repeat(COMPACTION_INSTRUCTIONS_MAX + 1),
    });
    expect(tooLong).toMatchObject({ state: "rejected", reason: "instructions-too-long" });
    await harness.dispose();
  });

  it("手动压缩：在途重复请求被拒；停止 → interrupted 收口", async () => {
    let summaryStarted!: () => void;
    const entered = new Promise<void>((resolve) => {
      summaryStarted = resolve;
    });
    const llm: LlmService = {
      async *stream(_req, signal) {
        summaryStarted();
        await new Promise<void>((done) => {
          if (signal.aborted) done();
          else signal.addEventListener("abort", () => done(), { once: true });
        });
        if (signal.aborted) throw new LlmError("ABORTED", "stopped");
        yield { type: "text-delta", text: "late summary" };
        yield { type: "finish", reason: "stop" };
      },
    };
    const { harness, ctx, session, loop } = await assemble(llm);
    await seedHistory(session, 20);
    const service = ctx.get("compaction");
    void service.request();
    await entered;
    expect((await service.request()).state).toBe("rejected"); // 在途重复
    ctx.events.emit("compaction/stop", {});
    await waitSettled(loop);
    const end = session.events().find((event) => event.type === "compaction/end");
    expect((end?.data as { state?: string } | undefined)?.state).toBe("interrupted");
    expect(session.events().filter((event) => event.type === "error")).toHaveLength(0);
    await harness.dispose();
  });

  it("手动压缩起步窗：受理中的第二个请求即拒，停止仍能中断真正在跑的压缩", async () => {
    let summaryStarted!: () => void;
    const entered = new Promise<void>((resolve) => {
      summaryStarted = resolve;
    });
    const llm: LlmService = {
      async *stream(_req, signal) {
        summaryStarted();
        await new Promise<void>((done) => {
          if (signal.aborted) done();
          else signal.addEventListener("abort", () => done(), { once: true });
        });
        if (signal.aborted) throw new LlmError("ABORTED", "stopped");
        yield { type: "text-delta", text: "late summary" };
        yield { type: "finish", reason: "stop" };
      },
    };
    const { harness, ctx, session, loop } = await assemble(llm);
    await seedHistory(session, 20);
    const service = ctx.get("compaction");
    // 第一次请求停在入队落盘（admissionPending）：第二个请求在受理窗内即拒
    void service.request();
    expect(await service.request()).toMatchObject({
      state: "rejected",
      reason: "compaction-in-progress",
    });
    await entered;
    ctx.events.emit("compaction/stop", {});
    await waitSettled(loop);
    const end = session.events().find((event) => event.type === "compaction/end");
    expect((end?.data as { state?: string } | undefined)?.state).toBe("interrupted");
    await harness.dispose();
  });

  it("手动压缩：忙时排队 → 回合结束后执行；成功清熔断（F-7 解除）", async () => {
    let summaryCalls = 0;
    const seen: LlmRequest[] = [];
    // usage 归零 = 永不建锚点：每步都按整面估算（否则第二轮 used 塌回增量，压力线不再触发）
    const noUsage = { inputTokens: 0, outputTokens: 0 };
    const mock = mockLlm([
      [mockText("ok"), mockUsage(noUsage), mockFinish("stop")],
      [mockText("ok"), mockUsage(noUsage), mockFinish("stop")],
      [mockText("ok"), mockUsage(noUsage), mockFinish("stop")],
      [mockToolCall("c-slow", "slow", "{}"), mockUsage(noUsage), mockFinish("stop")],
      [mockText("after slow tool"), mockUsage(noUsage), mockFinish("stop")],
      [
        mockText("queued summary: the slow tool call finished"),
        mockUsage(noUsage),
        mockFinish("stop"),
      ],
    ]);
    const llm: LlmService = {
      async *stream(req, signal) {
        seen.push(req);
        const last = req.messages.at(-1);
        const isSummary =
          last?.role === "user" &&
          typeof last.content === "string" &&
          last.content.includes("Compress the conversation above");
        if (isSummary) {
          summaryCalls += 1;
          if (summaryCalls <= 3) throw new Error("summary boom"); // 前三次摘要必败
        }
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, loop, session } = await assemble(llm);
    let toolEntered!: () => void;
    const toolIn = new Promise<void>((resolve) => {
      toolEntered = resolve;
    });
    ctx.get("tools").register({
      name: "slow",
      description: "slow",
      inputSchema: { type: "object" },
      isConcurrencySafe: true,
      execute: async () => {
        toolEntered(); // 步 1 工具执行中 = 步 1 pre-step 已过、步 2 pre-step 未到
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { content: "slow body" };
      },
    });
    await seedHistory(session, 10); // ≈120K：压力线上、硬线下（主请求照发）
    const breakerEvents: { reason?: string | null }[] = [];
    ctx.events.on("compaction/breaker", (payload) =>
      breakerEvents.push(payload as { reason?: string | null }),
    );

    // 前三轮：摘要各败一次 → 第 3 次触发熔断
    for (let index = 0; index < 3; index += 1) {
      await collect(loop.run(`预热${index}`));
    }
    const failureAt = breakerEvents.findIndex((event) => event.reason === "failures");
    expect(failureAt).toBeGreaterThanOrEqual(0);

    // 第 4 回合：忙时投手动 → 队尾排队；回合结束后按 FIFO 执行，成功清熔断
    const turn4 = collect(loop.run("第四轮"));
    await toolIn; // 钉在步 1 工具执行窗口内投递——严格排在回合之后（不再在步 2 插队）
    const response = await ctx.get("compaction").request({ instructions: "keep slow tool facts" });
    expect(response.state).toBe("queued");
    await turn4;
    await waitSettled(loop);

    expect(summaryCalls).toBe(4); // 3 败 + 排队手动 1 成
    const clearAt = breakerEvents.findIndex((event) => event.reason === null);
    expect(clearAt).toBeGreaterThan(failureAt); // 手动成功解除熔断
    const starts = session.events().filter((event) => event.type === "compaction/start");
    const manualStart = starts.find(
      (event) => (event.data as { trigger?: string }).trigger === "manual",
    );
    const manualId = (manualStart?.data as { id?: string } | undefined)?.id;
    expect(manualId).toBeDefined();
    const end = session
      .events()
      .find(
        (event) =>
          event.type === "compaction/end" && (event.data as { id?: string }).id === manualId,
      );
    expect((end?.data as { state?: string } | undefined)?.state).toBe("completed");
    const summaryRequest = seen.find((req) => {
      const last = req.messages.at(-1);
      return (
        last?.role === "user" &&
        typeof last.content === "string" &&
        last.content.includes("keep slow tool facts")
      );
    });
    expect(summaryRequest).toBeDefined();
    expect(session.deriveMessages()[0]?.content ?? "").toContain(
      "queued summary: the slow tool call finished",
    );
    await harness.dispose();
  });

  it("停止不撤销排队中的手动压缩：回合中断后条目保留并冻结，resume 恢复执行", async () => {
    const noUsage = { inputTokens: 0, outputTokens: 0 };
    let toolEntered!: () => void;
    const toolIn = new Promise<void>((resolve) => {
      toolEntered = resolve;
    });
    let releaseTool!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const mock = mockLlm([
      [mockToolCall("c-slow", "slow", "{}"), mockUsage(noUsage), mockFinish("stop")],
      [mockText("after slow tool"), mockUsage(noUsage), mockFinish("stop")],
      [mockText("resumed summary"), mockUsage(noUsage), mockFinish("stop")],
    ]);
    const { harness, ctx, loop, session } = await assemble(mock.service);
    ctx.get("tools").register({
      name: "slow",
      description: "slow",
      inputSchema: { type: "object" },
      isConcurrencySafe: true,
      execute: async () => {
        toolEntered();
        await gate;
        return { content: "slow body" };
      },
    });
    await seedHistory(session, 8); // 低于压力线：回合本身不触发自动压缩
    const turn = collect(loop.run("排队后停止"));
    await toolIn;
    expect((await ctx.get("compaction").request({ instructions: "keep stranded" })).state).toBe(
      "queued",
    );
    // 停止 = 中断当前回合（compaction/stop 一并广播，但没有在途压缩可中断）
    await loop.interrupt();
    releaseTool();
    await turn;
    // 队列语义：压缩条目是用户意图，停止不撤销——保留并冻结，等显式恢复
    expect(loop.paused()).toBe(true);
    expect(loop.pending().map((entry) => entry.kind)).toEqual(["compact"]);
    expect(session.events().filter((event) => event.type === "compaction/start")).toHaveLength(0);

    expect(await loop.resume()).toBe(true);
    await waitSettled(loop);
    const manual = session
      .events()
      .find(
        (event) =>
          event.type === "compaction/start" &&
          (event.data as { trigger?: string }).trigger === "manual",
      );
    expect(manual).toBeDefined();
    await harness.dispose();
  });

  it("排队的手动压缩同样走小窗口分支：<32K 不发模型摘要（§4.6/§4.10）", async () => {
    const noUsage = { inputTokens: 0, outputTokens: 0 };
    let toolEntered!: () => void;
    const toolIn = new Promise<void>((resolve) => {
      toolEntered = resolve;
    });
    const mock = mockLlm([
      [mockToolCall("c-slow", "slow", "{}"), mockUsage(noUsage), mockFinish("stop")],
      [mockText("after slow tool"), mockUsage(noUsage), mockFinish("stop")],
    ]);
    const seen: LlmRequest[] = [];
    const llm: LlmService = {
      async *stream(req, signal) {
        seen.push(req);
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, loop, session } = await assemble(llm, 16_000);
    ctx.get("tools").register({
      name: "slow",
      description: "slow",
      inputSchema: { type: "object" },
      isConcurrencySafe: true,
      execute: async () => {
        toolEntered();
        return { content: "slow body" };
      },
    });
    await seedHistory(session, 1); // ≈12K：16K 窗口的压力线上、硬线下
    const turn = collect(loop.run("小窗口排队"));
    await toolIn;
    expect((await ctx.get("compaction").request({})).state).toBe("queued");
    await turn;
    // 旧行为：排队分支总走模型摘要 → 落一条 compaction/start 再 SUMMARY_TOO_LARGE
    expect(session.events().filter((event) => event.type === "compaction/start")).toHaveLength(0);
    expect(
      seen.some((req) => {
        const last = req.messages.at(-1);
        return (
          last?.role === "user" &&
          typeof last.content === "string" &&
          last.content.includes("Compress the conversation above")
        );
      }),
    ).toBe(false);
    await harness.dispose();
  });

  it("回合中请求的压缩在回合结束后自动执行（无需第二次点击）", async () => {
    const noUsage = { inputTokens: 0, outputTokens: 0 };
    let mainEntered!: () => void;
    const mainIn = new Promise<void>((resolve) => {
      mainEntered = resolve;
    });
    let releaseMain!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseMain = resolve;
    });
    const seen: LlmRequest[] = [];
    const mock = mockLlm([
      [mockText("turn reply"), mockUsage(noUsage), mockFinish("stop")],
      [mockText("queued summary"), mockUsage(noUsage), mockFinish("stop")],
    ]);
    const llm: LlmService = {
      async *stream(req, signal) {
        seen.push(req);
        mainEntered();
        await gate;
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, loop, session } = await assemble(llm);
    await seedHistory(session, 8);
    const turn = collect(loop.run("单步回合"));
    await mainIn;
    expect((await ctx.get("compaction").request({ instructions: "keep stranded" })).state).toBe(
      "queued",
    );
    releaseMain();
    await turn;
    await waitSettled(loop);
    const summary = seen.find((req) => {
      const last = req.messages.at(-1);
      return (
        last?.role === "user" &&
        typeof last.content === "string" &&
        last.content.includes("Compress the conversation above")
      );
    });
    expect(summary).toBeDefined();
    expect((summary?.messages.at(-1) as { content?: string } | undefined)?.content).toContain(
      "keep stranded",
    );
    await harness.dispose();
  });

  it("闲时手动压缩的模型口径：跟随最近一次请求；已不可解析才回落默认", async () => {
    const seen: LlmRequest[] = [];
    const mock = mockLlm([
      [mockText("alt summary"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("default summary"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const llm: LlmService = {
      async *stream(req, signal) {
        seen.push(req);
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, session, loop } = await assemble(llm, 128_000, {
      "alt/alt-1": { provider: "alt", model: "alt-1", contextWindow: 128_000 },
    });
    await seedHistory(session, 20);
    const header = (model: string) => ({
      type: "request/header" as const,
      data: { turn: "t-model", step: 1, model, params: {}, toolNames: [], systemPromptHash: "x" },
    });

    await session.append(header("alt/alt-1"));
    expect((await ctx.get("compaction").request()).state).toBe("accepted");
    await waitSettled(loop);
    expect(seen[0]?.model).toMatchObject({ provider: "alt", model: "alt-1" });
    const summaryEvent = session.events().find((event) => event.type === "compaction/summary");
    expect((summaryEvent?.data as { model?: string } | undefined)?.model).toBe("alt/alt-1");

    await seedHistory(session, 20, 20); // 第一次压缩后头部已被遮蔽：补历史再压一次（换 turn id）
    await session.append(header("gone/gone-1")); // 表里没有 = 不可解析 → 回落全局默认
    expect((await ctx.get("compaction").request()).state).toBe("accepted");
    await waitSettled(loop);
    expect(seen[1]?.model).toMatchObject({ provider: "mock", model: "mock-1" });
    await harness.dispose();
  });

  it("无模型摘要之后仍能做模型摘要（P1：digest 区间不进前推/滚动记账）", async () => {
    const seen: LlmRequest[] = [];
    const mock = mockLlm([
      [mockText("summary after digest"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("reply"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const llm: LlmService = {
      async *stream(req, signal) {
        seen.push(req);
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, session } = await assemble(llm);
    await seedHistory(session, 10); // ≈120K：压力线上、硬线下
    const last = session
      .events()
      .filter((event) => event.type === "assistant/message")
      .at(-1);
    expect(last).toBeDefined();
    // 模拟溢出恢复路径的无模型摘要：替换最新一对（§4.9 允许摘最新一步）
    await session.append({
      type: "user/message",
      data: {
        turn: "t-dig",
        step: 0,
        content: "[compacted tool step] keep going",
        source: "compaction-digest",
        surfaceOp: { op: "replace", startSeq: (last?.seq ?? 0) - 1, endSeq: last?.seq ?? 0 },
      },
    });

    await collect(ctx.get("loop").run("继续"));
    const summary = session.events().find((event) => event.type === "compaction/summary");
    expect(summary).toBeDefined(); // 无修复时选区被「只向前」挡死，直接判 skipped
    const end = session
      .events()
      .find(
        (event) =>
          event.type === "compaction/end" &&
          (event.data as { state?: string }).state === "completed",
      );
    expect(end).toBeDefined();
    await harness.dispose();
  });

  it("自动压缩被停止：end{interrupted}、不计失败、不进阶梯（F-7）", async () => {
    const llm: LlmService = {
      async *stream(_req, signal) {
        await new Promise<void>((done) => {
          if (signal.aborted) done();
          else signal.addEventListener("abort", () => done(), { once: true });
        });
        throw new LlmError("ABORTED", "stopped");
      },
    };
    const { harness, ctx, session } = await assemble(llm);
    await seedHistory(session, 10);
    const breaker: (string | null)[] = [];
    ctx.events.on("compaction/breaker", (payload) =>
      breaker.push((payload as { reason?: string | null }).reason ?? null),
    );
    const waitFor = async (predicate: () => boolean): Promise<void> => {
      for (let index = 0; index < 400; index += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("timeout waiting for compaction");
    };
    for (let index = 0; index < 3; index += 1) {
      const controller = new AbortController();
      const turn = collect(ctx.get("loop").run(`停止${index}`, controller.signal));
      await waitFor(
        () =>
          session.events().filter((event) => event.type === "compaction/start").length ===
          index + 1,
      );
      controller.abort();
      await turn;
    }
    const ends = session.events().filter((event) => event.type === "compaction/end");
    expect(ends).toHaveLength(3);
    expect(ends.every((event) => (event.data as { state?: string }).state === "interrupted")).toBe(
      true,
    );
    expect(session.events().filter((event) => event.type === "compaction/summary")).toHaveLength(0);
    expect(session.events().filter((event) => event.type === "error")).toHaveLength(0);
    expect(breaker).not.toContain("failures"); // 三次中断不熔断
    await harness.dispose();
  });

  it("F-8 快速回填：成功后一步内又触发，连续第 3 次 → 熔断（成功不重置连续计数）", async () => {
    const noUsage = { inputTokens: 0, outputTokens: 0 };
    const mock = mockLlm(
      Array.from({ length: 4 }, () => [mockText("ok"), mockUsage(noUsage), mockFinish("stop")]),
    );
    const { harness, ctx, session } = await assemble(mock.service, 16_000);
    const breaker: (string | null)[] = [];
    ctx.events.on("compaction/breaker", (payload) =>
      breaker.push((payload as { reason?: string | null }).reason ?? null),
    );
    for (let index = 0; index < 4; index += 1) {
      const turn = `t-big-${index}`;
      await session.append({
        type: "user/message",
        data: { turn, step: 0, content: "run the tool", source: "send" },
      });
      await session.append({
        type: "assistant/message",
        data: {
          turn,
          step: 1,
          content: "calling",
          model: "mock/mock-1",
          finishReason: "tool-calls",
        },
      });
      await session.append({
        type: "tool/call",
        data: { turn, step: 1, callId: `c-${index}`, name: "read", arguments: "{}" },
      });
      await session.append({
        type: "tool/result",
        data: {
          turn,
          step: 1,
          callId: `c-${index}`,
          isError: false,
          content: "x".repeat(100_000),
          durationMs: 1,
        },
      });
      await collect(ctx.get("loop").run(`继续${index}`));
    }
    expect(breaker).toContain("refill");
    const completed = session
      .events()
      .filter(
        (event) =>
          event.type === "compaction/end" &&
          (event.data as { state?: string }).state === "completed",
      );
    expect(completed).toHaveLength(3); // 第三次快速回填成功，第四次被熔断挡住
    await harness.dispose();
  });

  it("手动压缩在 <32K 窗口走无模型阶梯：不发必败的摘要请求（§4.6）", async () => {
    const seen: LlmRequest[] = [];
    const mock = mockLlm([[mockText("never"), mockUsage(USAGE), mockFinish("stop")]]);
    const llm: LlmService = {
      async *stream(req, signal) {
        seen.push(req);
        yield* mock.service.stream(req, signal);
      },
    };
    const { harness, ctx, session, loop } = await assemble(llm, 16_000);
    await session.append({
      type: "user/message",
      data: { turn: "t-big", step: 0, content: "run the big tool", source: "send" },
    });
    await session.append({
      type: "assistant/message",
      data: {
        turn: "t-big",
        step: 1,
        content: "calling",
        model: "mock/mock-1",
        finishReason: "tool-calls",
      },
    });
    await session.append({
      type: "tool/call",
      data: { turn: "t-big", step: 1, callId: "c-big", name: "read", arguments: "{}" },
    });
    await session.append({
      type: "tool/result",
      data: {
        turn: "t-big",
        step: 1,
        callId: "c-big",
        isError: false,
        content: "x".repeat(100_000),
        durationMs: 1,
      },
    });
    const response = await ctx.get("compaction").request();
    expect(response.state).toBe("accepted");
    await waitSettled(loop);
    expect(seen).toHaveLength(0); // 没有摘要请求
    const start = session.events().find((event) => event.type === "compaction/start");
    expect(start?.data).toMatchObject({ trigger: "manual", digestUnits: 1 });
    await harness.dispose();
  });

  it("第二次溢出只走无模型阶梯：模型摘要最多一次（§16）", async () => {
    let summaryCalls = 0;
    const llm: LlmService = {
      async *stream(req) {
        const last = req.messages.at(-1);
        if (
          last?.role === "user" &&
          typeof last.content === "string" &&
          last.content.includes("Compress the conversation above")
        ) {
          summaryCalls += 1;
          yield { type: "text-delta", text: "brief summary" };
          yield { type: "finish", reason: "stop" };
          return;
        }
        throw new LlmError("CONTEXT_OVERFLOW", "maximum context length exceeded", 400);
      },
    };
    const { harness, ctx, session } = await assemble(llm);
    await seedHistory(session, 8); // 低于压力线：只有溢出路径
    await collect(ctx.get("loop").run("继续"));
    expect(summaryCalls).toBe(1);
    const error = session.events().find((event) => event.type === "error");
    expect((error?.data as { code?: string } | undefined)?.code).toBe("CONTEXT_OVERFLOW");
    await harness.dispose();
  });
});
