// AI SDK → StreamEvent 映射测试：合成 TextStreamPart 直接喂 mapper（不联网、不装 provider）。
// P3 三不变量 + 截断调用不产事件 + 错误 rejection 通道在此锁定。

import { LlmError, type StreamEvent } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { mapFinishReason, mapUsage, StreamEventMapper, ToolCallAssembler } from "./stream-parts.js";

// 测试用的最小 part 工厂（对齐 ai v7 TextStreamPart 形状；不引 SDK 类型，值即形状）
function parts(...list: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return list;
}

async function collect(list: readonly Record<string, unknown>[]): Promise<StreamEvent[]> {
  const mapper = new StreamEventMapper();
  const out: StreamEvent[] = [];
  for (const part of list) for (const event of mapper.map(part as never)) out.push(event);
  return out;
}

describe("StreamEventMapper", () => {
  it("文本与推理 delta 逐一映射", async () => {
    const events = await collect(
      parts(
        { type: "text-delta", id: "t1", text: "你" },
        { type: "text-delta", id: "t1", text: "好" },
        { type: "reasoning-delta", id: "r1", text: "思考" },
      ),
    );
    expect(events).toEqual([
      { type: "text-delta", text: "你" },
      { type: "text-delta", text: "好" },
      { type: "reasoning-delta", text: "思考" },
    ]);
  });

  it("不变量③+①：tool-input deltas 只攒不吐，tool-call part 才发，argsText = 原始分片拼接", async () => {
    const events = await collect(
      parts(
        { type: "tool-input-start", id: "tc1", toolName: "write" },
        { type: "tool-input-delta", id: "tc1", delta: '{"path":"a' },
        { type: "tool-input-delta", id: "tc1", delta: '.txt"}' },
        { type: "tool-input-end", id: "tc1" },
        { type: "tool-call", toolCallId: "tc1", toolName: "write", input: { path: "a.txt" } },
        {
          type: "finish",
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          totalUsage: {},
        },
      ),
    );
    expect(events).toEqual([
      { type: "tool-call", callId: "tc1", name: "write", argsText: '{"path":"a.txt"}' },
      { type: "finish", reason: "tool-calls" },
    ]);
  });

  it("provider 不发 deltas 时回退 stringify（有损路径注释在实现内）", async () => {
    const events = await collect(
      parts(
        { type: "tool-call", toolCallId: "tc2", toolName: "read", input: { path: "b.txt" } },
        {
          type: "finish",
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          totalUsage: {},
        },
      ),
    );
    expect(events[0]).toEqual({
      type: "tool-call",
      callId: "tc2",
      name: "read",
      argsText: '{"path":"b.txt"}',
    });
  });

  it("invalid tool-call（不可解析 / 不存在工具）不产事件——无 dangling、模型重试", async () => {
    const events = await collect(
      parts(
        { type: "tool-input-start", id: "bad", toolName: "write" },
        { type: "tool-input-delta", id: "bad", delta: "{截断的" },
        {
          type: "tool-call",
          toolCallId: "bad",
          toolName: "write",
          input: undefined,
          invalid: true,
        },
        {
          type: "finish",
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          totalUsage: {},
        },
      ),
    );
    expect(events).toEqual([{ type: "finish", reason: "tool-calls" }]);
  });

  it("不变量②：finish part 携带 usage → usage 先于 finish", async () => {
    const events = await collect(
      parts({
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: {
          inputTokens: 100,
          outputTokens: 20,
          inputTokenDetails: { cacheReadTokens: 80 },
        },
      }),
    );
    expect(events).toEqual([
      { type: "usage", usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80 } },
      { type: "finish", reason: "stop" },
    ]);
  });

  it("结构 part（start / start-step / finish-step / raw / ping）映射为空", async () => {
    const events = await collect(
      parts(
        { type: "start" },
        { type: "start-step", request: {}, warnings: [] },
        { type: "ping" },
        { type: "raw", rawValue: 1 },
      ),
    );
    expect(events).toEqual([]);
  });

  it("error part → 流以 LlmError rejection 收场（拒绝通道，不进 StreamEvent）", async () => {
    const mapper = new StreamEventMapper();
    expect(() => mapper.map({ type: "error", error: new Error("boom") } as never)).toThrow(
      LlmError,
    );
  });

  it("mapFinishReason：error / interrupted / other → unknown（封闭词表外的都归 unknown）", () => {
    expect(mapFinishReason("stop")).toBe("stop");
    expect(mapFinishReason("tool-calls")).toBe("tool-calls");
    expect(mapFinishReason("length")).toBe("length");
    expect(mapFinishReason("content-filter")).toBe("content-filter");
    expect(mapFinishReason("error")).toBe("unknown");
    expect(mapFinishReason("interrupted")).toBe("unknown");
    expect(mapFinishReason("other")).toBe("unknown");
  });

  it("mapUsage：空 usage → undefined（不发 usage 事件）；细分字段进 TokenUsage", () => {
    expect(
      mapUsage({
        inputTokens: undefined,
        outputTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        totalTokens: undefined,
      }),
    ).toBeUndefined();
    expect(
      mapUsage({
        inputTokens: 10,
        outputTokens: 5,
        inputTokenDetails: {
          noCacheTokens: 10,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: { textTokens: 2, reasoningTokens: 3 },
        totalTokens: 15,
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      reasoningTokens: 3,
    });
  });
});

describe("ToolCallAssembler", () => {
  it("start → delta → take：原始文本保真（含空白与键序，不变量①）", () => {
    const a = new ToolCallAssembler();
    a.start("x", "write");
    a.delta("x", '{"n": 1, ');
    a.delta("x", '"path":  "a"}');
    expect(a.take("x", { n: 1, path: "a" })).toBe('{"n": 1, "path":  "a"}');
  });

  it("未知 id 容忍：delta 先于 start 也攒住（provider 乱序防御）", () => {
    const a = new ToolCallAssembler();
    a.delta("y", "abc");
    expect(a.take("y", {})).toBe("abc");
  });

  it("take 即清除：同一 id 不重复产出", () => {
    const a = new ToolCallAssembler();
    a.start("z", "t");
    a.delta("z", "{}");
    a.take("z", {});
    expect(a.take("z", { fallback: true })).toBe('{"fallback":true}');
  });
});
