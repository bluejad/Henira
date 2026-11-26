// 压缩主体集成（compaction.md §6.2、§5 F-1/F-2 前置面）：压力触发 → 选区 → 同形摘要
// （系统提示 + 工具表随行）→ 原子替换 → compaction/* 事件 → 压缩行完成；账本原事件不动。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHarness, type ServiceDefinition } from "@henira/kernel";
import { mockFinish, mockLlm, mockText, mockUsage } from "@henira/llm-mock";
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
  rebuildProjection,
  type SessionEvent,
  type ToolDefinition,
} from "@henira/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compactionPlugin } from "./index.js";

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
function configStub(contextWindow = 128_000): ServiceDefinition {
  return {
    name: "config",
    start: () => ({
      cwd: root,
      // 关键：窗口在场（阈值按即将请求的模型算）
      model: () => ({ provider: "mock", model: "mock-1", contextWindow }),
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

async function assemble(llm: LlmService, contextWindow = 128_000) {
  const harness = createHarness()
    .use(sessionPlugin({ directory: path.join(root, "sess"), cwd: root }))
    .use(toolsPlugin({}))
    .use(llmStub(llm))
    .use(approvalStub())
    .use(interactionStub())
    .use(configStub(contextWindow))
    .use(loopPlugin())
    .use(compactionPlugin());
  await harness.start();
  const ctx = asHeniraContext(harness.context);
  ctx.get("tools").register(readTool);
  return { harness, ctx, loop: ctx.get("loop"), session: ctx.get("session") };
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

/** 预置 20 对旧历史（每条约 6K token）：总用量远超 128K 的压力线 */
async function seedHistory(
  events: { append(input: { type: string; data: unknown }): Promise<SessionEvent> },
  count = 20,
) {
  for (let index = 0; index < count; index += 1) {
    await events.append({
      type: "user/message",
      data: { turn: `t-old-${index}`, step: 0, content: "x".repeat(12_000), source: "send" },
    });
    await events.append({
      type: "assistant/message",
      data: {
        turn: `t-old-${index}`,
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
      "summary of the earlier conversation",
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
      "summary of the earlier conversation",
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
    const { harness, ctx, session } = await assemble(llm);
    await seedHistory(session, 20);
    const response = await ctx.get("compaction").request({ instructions: "keep the file list" });
    expect(response.state).toBe("accepted");
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
    const { harness, ctx } = await assemble(mock.service);
    expect((await ctx.get("compaction").request()).state).toBe("skipped");
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
    const { harness, ctx, session } = await assemble(llm);
    await seedHistory(session, 20);
    const service = ctx.get("compaction");
    const first = service.request();
    await entered;
    expect((await service.request()).state).toBe("rejected"); // 在途重复
    ctx.events.emit("compaction/stop", {});
    expect((await first).state).toBe("rejected");
    const end = session.events().find((event) => event.type === "compaction/end");
    expect((end?.data as { state?: string } | undefined)?.state).toBe("interrupted");
    expect(session.events().filter((event) => event.type === "error")).toHaveLength(0);
    await harness.dispose();
  });
});
