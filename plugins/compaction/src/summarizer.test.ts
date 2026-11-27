// 摘要请求单测（compaction.md §4.6、§5 I-4 / I-7 / F-4 / F-9）：同形请求、装不下先裁尾部、
// 工具调用/截断/空正文/摘要不小于被遮蔽量都不算成功。

import {
  contextBudget,
  estimateMessages,
  estimateText,
  LlmError,
  type LlmRequest,
  type LlmService,
  type ModelMessage,
  type StreamEvent,
} from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { requestSummary } from "./summarizer.js";

const budget = contextBudget({ contextWindow: 128_000 });

function scripted(script: StreamEvent[]): { service: LlmService; seen: LlmRequest[] } {
  const seen: LlmRequest[] = [];
  return {
    seen,
    service: {
      async *stream(req) {
        seen.push(req);
        for (const event of script) yield event;
      },
    },
  };
}

const baseInput = {
  model: { provider: "p", model: "m" },
  tools: [{ name: "read", description: "read", inputSchema: { type: "object" } }],
  sessionId: "s-1",
  instruction: "summarize",
  hardLimit: budget.hardLimit,
  summaryOut: budget.summaryOut,
  maskedTokens: 50_000,
  signal: new AbortController().signal,
};

describe("requestSummary（compaction.md §4.6）", () => {
  it("同形请求：同模型/工具表/会话头，末尾追加一条用户指令；maxTokens 受预算约束", async () => {
    const { service, seen } = scripted([
      { type: "usage", usage: { inputTokens: 120, outputTokens: 30 } },
      { type: "text-delta", text: "decisions, files, next steps" },
      { type: "finish", reason: "stop" },
    ]);
    const messages = [{ role: "user" as const, content: "earlier history" }];
    const result = await requestSummary({ ...baseInput, llm: service, messages });
    expect(result.ok).toBe(true);
    expect(seen[0]?.model).toEqual(baseInput.model);
    expect(seen[0]?.tools).toEqual(baseInput.tools);
    expect(seen[0]?.sessionId).toBe("s-1");
    expect(seen[0]?.messages.at(-1)).toEqual({ role: "user", content: "summarize" });
    expect(seen[0]?.maxTokens).toBe(20_000); // min(20K, hardLimit − 输入估算)
  });

  it("观测输出上限进 maxTokens（outputBase = min(声明, 观测)，R216 §4.6）", async () => {
    const { service, seen } = scripted([
      { type: "usage", usage: { inputTokens: 120, outputTokens: 30 } },
      { type: "text-delta", text: "summary" },
      { type: "finish", reason: "stop" },
    ]);
    const messages = [{ role: "user" as const, content: "earlier history" }];
    // 模型声明 64K、meter 学到观测输出 6K → maxTokens 取 6K（不顶到端点真实输出上限）
    const result = await requestSummary({
      ...baseInput,
      llm: service,
      messages,
      outputBase: 6_000,
      model: { provider: "p", model: "m", maxOutputTokens: 64_000 },
    });
    expect(result.ok).toBe(true);
    expect(seen[0]?.maxTokens).toBe(6_000);
  });

  it("装不下先裁转写尾部（第 1 档），不发送必败请求（I-14）", async () => {
    const { service, seen } = scripted([
      { type: "text-delta", text: "short summary" },
      { type: "finish", reason: "stop" },
    ]);
    const messages = Array.from({ length: 40 }, (_, index) => ({
      role: "user" as const,
      content: `message-${index}-${"x".repeat(12_000)}`,
    }));
    const result = await requestSummary({ ...baseInput, llm: service, messages });
    expect(result.ok).toBe(true);
    const sent = seen[0]?.messages.slice(0, -1) ?? [];
    expect(sent.length).toBeLessThan(messages.length);
    expect(
      estimateMessages(sent) + estimateText(baseInput.instruction) + budget.summaryOut,
    ).toBeLessThanOrEqual(budget.hardLimit);
  });

  it("端点自报溢出：按 actual/limit 重算预算、裁掉更老的转写后重发一次（§4.6）", async () => {
    const calls: LlmRequest[] = [];
    let attempt = 0;
    const service: LlmService = {
      async *stream(req) {
        calls.push(req);
        attempt += 1;
        if (attempt === 1) {
          throw new LlmError(
            "CONTEXT_OVERFLOW",
            "This model's maximum context length is 40000 tokens. However, you requested 100000 tokens",
            400,
            { limit: 40_000, actual: 100_000 },
          );
        }
        yield { type: "text-delta", text: "short summary" };
        yield { type: "finish", reason: "stop" };
      },
    };
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: "user" as const,
      content: `m${index}-${"x".repeat(10_000)}`,
    }));
    const result = await requestSummary({
      ...baseInput,
      llm: service,
      messages,
      hardLimit: 40_000,
      summaryOut: 1_000,
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    // 第二次：转写被裁短、输出预算也压低（端点口径 count 与实际差 2.5 倍）
    expect(calls[1]?.messages.length).toBeLessThan(calls[0]?.messages.length ?? 0);
    expect(calls[1]?.maxTokens).toBeLessThan(calls[0]?.maxTokens ?? 0);
    // 裁的是尾部：重发的转写仍是原转写的前缀（指令在各自末尾，不参与比较）
    const retryTranscript = calls[1]?.messages.slice(0, -1) ?? [];
    expect(retryTranscript).toEqual(calls[0]?.messages.slice(0, retryTranscript.length));
    expect(calls[1]?.messages.at(-1)).toEqual(calls[0]?.messages.at(-1));
  });

  it("摘要期工具调用 → 失败（F-9）", async () => {
    const { service } = scripted([
      { type: "tool-call", callId: "c1", name: "read", argsText: "{}" },
      { type: "text-delta", text: "summary" },
      { type: "finish", reason: "stop" },
    ]);
    const result = await requestSummary({
      ...baseInput,
      llm: service,
      messages: [{ role: "user", content: "history" }],
    });
    expect(result).toMatchObject({ ok: false, code: "SUMMARY_TOOL_CALL" });
  });

  it("length 结束 / 空正文 → 失败（F-4）", async () => {
    for (const script of [
      [
        { type: "text-delta" as const, text: "cut" },
        { type: "finish" as const, reason: "length" as const },
      ],
      [{ type: "finish" as const, reason: "stop" as const }],
    ]) {
      const { service } = scripted(script);
      const result = await requestSummary({
        ...baseInput,
        llm: service,
        messages: [{ role: "user", content: "history" }],
      });
      expect(result.ok).toBe(false);
    }
  });

  it("摘要不小于被遮蔽量 → 不写替换（I-7）", async () => {
    const { service } = scripted([
      { type: "text-delta", text: "z".repeat(120_000) },
      { type: "finish", reason: "stop" },
    ]);
    const result = await requestSummary({
      ...baseInput,
      llm: service,
      messages: [{ role: "user", content: "history" }],
    });
    expect(result).toMatchObject({ ok: false, code: "SUMMARY_NOT_SMALLER" });
  });

  it("第 3 档降档丢掉头部轮次时，指令里明确告知未纳入（不宣称覆盖全部）", async () => {
    const { service, seen } = scripted([
      { type: "text-delta", text: "short summary" },
      { type: "finish", reason: "stop" },
    ]);
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: "user" as const,
      content: `m${index}-${"x".repeat(8_000)}`,
    }));
    const result = await requestSummary({
      ...baseInput,
      llm: service,
      messages,
      hardLimit: 25_000,
      summaryOut: 1_000,
      trimLimit: 0, // 尾部不裁：强制走第 3 档
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.omittedTurns).toBeGreaterThan(0);
    expect((seen[0]?.messages.at(-1) as { content: string } | undefined)?.content).toContain(
      "were not included in this transcript",
    );
  });

  it("中止 → interrupted（不算失败，不落错误行）", async () => {
    const controller = new AbortController();
    const { service } = scripted([{ type: "finish", reason: "stop" }]);
    controller.abort();
    const result = await requestSummary({
      ...baseInput,
      llm: service,
      messages: [{ role: "user", content: "history" }],
      signal: controller.signal,
    });
    expect(result).toMatchObject({ ok: false, interrupted: true });
  });

  it("第 1 档按单元裁尾：不会留下没有结果的 toolCalls（悬空调用端点必 400）", async () => {
    const { service, seen } = scripted([
      { type: "text-delta", text: "short summary" },
      { type: "finish", reason: "stop" },
    ]);
    const messages: ModelMessage[] = [
      { role: "user", content: `head ${"h".repeat(4_000)}` },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ callId: "c1", name: "read", arguments: "{}" }],
      },
      { role: "tool", callId: "c1", name: "read", content: "t".repeat(30_000), isError: false },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ callId: "c2", name: "read", arguments: "{}" }],
      },
      { role: "tool", callId: "c2", name: "read", content: "t".repeat(30_000), isError: false },
    ];
    const result = await requestSummary({
      ...baseInput,
      llm: service,
      messages,
      hardLimit: 10_000,
      summaryOut: 1_000,
      trimLimit: 4,
    });
    expect(result.ok).toBe(true);
    const sent = seen[0]?.messages.slice(0, -1) ?? [];
    const called = new Set<string>();
    for (const message of sent) {
      if (message.role === "assistant" && message.toolCalls !== undefined) {
        for (const call of message.toolCalls) called.add(call.callId);
      }
    }
    const answered = new Set(
      sent.filter((message) => message.role === "tool").map((message) => message.callId),
    );
    for (const callId of called) expect(answered.has(callId)).toBe(true);
  });

  it("预算检查计入工具表（同形请求）：工具表太大 → SUMMARY_TOO_LARGE，不发必败请求", async () => {
    const { service, seen } = scripted([
      { type: "text-delta", text: "summary" },
      { type: "finish", reason: "stop" },
    ]);
    const result = await requestSummary({
      ...baseInput,
      llm: service,
      tools: [{ name: "big", description: "d".repeat(40_000), inputSchema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }],
      hardLimit: 10_000,
      summaryOut: 1_000,
    });
    expect(result).toMatchObject({ ok: false, code: "SUMMARY_TOO_LARGE" });
    expect(seen).toHaveLength(0);
  });
});
