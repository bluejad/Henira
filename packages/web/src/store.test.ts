// @vitest-environment jsdom
// 行 store 测试：快照整体替换 / 增量应用（append / delta / upsert / state）/ 断档不猜（跳号触发重拉）。

import type { ServerFrame } from "@henira/protocol";
import { describe, expect, it, vi } from "vitest";
import { RowStore } from "./store.js";

function snapshotFrame(
  sessionId: string,
  seq: number,
  rows: Parameters<RowStore["applySnapshot"]>[0]["snapshot"]["rows"] = [],
): Extract<ServerFrame, { kind: "snapshot" }> {
  return {
    kind: "snapshot",
    sessionId,
    snapshot: {
      sessionId,
      seq,
      rows,
      state: { busy: false },
      hasOlder: false,
      totalRows: rows.length,
    },
  };
}

describe("RowStore", () => {
  it("快照整体替换 + getSession 引用稳定（useSyncExternalStore 语义）", () => {
    const store = new RowStore();
    store.applySnapshot(snapshotFrame("s-1", 5));
    const view1 = store.getSession("s-1");
    const view2 = store.getSession("s-1");
    expect(view1).toBe(view2); // 引用稳定
    expect(view1.rows).toEqual([]);
    expect(store.has("s-1")).toBe(true);
    expect(store.has("s-2")).toBe(false);
    store.getSession("s-2"); // 空视图不建会话
    expect(store.has("s-2")).toBe(false);
  });

  it("增量：row.appended → row.delta 追加文本 → state.updated", () => {
    const store = new RowStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.applySnapshot(snapshotFrame("s-1", 0));
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 1,
      delta: {
        op: "row.appended",
        row: { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "问", source: "send" },
      },
    });
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 2,
      delta: {
        op: "row.appended",
        row: {
          kind: "assistant",
          rowId: "a:t-1:1",
          rowSeq: 2,
          turn: "t-1",
          step: 1,
          text: "答",
          streaming: true,
        },
      },
    });
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 3,
      delta: { op: "row.delta", rowId: "a:t-1:1", field: "text", text: "案" },
    });
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 4,
      delta: { op: "state.updated", state: { busy: true, lastTurnId: "t-1" } },
    });
    const view = store.getSession("s-1");
    expect(view.rows).toHaveLength(2);
    expect(view.rows[1]).toMatchObject({ text: "答案" });
    expect(view.state.busy).toBe(true);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("row.upserted：已有行原位替换；缺行追加", () => {
    const store = new RowStore();
    store.applySnapshot(snapshotFrame("s-1", 0));
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 1,
      delta: {
        op: "row.appended",
        row: {
          kind: "tool",
          rowId: "t:t-1:1:c1",
          rowSeq: 1,
          turn: "t-1",
          step: 1,
          callId: "c1",
          name: "ls",
          status: "running",
          input: "{}",
        },
      },
    });
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 2,
      delta: {
        op: "row.upserted",
        row: {
          kind: "tool",
          rowId: "t:t-1:1:c1",
          rowSeq: 2,
          turn: "t-1",
          step: 1,
          callId: "c1",
          name: "ls",
          status: "done",
          input: "{}",
          output: { content: "src", isError: false, durationMs: 5 },
        },
      },
    });
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 3,
      delta: {
        op: "row.upserted",
        row: { kind: "user", rowId: "u:9", rowSeq: 3, turn: "t-1", text: "插话", source: "steer" },
      },
    });
    const view = store.getSession("s-1");
    expect(view.rows).toHaveLength(2);
    expect(view.rows[0]).toMatchObject({ status: "done" }); // 原位
    expect(view.rows[1]).toMatchObject({ rowId: "u:9" }); // 缺行追加
  });

  it("断档不猜：跳号 → 丢帧 + 触发重拉（宿主回拉快照换发）", () => {
    const store = new RowStore();
    const refetch = vi.fn();
    store.setRefetch(refetch);
    store.applySnapshot(snapshotFrame("s-1", 5));
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 7, // 期望 6，来 7 → 丢
      delta: { op: "state.updated", state: { busy: true } },
    });
    expect(refetch).toHaveBeenCalledWith("s-1");
    expect(store.getSession("s-1").state.busy).toBe(false); // 被丢的帧未生效
    // 重复 seq 同样丢
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 5,
      delta: { op: "state.updated", state: { busy: true } },
    });
    expect(refetch).toHaveBeenCalledTimes(2);
    // 宿主换发快照后水位重置，续接增量恢复
    store.applySnapshot(snapshotFrame("s-1", 7));
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 8,
      delta: { op: "state.updated", state: { busy: true } },
    });
    expect(store.getSession("s-1").state.busy).toBe(true);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("row.delta 不可变：变化行换新对象，原行引用冻结（虚拟滚动 memo 化前提）", () => {
    const store = new RowStore();
    store.applySnapshot(snapshotFrame("s-1", 1));
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 2,
      delta: {
        op: "row.appended",
        row: {
          kind: "assistant",
          rowId: "a:t-1:1",
          rowSeq: 1,
          turn: "t-1",
          step: 1,
          text: "前",
          streaming: true,
        },
      },
    });
    const before = store.getSession("s-1").rows[0];
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 3,
      delta: { op: "row.delta", rowId: "a:t-1:1", field: "text", text: "后" },
    });
    const after = store.getSession("s-1").rows[0];
    expect(after).not.toBe(before); // 新对象
    expect(before).toMatchObject({ text: "前" }); // 原对象冻结
    expect(after).toMatchObject({ text: "前后" });
  });

  it("mergeOlderRows：前插只收窗口首行之前 + rowId 去重；无新行返回 false", () => {
    const store = new RowStore();
    store.applySnapshot(
      snapshotFrame("s-1", 5, [
        { kind: "user", rowId: "u:4", rowSeq: 4, turn: "t-2", text: "窗口首", source: "send" },
      ]),
    );
    // 页含：更早行（收，服务端保证页内升序——sliceRowsPage 契约）、窗口内重复行（滤）
    const merged = store.mergeOlderRows("s-1", [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "早二", source: "send" },
      { kind: "user", rowId: "u:2", rowSeq: 2, turn: "t-1", text: "早一", source: "send" },
      { kind: "user", rowId: "u:4", rowSeq: 4, turn: "t-2", text: "窗口首", source: "send" },
    ]);
    expect(merged).toBe(true);
    const view = store.getSession("s-1");
    expect(view.rows.map((r) => r.rowId)).toEqual(["u:1", "u:2", "u:4"]);
    // 重复合并同一页 → 无新行 → false 且不触发订阅
    const again = store.mergeOlderRows("s-1", [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "早二", source: "send" },
    ]);
    expect(again).toBe(false);
    expect(view.rows).toHaveLength(3);
  });

  it("快照窗口字段进视图：hasOlder/totalRows 随快照下发", () => {
    const store = new RowStore();
    store.applySnapshot({
      kind: "snapshot",
      sessionId: "s-1",
      snapshot: {
        sessionId: "s-1",
        seq: 5,
        rows: [{ kind: "user", rowId: "u:9", rowSeq: 9, turn: "t-1", text: "尾", source: "send" }],
        state: { busy: false },
        hasOlder: true,
        totalRows: 120,
      },
    });
    const view = store.getSession("s-1");
    expect(view.hasOlder).toBe(true);
    expect(view.totalRows).toBe(120);
  });

  it("row.delta 指向不存在的行 → 重拉（断档的另一形态）", () => {
    const store = new RowStore();
    const refetch = vi.fn();
    store.setRefetch(refetch);
    store.applySnapshot(snapshotFrame("s-1", 1));
    store.applyFrame({
      kind: "delta",
      sessionId: "s-1",
      seq: 2,
      delta: { op: "row.delta", rowId: "a:gone:1", field: "text", text: "x" },
    });
    expect(refetch).toHaveBeenCalledWith("s-1");
  });
});
