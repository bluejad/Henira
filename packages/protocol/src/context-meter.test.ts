// 计量器单测（compaction.md §4.2、§5 I-1 / 计量器 / 换模型）：锚点 + 增量、
// 推理不回传的携带量扣减、换模型作废锚点、替换落账后锚点失效、k 只上调。

import { describe, expect, it } from "vitest";
import { contextBudget } from "./context-budget.js";
import { measureContext, nextK, restoreContextReading, scaleParts } from "./context-meter.js";
import type { SessionEvent } from "./envelope.js";
import type { TokenUsage, WireToolSchema } from "./llm.js";
import type { ModelMessage, SurfaceEntry } from "./services.js";
import { estimateMessage, estimateTools } from "./token-estimate.js";

let sequence = 1;
function ev(type: string, data: unknown): SessionEvent {
  const seq = sequence++;
  return { type, seq, time: 1_700_000_000_000 + seq, data };
}

function reset(): void {
  sequence = 1;
}

function toolSchema(name: string, description = "does things"): WireToolSchema {
  return { name, description, inputSchema: { type: "object" } };
}

function entry(seq: number, message: ModelMessage): SurfaceEntry {
  return { seq, message };
}

const budget = contextBudget();

describe("measureContext（compaction.md §4.2）", () => {
  it("无锚点：整面估算（系统 + 工具表 + 消息），标 estimated", () => {
    reset();
    const system = ev("system/message", { turn: "t", step: 0, content: "You are Henira." });
    const user = ev("user/message", { turn: "t", step: 0, content: "hello" });
    const surface = [
      entry(system.seq, { role: "system", content: "You are Henira." }),
      entry(user.seq, { role: "user", content: "hello" }),
    ];
    const tools = [toolSchema("bash")];
    const result = measureContext({
      events: [system, user],
      surface,
      tools,
      model: "p/m",
      budget,
      k: 1,
    });
    const expected =
      estimateMessage(surface[0].message) +
      estimateMessage(surface[1].message) +
      estimateTools(tools);
    expect(result.reading.estimated).toBe(true);
    expect(result.reading.used).toBe(expected);
    expect(result.anchor).toBeUndefined();
    expect(result.reading.parts.system).toBe(estimateMessage(surface[0].message));
    expect(result.reading.parts.messages).toBe(estimateMessage(surface[1].message));
    expect(result.reading.parts.tools).toBe(estimateTools(tools));
    expect(
      result.reading.parts.system + result.reading.parts.tools + result.reading.parts.messages,
    ).toBe(result.reading.used);
  });

  it("锚点 + 携带量：推理不回传时扣掉思考 token；缓存命中率取 cacheRead ÷ input", () => {
    reset();
    const events = [
      ev("request/header", {
        turn: "t",
        step: 1,
        model: "p/m",
        params: {},
        toolNames: [],
        systemPromptHash: "x",
      }),
      ev("assistant/message", {
        turn: "t",
        step: 1,
        content: "hi",
        model: "p/m",
        finishReason: "stop",
      }),
      ev("step/end", {
        turn: "t",
        step: 1,
        usage: { inputTokens: 1000, outputTokens: 200, reasoningTokens: 80, cacheReadTokens: 500 },
      }),
    ];
    const assistant: ModelMessage = { role: "assistant", content: "hi" };
    const surface = [entry(events[1].seq, assistant)];
    const result = measureContext({ events, surface, tools: [], model: "p/m", budget, k: 1 });
    expect(result.reading.estimated).toBe(false);
    expect(result.reading.used).toBe(1120); // 1000 + (200 − 80)
    expect(result.reading.cacheHitRate).toBe(0.5);
    expect(result.anchor?.cutSeq).toBe(events[1].seq);
  });

  it("回传推理时携带量不扣减", () => {
    reset();
    const events = [
      ev("request/header", {
        turn: "t",
        step: 1,
        model: "p/m",
        params: { echoReasoning: true },
        toolNames: [],
        systemPromptHash: "x",
      }),
      ev("assistant/message", {
        turn: "t",
        step: 1,
        content: "hi",
        model: "p/m",
        finishReason: "stop",
      }),
      ev("step/end", {
        turn: "t",
        step: 1,
        usage: { inputTokens: 1000, outputTokens: 200, reasoningTokens: 80 },
      }),
    ];
    const result = measureContext({
      events,
      surface: [entry(events[1].seq, { role: "assistant", content: "hi" })],
      tools: [],
      model: "p/m",
      budget,
      k: 1,
    });
    expect(result.reading.used).toBe(1200);
  });

  it("锚后工具结果按 k 计入；替换落账后锚点失效、转全量估算", () => {
    reset();
    const base = [
      ev("request/header", {
        turn: "t",
        step: 1,
        model: "p/m",
        params: {},
        toolNames: [],
        systemPromptHash: "x",
      }),
      ev("assistant/message", {
        turn: "t",
        step: 1,
        content: "hi",
        model: "p/m",
        finishReason: "tool-calls",
      }),
      ev("step/end", {
        turn: "t",
        step: 1,
        usage: { inputTokens: 1000, outputTokens: 200, reasoningTokens: 80 },
      }),
    ];
    const toolResult: ModelMessage = {
      role: "tool",
      callId: "c1",
      name: "bash",
      content: "x".repeat(400),
      isError: false,
    };
    const tailSeq = 100;
    const withoutReplace = measureContext({
      events: base,
      surface: [
        entry(base[1].seq, { role: "assistant", content: "hi" }),
        entry(tailSeq, toolResult),
      ],
      tools: [],
      model: "p/m",
      budget,
      k: 1.5,
    });
    expect(withoutReplace.reading.used).toBe(1120 + 1.5 * estimateMessage(toolResult));

    const replace = ev("user/message", {
      turn: "t",
      step: 2,
      content: "summary",
      source: "compaction",
      surfaceOp: { op: "replace", startSeq: 1, endSeq: base[2].seq },
    });
    const withReplace = measureContext({
      events: [...base, replace],
      surface: [entry(1, { role: "user", content: "summary" })],
      tools: [],
      model: "p/m",
      budget,
      k: 1.5,
    });
    expect(withReplace.anchor).toBeUndefined();
    expect(withReplace.reading.estimated).toBe(true);
    expect(withReplace.surfaceGeneration).toBe(1);
  });

  it("换模型即作废锚点：同厂商换模型与换厂商都按全量估算", () => {
    reset();
    const events = [
      ev("request/header", {
        turn: "t",
        step: 1,
        model: "p/m-old",
        params: {},
        toolNames: [],
        systemPromptHash: "x",
      }),
      ev("assistant/message", {
        turn: "t",
        step: 1,
        content: "hi",
        model: "p/m-old",
        finishReason: "stop",
      }),
      ev("step/end", { turn: "t", step: 1, usage: { inputTokens: 1000, outputTokens: 200 } }),
    ];
    for (const model of ["p/m-new", "q/m-old"]) {
      const result = measureContext({
        events,
        surface: [entry(events[1].seq, { role: "assistant", content: "hi" })],
        tools: [],
        model,
        budget,
        k: 1,
      });
      expect(result.reading.estimated).toBe(true);
      expect(result.anchor).toBeUndefined();
    }
  });

  it("k 只上调：估高不动、估低按 0.3 滑动、钳 1.5", () => {
    expect(nextK(1, 900, 1000)).toBeUndefined(); // 估高
    expect(nextK(1, 400, 100)).toBeUndefined(); // 样本不足 500
    expect(nextK(1, 1200, 1000)).toBeCloseTo(1 + 0.3 * 0.2, 6);
    expect(nextK(1.4, 2000, 1000)).toBe(1.5); // 钳上限
    expect(nextK(1.5, 3000, 1000)).toBeUndefined(); // 已在顶
  });

  it("分段折算后之和等于 used，舍入差额并入 messages、任一段不为负", () => {
    const parts = scaleParts({ system: 100, tools: 50, messages: 30, total: 180 }, 180, 200);
    expect(parts.system + parts.tools + parts.messages).toBe(200);
    expect(parts.messages).toBe(200 - parts.system - parts.tools);
    expect(parts.system).toBeGreaterThanOrEqual(0);
    expect(parts.tools).toBeGreaterThanOrEqual(0);
    expect(parts.messages).toBeGreaterThanOrEqual(0);
    // used 很小时也不出现负数（差额全由 messages 兜）
    const tiny = scaleParts({ system: 100, tools: 50, messages: 30, total: 180 }, 180, 10);
    expect(tiny.system + tiny.tools + tiny.messages).toBe(10);
    expect(tiny.messages).toBeGreaterThanOrEqual(0);
  });

  it("usage 五字段只影响锚点，不影响表面估算", () => {
    reset();
    const usage: TokenUsage = {
      inputTokens: 500,
      outputTokens: 100,
      reasoningTokens: 20,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
    };
    const events = [
      ev("request/header", {
        turn: "t",
        step: 1,
        model: "p/m",
        params: {},
        toolNames: [],
        systemPromptHash: "x",
      }),
      ev("assistant/message", {
        turn: "t",
        step: 1,
        content: "a",
        model: "p/m",
        finishReason: "stop",
      }),
      ev("step/end", { turn: "t", step: 1, usage }),
    ];
    const result = measureContext({
      events,
      surface: [entry(events[1].seq, { role: "assistant", content: "a" })],
      tools: [],
      model: "p/m",
      budget,
      k: 1,
    });
    expect(result.reading.used).toBe(580); // 500 + (100 − 20)
    expect(result.reading.cacheHitRate).toBe(0.1);
  });
});

describe("restoreContextReading（compaction.md §4.11 重启恢复）", () => {
  it("有锚点：总量 = 锚点 input + 携带输出；partial 标记、工具表体积按差值反推", () => {
    reset();
    const system = ev("system/message", { turn: "t", step: 0, content: "sys" });
    const user = ev("user/message", { turn: "t", step: 0, content: "hello" });
    const header = ev("request/header", {
      turn: "t",
      step: 1,
      model: "p/m",
      params: {},
      toolNames: ["bash"],
      systemPromptHash: "x",
    });
    const assistant = ev("assistant/message", {
      turn: "t",
      step: 1,
      content: "hi",
      model: "p/m",
      finishReason: "stop",
    });
    const end = ev("step/end", {
      turn: "t",
      step: 1,
      usage: { inputTokens: 5_000, outputTokens: 120 },
    });
    const surface = [
      entry(system.seq, { role: "system", content: "sys" }),
      entry(user.seq, { role: "user", content: "hello" }),
      entry(assistant.seq, { role: "assistant", content: "hi" }),
    ];
    const reading = restoreContextReading({
      events: [system, user, header, assistant, end],
      surface,
      model: "p/m",
      modelConfig: { contextWindow: 200_000 },
    });
    expect(reading).toBeDefined();
    expect(reading?.partial).toBe(true); // 拆分不可得（磁盘路径没有工具表）
    expect(reading?.estimated).toBe(false); // 有锚点
    expect(reading?.size).toBe(200_000);
    expect(reading?.used).toBe(5_000 + 120); // 锚点 + 携带（推理不回传、reasoning 0）
    const systemEstimate = estimateMessage(surface[0].message);
    const atAnchorMessages =
      estimateMessage(surface[1].message) + estimateMessage(surface[2].message);
    expect(reading?.parts.system).toBe(systemEstimate);
    expect(reading?.parts.tools).toBe(5_000 - systemEstimate - atAnchorMessages);
    expect(
      (reading?.parts.system ?? 0) + (reading?.parts.tools ?? 0) + (reading?.parts.messages ?? 0),
    ).toBe(reading?.used);
  });

  it("无锚点（从未请求过）：undefined——不猜", () => {
    reset();
    const system = ev("system/message", { turn: "t", step: 0, content: "sys" });
    const user = ev("user/message", { turn: "t", step: 0, content: "hello" });
    const surface = [
      entry(system.seq, { role: "system", content: "sys" }),
      entry(user.seq, { role: "user", content: "hello" }),
    ];
    expect(
      restoreContextReading({ events: [system, user], surface, model: "p/m" }),
    ).toBeUndefined();
  });

  it("锚点被替换记录作废（空闲压缩后重启）：从 compaction/end.after 起算，estimated + partial", () => {
    reset();
    const system = ev("system/message", { turn: "t", step: 0, content: "sys" });
    const user = ev("user/message", { turn: "t", step: 0, content: "hello" });
    const header = ev("request/header", {
      turn: "t1",
      step: 1,
      model: "p/m",
      params: {},
      toolNames: ["bash"],
      systemPromptHash: "x",
    });
    const assistant = ev("assistant/message", {
      turn: "t1",
      step: 1,
      content: "hi",
      model: "p/m",
      finishReason: "stop",
    });
    const end = ev("step/end", {
      turn: "t1",
      step: 1,
      usage: { inputTokens: 5_000, outputTokens: 120 },
    });
    const start = ev("compaction/start", {
      id: "c1",
      trigger: "manual",
      turn: "t1",
      step: 1,
      before: 5_120,
      plan: {},
    });
    // 空闲手动压缩：替换记录在锚点之后落账（表面只剩系统 + 摘要）
    const summary = ev("user/message", {
      turn: "t1",
      step: 1,
      content: "摘要",
      source: "compaction",
      surfaceOp: { op: "replace", startSeq: user.seq, endSeq: end.seq },
    });
    const compactEnd = ev("compaction/end", {
      id: "c1",
      turn: "t1",
      step: 1,
      state: "completed",
      after: 3_000, // 压缩后整面估算（含真实工具表）
    });
    const surface = [
      entry(system.seq, { role: "system", content: "sys" }),
      entry(summary.seq, { role: "user", content: "摘要" }),
    ];
    const reading = restoreContextReading({
      events: [system, user, header, assistant, end, start, summary, compactEnd],
      surface,
      model: "p/m",
      modelConfig: { contextWindow: 200_000 },
    });
    expect(reading).toBeDefined();
    expect(reading?.estimated).toBe(true); // after 是估算
    expect(reading?.partial).toBe(true); // 磁盘路径没有工具表
    expect(reading?.size).toBe(200_000);
    expect(reading?.used).toBe(3_000); // 压缩后再无请求：用量 = 压缩后的整面估算
    const systemEstimate = estimateMessage(surface[0].message);
    const summaryEstimate = estimateMessage(surface[1].message);
    expect(reading?.parts.system).toBe(systemEstimate);
    expect(reading?.parts.tools).toBe(3_000 - systemEstimate - summaryEstimate);
    expect(
      (reading?.parts.system ?? 0) + (reading?.parts.tools ?? 0) + (reading?.parts.messages ?? 0),
    ).toBe(reading?.used);
  });

  it("替换之后新增的表面叠加在压缩基线之上", () => {
    reset();
    const system = ev("system/message", { turn: "t", step: 0, content: "sys" });
    const user = ev("user/message", { turn: "t", step: 0, content: "hello" });
    const header = ev("request/header", {
      turn: "t1",
      step: 1,
      model: "p/m",
      params: {},
      toolNames: [],
      systemPromptHash: "x",
    });
    const assistant = ev("assistant/message", {
      turn: "t1",
      step: 1,
      content: "hi",
      model: "p/m",
      finishReason: "stop",
    });
    const end = ev("step/end", {
      turn: "t1",
      step: 1,
      usage: { inputTokens: 4_000, outputTokens: 80 },
    });
    const summary = ev("user/message", {
      turn: "t1",
      step: 1,
      content: "摘要",
      source: "compaction",
      surfaceOp: { op: "replace", startSeq: user.seq, endSeq: end.seq },
    });
    const compactEnd = ev("compaction/end", {
      id: "c1",
      turn: "t1",
      step: 1,
      state: "completed",
      after: 2_500,
    });
    // 压缩后用户又发了一条、请求失败（没有 usage）：锚点仍被替换作废，但表面有新增
    const later = ev("user/message", { turn: "t2", step: 0, content: "后来的问题" });
    const surface = [
      entry(system.seq, { role: "system", content: "sys" }),
      entry(summary.seq, { role: "user", content: "摘要" }),
      entry(later.seq, { role: "user", content: "后来的问题" }),
    ];
    const reading = restoreContextReading({
      events: [system, user, header, assistant, end, summary, compactEnd, later],
      surface,
      model: "p/m",
    });
    expect(reading?.used).toBe(2_500 + estimateMessage(surface[2].message));
  });

  it("替换后没有带 after 的 compaction/end（崩溃窗口）：undefined——不猜", () => {
    reset();
    const system = ev("system/message", { turn: "t", step: 0, content: "sys" });
    const user = ev("user/message", { turn: "t", step: 0, content: "hello" });
    const header = ev("request/header", {
      turn: "t1",
      step: 1,
      model: "p/m",
      params: {},
      toolNames: [],
      systemPromptHash: "x",
    });
    const assistant = ev("assistant/message", {
      turn: "t1",
      step: 1,
      content: "hi",
      model: "p/m",
      finishReason: "stop",
    });
    const end = ev("step/end", {
      turn: "t1",
      step: 1,
      usage: { inputTokens: 4_000, outputTokens: 80 },
    });
    const summary = ev("user/message", {
      turn: "t1",
      step: 1,
      content: "摘要",
      source: "compaction",
      surfaceOp: { op: "replace", startSeq: user.seq, endSeq: end.seq },
    });
    const failed = ev("compaction/end", {
      id: "c1",
      turn: "t1",
      step: 1,
      state: "failed",
      error: { code: "X", message: "summary failed" },
    });
    const surface = [
      entry(system.seq, { role: "system", content: "sys" }),
      entry(summary.seq, { role: "user", content: "摘要" }),
    ];
    expect(
      restoreContextReading({
        events: [system, user, header, assistant, end, summary, failed],
        surface,
        model: "p/m",
      }),
    ).toBeUndefined();
  });
});
