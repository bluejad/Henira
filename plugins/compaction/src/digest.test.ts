// 无模型阶梯的选区（compaction.md §4.9）：替换记录的锚点是摘要正文，不归被遮蔽单元——
// 否则摘要正文的估算量会算到旧单元头上，造出必被重叠裁决拒绝的幽灵候选。

import {
  contextBudget,
  type SessionEvent,
  type SessionService,
  type SurfaceEntry,
} from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { digestOversizedUnits } from "./digest.js";

const budget = contextBudget({ contextWindow: 32_000 }); // 超长线 4K

let seq = 0;
function ev(type: string, data: unknown): SessionEvent {
  seq += 1;
  return { type, seq, time: 1_700_000_000_000 + seq, data };
}

describe("digestOversizedUnits（compaction.md §4.9）", () => {
  it("替换锚点不计入被遮蔽单元：模型摘要之后不产生幽灵候选", async () => {
    seq = 0;
    const assistant = ev("assistant/message", {
      turn: "t-1",
      step: 1,
      content: "",
      model: "p/m",
      finishReason: "tool-calls",
    });
    const call = ev("tool/call", {
      turn: "t-1",
      step: 1,
      callId: "c-1",
      name: "read",
      arguments: "{}",
    });
    const result = ev("tool/result", {
      turn: "t-1",
      step: 1,
      callId: "c-1",
      content: "r".repeat(10_000),
      isError: false,
    });
    // 模型摘要把整步遮掉：记录 seq 4，区间 [1,3]
    const record = ev("user/message", {
      turn: "t-1",
      step: 2,
      content: `Summary:\n${"s".repeat(30_000)}`,
      source: "compaction",
      surfaceOp: { op: "replace", startSeq: 1, endSeq: 3 },
    });
    const events = [assistant, call, result, record];
    // 表面：锚点位置放的是摘要正文（15K token，远超超长线），后面一条普通用户消息
    const surface: SurfaceEntry[] = [
      { seq: 1, message: { role: "user", content: `Summary:\n${"s".repeat(30_000)}` } },
      { seq: 5, message: { role: "user", content: "hi" } },
    ];
    const appended: SessionEvent[] = [];
    const session = {
      append: async (event: { type: string; data: unknown; ignorable?: boolean }) => {
        seq += 1;
        const full = { ...event, seq, time: 1_700_000_000_000 + seq } as SessionEvent;
        appended.push(full);
        return full;
      },
      events: () => [...events, ...appended],
      deriveSurface: () => surface,
    } as unknown as SessionService;

    const outcome = await digestOversizedUnits({
      session,
      events,
      surface,
      budget,
      tools: [],
      turn: "t-1",
      step: 2,
      trigger: "auto",
      before: 20_000,
      currentTurn: "t-1",
    });
    // 旧行为：锚点的 15K 估算算到被遮蔽的 t-1 步上 → 判超长 → 写一条覆盖 [1,3] 的替换
    //（与已接受的模型摘要区间重叠，store 会整条拒绝）——这里断言根本不该产生候选
    expect(outcome.applied).toBe(false);
    expect(appended).toHaveLength(0);
  });
});
