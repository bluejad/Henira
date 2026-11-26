// 摘要请求单测（compaction.md §4.6、§5 I-4 / I-7 / F-4 / F-9）：同形请求、装不下先裁尾部、
// 工具调用/截断/空正文/摘要不小于被遮蔽量都不算成功。

import {
  contextBudget,
  estimateMessages,
  estimateText,
  type LlmRequest,
  type LlmService,
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
});
