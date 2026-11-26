// 滚动摘要在派生规则上的修订（compaction.md §4.5 修订）：后到的区间覆盖上一份替换记录
// 自身的 seq 时，上一份摘要消息同样退出表面——否则摘要会一份份累积。

import type { SessionEvent } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { deriveMessages, deriveSurface } from "./derive.js";

function ev(seq: number, type: string, data: unknown): SessionEvent {
  return { type, seq, time: 1_700_000_000_000 + seq, data };
}

describe("deriveSurface 滚动摘要（compaction.md §4.5）", () => {
  it("第二个区间覆盖第一份摘要记录 → 只留第二份摘要", () => {
    const events: SessionEvent[] = [
      ev(1, "user/message", { turn: "t1", step: 0, content: "old question", source: "send" }),
      ev(2, "assistant/message", {
        turn: "t1",
        step: 1,
        content: "old answer",
        model: "p/m",
        finishReason: "stop",
      }),
      ev(3, "user/message", {
        turn: "t1",
        step: 2,
        content: "first summary",
        source: "compaction",
        surfaceOp: { op: "replace", startSeq: 1, endSeq: 2 },
      }),
      ev(4, "user/message", { turn: "t2", step: 0, content: "follow up", source: "send" }),
      ev(5, "assistant/message", {
        turn: "t2",
        step: 1,
        content: "follow answer",
        model: "p/m",
        finishReason: "stop",
      }),
      ev(6, "user/message", {
        turn: "t2",
        step: 2,
        content: "second summary",
        source: "compaction",
        surfaceOp: { op: "replace", startSeq: 3, endSeq: 5 },
      }),
    ];
    const surface = deriveSurface(events);
    expect(surface.map((entry) => entry.message.content)).toEqual(["second summary"]);
    expect(surface[0]?.seq).toBe(3); // 新摘要锚在新区间起点
    expect(deriveMessages(events).map((message) => message.content)).toEqual(["second summary"]);
  });

  it("第一个区间自身仍生效（未被覆盖时正常替换）", () => {
    const events: SessionEvent[] = [
      ev(1, "user/message", { turn: "t1", step: 0, content: "old", source: "send" }),
      ev(2, "assistant/message", {
        turn: "t1",
        step: 1,
        content: "reply",
        model: "p/m",
        finishReason: "stop",
      }),
      ev(3, "user/message", {
        turn: "t1",
        step: 2,
        content: "summary",
        source: "compaction",
        surfaceOp: { op: "replace", startSeq: 1, endSeq: 2 },
      }),
    ];
    expect(deriveMessages(events).map((message) => message.content)).toEqual(["summary"]);
  });
});
