// 订阅队列（D-042 / D-085）：types / turnId 过滤、连续 delta 合并、有界队列满则先同步冲刷、
// 终局帧必达、dispose 清定时器。

import type { Row, ServerFrame } from "@henira/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameSubscription, filterFrame } from "./subscribe-queue.js";

const userRow = (rowId: string, turn: string, text: string): Row => ({
  kind: "user",
  rowId,
  rowSeq: 1,
  turn,
  text,
  source: "send",
});

const assistantRow = (rowId: string, turn: string, text: string): Row => ({
  kind: "assistant",
  rowId,
  rowSeq: 2,
  turn,
  step: 1,
  text,
  streaming: true,
});

const append = (sessionId: string, seq: number, row: Row): ServerFrame => ({
  kind: "delta",
  sessionId,
  seq,
  delta: { op: "row.appended", row },
});

const textDelta = (sessionId: string, seq: number, rowId: string, text: string): ServerFrame => ({
  kind: "delta",
  sessionId,
  seq,
  delta: { op: "row.delta", rowId, field: "text", text },
});

const stateFrame = (sessionId: string, seq: number, lastTurnId: string): ServerFrame => ({
  kind: "delta",
  sessionId,
  seq,
  delta: { op: "state.updated", state: { busy: false, lastTurnId } },
});

describe("filterFrame", () => {
  it("types 只看行帧；state.updated 与 sessions.changed 不受影响（无 turnId 时）", () => {
    const filter = { sessionId: "s1", types: ["user" as const] };
    expect(filterFrame(append("s1", 1, userRow("u:1", "t1", "hi")), filter)).toBeDefined();
    expect(
      filterFrame(append("s1", 2, assistantRow("a:t1:1", "t1", "yo")), filter),
    ).toBeUndefined();
    expect(filterFrame(stateFrame("s1", 3, "t1"), filter)).toBeDefined();
    expect(filterFrame(append("s2", 1, userRow("u:2", "t1", "other")), filter)).toBeUndefined();
  });

  it("turnId 过滤行帧；state.updated 只在 lastTurnId 匹配时投递", () => {
    const filter = { sessionId: "s1", turnId: "t1" };
    expect(filterFrame(append("s1", 1, userRow("u:1", "t1", "hi")), filter)).toBeDefined();
    expect(filterFrame(append("s1", 2, userRow("u:2", "t2", "later")), filter)).toBeUndefined();
    expect(filterFrame(stateFrame("s1", 3, "t1"), filter)).toBeDefined();
    expect(filterFrame(stateFrame("s1", 4, "t2"), filter)).toBeUndefined();
  });

  it("过滤快照行：types / turnId 同时作用，totalRows 收敛为过滤后行数", () => {
    const filter = { types: ["user" as const], turnId: "t1" };
    const frame: ServerFrame = {
      kind: "snapshot",
      sessionId: "s1",
      snapshot: {
        sessionId: "s1",
        seq: 2,
        rows: [
          userRow("u:1", "t1", "a"),
          assistantRow("a:t1:1", "t1", "b"),
          userRow("u:2", "t2", "c"),
        ],
        state: { busy: false },
        hasOlder: true,
        totalRows: 3,
      },
    };
    const out = filterFrame(frame, filter) as Extract<ServerFrame, { kind: "snapshot" }>;
    expect(out.snapshot.rows.map((r) => r.rowId)).toEqual(["u:1"]);
    expect(out.snapshot.totalRows).toBe(1);
    expect(out.snapshot.hasOlder).toBe(false);
  });

  it("row.delta 用 lookupRow 判定类型；查不到时不丢帧", () => {
    const rows = new Map([["a:t1:1", assistantRow("a:t1:1", "t1", "yo")]]);
    const lookup = (_sid: string, rowId: string) => rows.get(rowId);
    expect(
      filterFrame(textDelta("s1", 1, "a:t1:1", "x"), { types: ["assistant"] }, lookup),
    ).toBeDefined();
    expect(
      filterFrame(textDelta("s1", 2, "a:t1:1", "x"), { types: ["user"] }, lookup),
    ).toBeUndefined();
    expect(
      filterFrame(textDelta("s1", 3, "missing", "x"), { types: ["user"] }, lookup),
    ).toBeDefined();
  });
});

describe("createFrameSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("连续 row.delta 同 rowId+field 合并为一条投递（增量可并）", () => {
    const seen: ServerFrame[] = [];
    const sub = createFrameSubscription({}, { deliver: (frame) => seen.push(frame) });
    sub.push(textDelta("s1", 1, "a:t1:1", "he"));
    sub.push(textDelta("s1", 2, "a:t1:1", "llo"));
    vi.advanceTimersByTime(20);
    expect(seen).toHaveLength(1);
    const delta = seen[0] as Extract<ServerFrame, { kind: "delta" }>;
    expect(delta.delta).toEqual({ op: "row.delta", rowId: "a:t1:1", field: "text", text: "hello" });
    sub.dispose();
  });

  it("队列满则先同步冲刷：终局帧不丢", () => {
    const seen: ServerFrame[] = [];
    const sub = createFrameSubscription({}, { cap: 2, deliver: (frame) => seen.push(frame) });
    sub.push(append("s1", 1, userRow("u:1", "t1", "a"))); // queue 1
    expect(seen).toHaveLength(0);
    sub.push(append("s1", 2, userRow("u:2", "t1", "b"))); // queue 2
    sub.push(append("s1", 3, userRow("u:3", "t1", "c"))); // 满 → 先冲刷前两条，再入队
    expect(seen).toHaveLength(2);
    vi.advanceTimersByTime(20);
    expect(seen).toHaveLength(3); // 第三条也必达
    sub.dispose();
  });

  it("dispose 后不再投递且清掉定时器", () => {
    const deliver = vi.fn();
    const sub = createFrameSubscription({}, { deliver });
    sub.push(append("s1", 1, userRow("u:1", "t1", "a")));
    sub.dispose();
    vi.advanceTimersByTime(50);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("回调抛错不拖死后续帧", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: ServerFrame[] = [];
    const sub = createFrameSubscription(
      {},
      {
        deliver: (frame) => {
          if (seen.length === 0) {
            seen.push(frame);
            throw new Error("boom");
          }
          seen.push(frame);
        },
      },
    );
    sub.push(append("s1", 1, userRow("u:1", "t1", "a")));
    sub.push(append("s1", 2, userRow("u:2", "t1", "b")));
    vi.advanceTimersByTime(20);
    expect(seen).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    sub.dispose();
  });
});
