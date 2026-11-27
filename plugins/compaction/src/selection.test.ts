// 区间选择单测（compaction.md §4.5、§5 I-2 / I-3 / 滚动摘要）：尾部按 retain、
// 在途工具调用的步不可压、系统块永不进区间、上一份摘要记录随新区间退出。

import { contextBudget, type SessionEvent, type SurfaceEntry } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { selectInterval } from "./selection.js";

const budget = contextBudget({ contextWindow: 32_000 }); // retain 4K / headMin 4K

let seq = 0;
function ev(type: string, data: unknown): SessionEvent {
  seq += 1;
  return { type, seq, time: 1_700_000_000_000 + seq, data };
}
function reset(): void {
  seq = 0;
}
function entry(
  seqNo: number,
  role: "user" | "assistant" | "system",
  content: string,
): SurfaceEntry {
  return { seq: seqNo, message: { role, content } };
}

/** 10 对 user/assistant，每条约 1000 token（2000 个字母 × 0.5） */
function pairs(count: number): { events: SessionEvent[]; surface: SurfaceEntry[] } {
  const events: SessionEvent[] = [];
  const surface: SurfaceEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const user = ev("user/message", {
      turn: `t-${index}`,
      step: 0,
      content: "x".repeat(2_000),
      source: "send",
    });
    const assistant = ev("assistant/message", {
      turn: `t-${index}`,
      step: 1,
      content: "y".repeat(2_000),
      model: "p/m",
      finishReason: "stop",
    });
    events.push(user, assistant);
    surface.push(entry(user.seq, "user", "x".repeat(2_000)));
    surface.push(entry(assistant.seq, "assistant", "y".repeat(2_000)));
  }
  return { events, surface };
}

describe("selectInterval（compaction.md §4.5）", () => {
  it("尾部按 retain 保留，头部从最早单元起；头部不足 headMin 判历史不足", () => {
    reset();
    const { events, surface } = pairs(10);
    const plan = selectInterval({ events, surface, budget });
    expect(plan).toBeDefined();
    expect(plan?.startSeq).toBe(1);
    expect(plan?.head.length).toBe(16); // 10 对里尾部留 4 个单元
    expect(plan?.maskedTokens).toBeGreaterThanOrEqual(budget.headMin);
    expect(plan?.endSeq).toBe(16); // 前 16 个单元（尾部 4 个单元不遮蔽）

    const tiny = selectInterval({
      events: events.slice(0, 4),
      surface: surface.slice(0, 4),
      budget,
    });
    expect(tiny).toBeUndefined(); // 2 对 ≈ 4K，尾部吃满 → 无头部
  });

  it("有在途工具调用的单元不可压缩（I-2）；当前回合的未闭合调用才是在途", () => {
    reset();
    const events: SessionEvent[] = [];
    const surface: SurfaceEntry[] = [];
    for (let index = 0; index < 10; index += 1) {
      const user = ev("user/message", {
        turn: `t-${index}`,
        step: 0,
        content: "x".repeat(2_000),
        source: "send",
      });
      const assistant = ev("assistant/message", {
        turn: `t-${index}`,
        step: 1,
        content: "y".repeat(2_000),
        model: "p/m",
        finishReason: index === 0 ? "tool-calls" : "stop",
      });
      events.push(user, assistant);
      surface.push(entry(user.seq, "user", "x".repeat(2_000)));
      surface.push(entry(assistant.seq, "assistant", "y".repeat(2_000)));
      if (index === 0)
        events.push(
          ev("tool/call", { turn: "t-0", step: 1, callId: "c1", name: "read", arguments: "{}" }),
        );
    }
    // 当前回合 = t-0：调用的结果还可能来 → 整段不可压
    expect(selectInterval({ events, surface, budget, currentTurn: "t-0" })).toBeUndefined();
    // 回合已结束（崩溃遗留的孤儿）：结果永远不会来，派生已合成错误结果 → 可压
    expect(selectInterval({ events, surface, budget, currentTurn: "t-live" })).toBeDefined();
    expect(selectInterval({ events, surface, budget })).toBeDefined(); // 闲时手动：无在途回合
  });

  it("digest 替换不挡后续模型摘要（P1）：不计前推/滚动，只在区间重叠处截断", () => {
    reset();
    const { events, surface } = pairs(10);
    // 无模型摘要替换了尾部最后一对（§4.9 允许摘最新一步）：记录 seq 21，区间 [19,20]
    const digest = ev("user/message", {
      turn: "t-digest",
      step: 0,
      content: "[compacted tool step]",
      source: "compaction-digest",
      surfaceOp: { op: "replace", startSeq: 19, endSeq: 20 },
    });
    const tailSurface = [
      ...surface.filter((item) => item.seq < 19),
      entry(19, "user", "[compacted tool step]"), // 摘要插在区间起点（记录 seq 21）
    ];
    const first = selectInterval({
      events: [...events, digest],
      surface: tailSurface,
      budget,
    });
    // 无修复时 previousEnd = 20 → 起点 1 ≤ 20 直接判不选
    expect(first).toBeDefined();
    expect(first?.startSeq).toBe(1);
    expect(first?.endSeq).toBeLessThan(19); // 区间不碰 digest 区间 [19,20]

    // 落在头部中间（区间 [9,10]）：新区间截到它之前，绝不允许重叠（store 先写生效）
    reset();
    const middle = pairs(10);
    const midDigest = ev("user/message", {
      turn: "t-digest",
      step: 0,
      content: "[compacted tool step]",
      source: "compaction-digest",
      surfaceOp: { op: "replace", startSeq: 9, endSeq: 10 },
    });
    const midSurface = [
      ...middle.surface.filter((item) => !(item.seq >= 9 && item.seq <= 10)),
      entry(9, "user", "[compacted tool step]"),
    ];
    const second = selectInterval({
      events: [...middle.events, midDigest],
      surface: midSurface,
      budget,
    });
    expect(second).toBeDefined();
    expect(second?.startSeq).toBe(1);
    expect(second?.endSeq).toBe(8); // 截在 digest 区间 [9,10] 之前
  });

  it("已压区间前的残留碎片不再挡住后续摘要（前沿过滤）", () => {
    reset();
    const fragment = ev("user/message", {
      turn: "t-frag",
      step: 0,
      content: "f".repeat(200),
      source: "send",
    });
    const oldUser = ev("user/message", {
      turn: "t-old",
      step: 0,
      content: "o".repeat(20_000),
      source: "send",
    });
    const oldAssistant = ev("assistant/message", {
      turn: "t-old",
      step: 1,
      content: "p".repeat(20_000),
      model: "p/m",
      finishReason: "stop",
    });
    const record = ev("user/message", {
      turn: "t-old",
      step: 2,
      content: "old summary",
      source: "compaction",
      surfaceOp: { op: "replace", startSeq: oldUser.seq, endSeq: oldAssistant.seq },
    });
    const { events, surface } = pairs(8);
    const all = [fragment, oldUser, oldAssistant, record, ...events];
    // 碎片在旧区间之前且永远可见（新区间截断时被留下），旧区间只遮住 oldUser/oldAssistant
    const allSurface = [
      entry(fragment.seq, "user", "f".repeat(200)),
      entry(oldUser.seq, "user", "old summary"),
      ...surface,
    ];
    const plan = selectInterval({ events: all, surface: allSurface, budget });
    expect(plan).toBeDefined();
    // 起点 = 旧摘要记录自身（滚动吸收），不碰旧区间；碎片在区间之外
    expect(plan?.startSeq).toBe(record.seq);
    expect(plan?.startSeq).toBeGreaterThan(oldAssistant.seq);
  });

  it("中段 digest 前段不足 headMin：改从截断点之后起算（不永久判历史不足）", () => {
    reset();
    const events: SessionEvent[] = [];
    const surface: SurfaceEntry[] = [];
    // 前段两个很小的单元（≈280 token < headMin 4K）：一次中段无模型摘要之后，
    // 它们成了永远进不了区间、也永远长不大的残留碎片
    const u0 = ev("user/message", {
      turn: "t-pre",
      step: 0,
      content: "s".repeat(200),
      source: "send",
    });
    const a0 = ev("assistant/message", {
      turn: "t-pre",
      step: 1,
      content: "a".repeat(200),
      model: "p/m",
      finishReason: "stop",
    });
    events.push(u0, a0);
    surface.push(
      entry(u0.seq, "user", "s".repeat(200)),
      entry(a0.seq, "assistant", "a".repeat(200)),
    );
    // 之后 9 对（每单元 1000 token）；digest 替换第 1 对（seq 3,4）——紧挨着前段碎片
    for (let index = 0; index < 9; index += 1) {
      const user = ev("user/message", {
        turn: `t-${index}`,
        step: 0,
        content: "x".repeat(2_000),
        source: "send",
      });
      const assistant = ev("assistant/message", {
        turn: `t-${index}`,
        step: 1,
        content: "y".repeat(2_000),
        model: "p/m",
        finishReason: "stop",
      });
      events.push(user, assistant);
      if (index !== 0) {
        surface.push(entry(user.seq, "user", "x".repeat(2_000)));
        surface.push(entry(assistant.seq, "assistant", "y".repeat(2_000)));
      }
    }
    surface.push(entry(3, "user", "[compacted tool step]")); // 摘要插在区间起点
    const digest = ev("user/message", {
      turn: "t-digest",
      step: 0,
      content: "[compacted tool step]",
      source: "compaction-digest",
      surfaceOp: { op: "replace", startSeq: 3, endSeq: 4 },
    });
    const plan = selectInterval({ events: [...events, digest], surface, budget });
    // 旧行为：截到 digest 之前只剩前段 280 token < headMin → 整次返回 undefined（永久卡死）
    expect(plan).toBeDefined();
    expect(plan?.startSeq).toBeGreaterThan(4); // 从截断点之后起算
    expect(plan?.maskedTokens).toBeGreaterThanOrEqual(budget.headMin);
  });

  it("系统消息夹在头部中间：区间截到系统消息之前（I-3）", () => {
    reset();
    const first = ev("user/message", {
      turn: "t-0",
      step: 0,
      content: "z".repeat(20_000),
      source: "send",
    });
    const system = ev("system/message", {
      turn: "t-0",
      step: 0,
      content: "system block",
      key: "k",
    });
    const { events, surface } = pairs(10);
    const all = [first, system, ...events];
    const allSurface = [entry(first.seq, "user", "z".repeat(20_000)), ...surface];
    const plan = selectInterval({ events: all, surface: allSurface, budget });
    expect(plan).toBeDefined();
    expect(plan?.startSeq).toBe(first.seq);
    expect(plan?.endSeq).toBe(first.seq); // 后续单元全部落在系统块之后，被截掉
  });

  it("滚动摘要：新区间起点下探到上一份摘要记录自身的 seq（不重叠旧区间）", () => {
    reset();
    const u1 = ev("user/message", {
      turn: "t-old",
      step: 0,
      content: "x".repeat(20_000),
      source: "send",
    });
    const a1 = ev("assistant/message", {
      turn: "t-old",
      step: 1,
      content: "y".repeat(20_000),
      model: "p/m",
      finishReason: "stop",
    });
    const record = ev("user/message", {
      turn: "t-old",
      step: 2,
      content: "old summary",
      source: "compaction",
      surfaceOp: { op: "replace", startSeq: u1.seq, endSeq: a1.seq },
    });
    const { events, surface } = pairs(10);
    const all = [u1, a1, record, ...events];
    const allSurface = [entry(u1.seq, "user", "old summary"), ...surface];
    const plan = selectInterval({ events: all, surface: allSurface, budget });
    expect(plan).toBeDefined();
    expect(plan?.startSeq).toBe(record.seq); // 下探到记录，旧摘要随新区间退出
    expect(plan?.startSeq).toBeGreaterThan(a1.seq); // 不与旧区间重叠
  });
});
