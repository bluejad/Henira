// 压缩行投影（compaction.md §4.7 / §4.11）：四态、悬挂收口、替换记录不投影成用户行。
// 悬挂 = 重放后仍 running（进程死亡/中断留下的 start 或半截 summary）→ interrupted，
// 不补写账本事件。

import { describe, expect, it } from "vitest";
import type { SessionEvent } from "./envelope.js";
import { rebuildProjection } from "./projection.js";

function ev(seq: number, type: string, data: unknown, ignorable?: boolean): SessionEvent {
  return { type, seq, time: 1_700_000_000_000 + seq, data, ...(ignorable ? { ignorable } : {}) };
}

const start = (seq: number, id = "c1"): SessionEvent =>
  ev(
    seq,
    "compaction/start",
    {
      id,
      trigger: "auto",
      turn: "t1",
      step: 1,
      before: 110_000,
      plan: { startSeq: 1, endSeq: 4, units: 4 },
    },
    true,
  );

describe("压缩行投影（compaction.md §4.11）", () => {
  it("start → summary → end completed：一行收口，摘要可展开", () => {
    const projection = rebuildProjection([
      start(1),
      ev(
        2,
        "compaction/summary",
        {
          id: "c1",
          turn: "t1",
          step: 1,
          model: "p/m",
          usage: { inputTokens: 1, outputTokens: 1 },
          summary: "decisions and files",
          maskedTokens: 90_000,
        },
        true,
      ),
      ev(
        3,
        "compaction/end",
        { id: "c1", turn: "t1", step: 1, state: "completed", after: 20_000 },
        true,
      ),
    ]);
    const rows = projection.rows.filter((row) => row.kind === "compaction");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "compaction",
      state: "completed",
      trigger: "auto",
      before: 110_000,
      after: 20_000,
      summary: "decisions and files",
    });
  });

  it("悬挂的 start / 半截 summary → 已中断（不补写账本）", () => {
    const hangingStart = rebuildProjection([start(1, "c1")]);
    expect(hangingStart.rows[0]).toMatchObject({ kind: "compaction", state: "interrupted" });

    const hangingSummary = rebuildProjection([
      start(1, "c2"),
      ev(
        2,
        "compaction/summary",
        {
          id: "c2",
          turn: "t1",
          step: 1,
          model: "p/m",
          usage: { inputTokens: 1, outputTokens: 1 },
          summary: "half written",
          maskedTokens: 1,
        },
        true,
      ),
    ]);
    expect(hangingSummary.rows[0]).toMatchObject({
      kind: "compaction",
      state: "interrupted",
      summary: "half written",
    });
  });

  it("end failed 不被悬挂收口覆盖", () => {
    const projection = rebuildProjection([
      start(1),
      ev(
        2,
        "compaction/end",
        { id: "c1", turn: "t1", step: 1, state: "failed", error: { code: "X", message: "boom" } },
        true,
      ),
    ]);
    expect(projection.rows[0]).toMatchObject({ kind: "compaction", state: "failed" });
    expect((projection.rows[0] as { error?: string }).error).toContain("boom");
  });

  it("替换记录不投影成用户气泡；原用户行仍在（历史不消失）", () => {
    const projection = rebuildProjection([
      ev(1, "user/message", { turn: "t1", step: 0, content: "hello", source: "send" }),
      ev(2, "user/message", {
        turn: "t1",
        step: 1,
        content: "summary record",
        source: "compaction",
        surfaceOp: { op: "replace", startSeq: 1, endSeq: 1 },
      }),
    ]);
    const users = projection.rows.filter((row) => row.kind === "user");
    expect(users).toHaveLength(1);
    expect((users[0] as { text: string }).text).toBe("hello");
  });
});
