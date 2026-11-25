// 投影器测试：账本回放 → 行（确定性 / 形状 / 全序）、审批对、流式直播 + 步边界自愈、
// 中止冻结、delta 前中止合成中断行、直播与回放 rowId 一致、surfaceOp replace 重建标记。
// 事件形状 = plugins/session/src/validators.ts 的官方 15 变体（账本唯一事实源）。

import { describe, expect, it } from "vitest";
import type { SessionEvent } from "./envelope.js";
import { isReplaceSurface, Projection, rebuildProjection } from "./projection.js";

/** 造账本事件：time 缺省 0（投影不读它除了 time/turnTimings 字段），seq 由调用方排（u/e 行 rowId 依赖它） */
function ev(seq: number, type: string, data: Record<string, unknown>, time = 0): SessionEvent {
  return { type, seq, time, data } as SessionEvent;
}

describe("账本回放 → 快照", () => {
  it("纯文本回合：user 行 + assistant 落定行，busy 随 turn 起落", () => {
    const p = rebuildProjection([
      ev(1, "user/message", { turn: "t-1", step: 0, content: "你好", source: "send" }),
      ev(2, "turn/start", { turn: "t-1" }),
      ev(3, "step/start", { turn: "t-1", step: 1 }),
      ev(4, "assistant/message", {
        turn: "t-1",
        step: 1,
        content: "你好，世界",
        model: "deepseek/deepseek-v4-flash",
        finishReason: "stop",
      }),
      ev(5, "turn/end", { turn: "t-1", reason: "completed" }),
    ]);
    expect(p.rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
    expect(p.rows[0]).toMatchObject({ rowId: "u:1", turn: "t-1", text: "你好", source: "send" });
    expect(p.rows[1]).toMatchObject({
      rowId: "a:t-1:1",
      text: "你好，世界",
      streaming: false,
      model: "deepseek/deepseek-v4-flash",
      finishReason: "stop",
    });
    expect(p.state.busy).toBe(false);
    expect(p.state.lastTurnId).toBe("t-1");
  });

  it("user/message.queueId 原样投影（D-086：排队回执对账键；缺省不带键）", () => {
    const p = rebuildProjection([
      ev(1, "user/message", { turn: "t-1", step: 0, content: "直接发", source: "send" }),
      ev(2, "turn/start", { turn: "t-1" }),
      ev(3, "turn/end", { turn: "t-1", reason: "completed" }),
      ev(4, "turn/start", { turn: "t-2" }),
      ev(5, "user/message", {
        turn: "t-2",
        step: 0,
        content: "排队来的",
        source: "send",
        queueId: "q-1",
      }),
      ev(6, "turn/end", { turn: "t-2", reason: "completed" }),
    ]);
    const users = p.rows.filter((r) => r.kind === "user");
    expect(users[0]).toMatchObject({ text: "直接发" });
    expect((users[0] as { queueId?: string }).queueId).toBeUndefined();
    expect(users[1]).toMatchObject({ text: "排队来的", queueId: "q-1" });
  });

  it("busySince（R173 计时续表）：turn/start 置事件 time、turn/end 清除、重放重建恢复", () => {
    const events = [
      ev(1, "user/message", { turn: "t-1", step: 0, content: "hi", source: "send" }, 1_000),
      ev(2, "turn/start", { turn: "t-1" }, 1_200),
    ];
    const p = new Projection();
    for (const e of events) p.ingest(e);
    expect(p.state.busy).toBe(true);
    expect(p.state.busySince).toBe(1_200); // 权威起点 = turn/start 事件 time
    p.ingest(ev(3, "turn/end", { turn: "t-1", reason: "completed" }, 5_000));
    expect(p.state.busy).toBe(false);
    expect(p.state.busySince).toBeUndefined();
    // 刷新/重连 = 快照从账本重建：busySince 自愈恢复（计时续上不归零）
    const rebuilt = rebuildProjection(events);
    expect(rebuilt.state.busy).toBe(true);
    expect(rebuilt.state.busySince).toBe(1_200);
  });

  it("工具回合全序：assistant 落定 → tool running → done（output 落定），行序 = 账本序", () => {
    const p = rebuildProjection([
      ev(1, "user/message", { turn: "t-1", step: 0, content: "列目录", source: "send" }),
      ev(2, "turn/start", { turn: "t-1" }),
      ev(3, "step/start", { turn: "t-1", step: 1 }),
      ev(4, "assistant/message", {
        turn: "t-1",
        step: 1,
        content: "",
        model: "m",
        finishReason: "tool-calls",
      }),
      ev(5, "tool/call", { turn: "t-1", step: 1, callId: "c1", name: "list-cwd", arguments: "{}" }),
      ev(6, "tool/result", {
        turn: "t-1",
        step: 1,
        callId: "c1",
        isError: false,
        content: "src\npackage.json",
        durationMs: 12,
      }),
      ev(7, "step/end", { turn: "t-1", step: 1, usage: { inputTokens: 1, outputTokens: 1 } }),
      ev(8, "step/start", { turn: "t-1", step: 2 }),
      ev(9, "assistant/message", {
        turn: "t-1",
        step: 2,
        content: "目录里有 src 和 package.json",
        model: "m",
        finishReason: "stop",
      }),
      ev(10, "turn/end", { turn: "t-1", reason: "completed" }),
    ]);
    expect(p.rows.map((r) => r.kind)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(p.rows[2]).toMatchObject({
      rowId: "t:t-1:1:c1",
      status: "done",
      input: "{}",
      output: { content: "src\npackage.json", isError: false, durationMs: 12 },
    });
  });

  it("工具错误：isError → status error + output.isError", () => {
    const p = rebuildProjection([
      ev(1, "turn/start", { turn: "t-1" }),
      ev(2, "step/start", { turn: "t-1", step: 1 }),
      ev(3, "tool/call", { turn: "t-1", step: 1, callId: "c1", name: "shell", arguments: "{}" }),
      ev(4, "tool/result", {
        turn: "t-1",
        step: 1,
        callId: "c1",
        isError: true,
        content: "[error] boom",
        durationMs: 5,
      }),
    ]);
    const tool = p.rows[0];
    expect(tool).toMatchObject({ status: "error", output: { isError: true } });
  });

  it("fork 收口：开回合内无结果调用由子账本合成 tool/result → 投影 status error，无 running 残影（D-085）", () => {
    const p = rebuildProjection([
      ev(1, "turn/start", { turn: "t-1" }),
      ev(2, "step/start", { turn: "t-1", step: 1 }),
      ev(3, "tool/call", { turn: "t-1", step: 1, callId: "c1", name: "read", arguments: "{}" }),
      ev(4, "tool/result", {
        turn: "t-1",
        step: 1,
        callId: "c1",
        isError: true,
        content: "[forked] This tool call has no recorded result at the fork point.",
        durationMs: 0,
      }),
      ev(5, "turn/end", { turn: "t-1", reason: "forked" }),
    ]);
    const tool = p.rows.find((r) => r.kind === "tool");
    expect(tool).toMatchObject({ status: "error", output: { isError: true } });
    expect((tool as { output: { content: string } }).output.content).toContain("[forked]");
    expect(p.state.busy).toBe(false);
  });

  it("tool/result 截断标记：truncated 原样进 output（结构化，不再只靠尾注文本）", () => {
    const p = rebuildProjection([
      ev(1, "turn/start", { turn: "t-1" }),
      ev(2, "step/start", { turn: "t-1", step: 1 }),
      ev(3, "tool/call", { turn: "t-1", step: 1, callId: "c1", name: "read", arguments: "{}" }),
      ev(4, "tool/result", {
        turn: "t-1",
        step: 1,
        callId: "c1",
        isError: false,
        content: "head\n[truncated] output exceeds limit (3000 lines); head kept",
        durationMs: 9,
        truncated: { path: "D:/spill/big.txt", preview: "head" },
      }),
    ]);
    expect(p.rows[0]).toMatchObject({
      status: "done",
      output: {
        isError: false,
        truncated: { path: "D:/spill/big.txt", preview: "head" },
      },
    });
  });

  it("tool/result 带外元数据：meta 原样进 output（透传不解释；缺席不带键）", () => {
    const p = rebuildProjection([
      ev(1, "turn/start", { turn: "t-1" }),
      ev(2, "step/start", { turn: "t-1", step: 1 }),
      ev(3, "tool/call", { turn: "t-1", step: 1, callId: "c1", name: "bash", arguments: "{}" }),
      ev(4, "tool/result", {
        turn: "t-1",
        step: 1,
        callId: "c1",
        isError: false,
        content: "hi",
        durationMs: 3,
        meta: { kind: "shell", exitCode: 0, stdout: "hi", stderr: "" },
      }),
      ev(5, "tool/call", { turn: "t-1", step: 1, callId: "c2", name: "read", arguments: "{}" }),
      ev(6, "tool/result", {
        turn: "t-1",
        step: 1,
        callId: "c2",
        isError: false,
        content: "x",
        durationMs: 1,
      }),
    ]);
    expect(p.rows[0]).toMatchObject({
      output: { meta: { kind: "shell", exitCode: 0, stdout: "hi", stderr: "" } },
    });
    // 缺 meta 的结果不带键（JSON 快照/增量形状稳定）
    const bare = p.rows[1];
    if (bare.kind !== "tool") throw new Error("expected tool row");
    expect("meta" in (bare.output ?? {})).toBe(false);
  });

  it("step/end 用量投影：挂到该步 assistant 行（原位 upsert 不新增行）", () => {
    const p = rebuildProjection([
      ev(1, "turn/start", { turn: "t-1" }),
      ev(2, "step/start", { turn: "t-1", step: 1 }),
      ev(3, "assistant/message", {
        turn: "t-1",
        step: 1,
        content: "你好",
        model: "m",
        finishReason: "stop",
      }),
      ev(4, "step/end", { turn: "t-1", step: 1, usage: { inputTokens: 7, outputTokens: 3 } }),
      ev(5, "turn/end", { turn: "t-1", reason: "completed" }),
    ]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({
      rowId: "a:t-1:1",
      text: "你好",
      usage: { inputTokens: 7, outputTokens: 3 },
    });
  });

  it("审批对：asked → pending 行；decided → settled + decision（toolName/argsSummary 保留）", () => {
    const p = new Projection();
    const d1 = p.ingest(
      ev(1, "approval/asked", {
        turn: "t-1",
        step: 1,
        requestId: "r-1",
        callId: "call-7",
        tool: "shell",
        argsDigest: "sha:abcd",
      }),
    );
    expect(d1).toHaveLength(1);
    expect(d1[0].op).toBe("row.appended");
    expect(p.rows[0]).toMatchObject({
      rowId: "p:r-1",
      toolName: "shell",
      callId: "call-7",
      argsSummary: "sha:abcd",
      status: "pending",
    });
    const d2 = p.ingest(
      ev(2, "approval/decided", { turn: "t-1", step: 1, requestId: "r-1", decision: "rejected" }),
    );
    expect(d2[0].op).toBe("row.upserted");
    expect(p.rows).toHaveLength(1); // upsert 原位替换，不新增
    expect(p.rows[0]).toMatchObject({ status: "settled", decision: "rejected", toolName: "shell" });
  });

  it("审批载荷透传（E6）：asked args/reason 投影原样；decided scope 保留（缺省不带键）", () => {
    const p = new Projection();
    p.ingest(
      ev(1, "approval/asked", {
        turn: "t-1",
        step: 1,
        requestId: "r-2",
        callId: "r-2",
        tool: "edit",
        argsDigest: "sha:ef01",
        args: { file_path: "f.ts", old_string: "a", new_string: "b" },
        reason: "path is outside the session workspace: X",
      }),
    );
    expect(p.rows[0]).toMatchObject({
      args: { file_path: "f.ts", old_string: "a", new_string: "b" },
      reason: "path is outside the session workspace: X",
    });
    // decided 带 scope → 保留（settled 显示「· 本会话」的数据源）；args/reason 沿用 pending 行
    p.ingest(
      ev(2, "approval/decided", {
        turn: "t-1",
        step: 1,
        requestId: "r-2",
        decision: "allowed-once",
        scope: "session",
      }),
    );
    expect(p.rows[0]).toMatchObject({
      status: "settled",
      decision: "allowed-once",
      scope: "session",
      args: { file_path: "f.ts" },
      reason: "path is outside the session workspace: X",
    });
    // 缺 scope 的 decided → 不带键（形状稳定断言）
    const q = new Projection();
    q.ingest(
      ev(1, "approval/asked", {
        turn: "t",
        step: 1,
        requestId: "r-3",
        callId: "r-3",
        tool: "bash",
        argsDigest: "d",
      }),
    );
    q.ingest(
      ev(2, "approval/decided", { turn: "t", step: 1, requestId: "r-3", decision: "rejected" }),
    );
    expect("scope" in (q.rows[0] as object)).toBe(false);
    expect("args" in (q.rows[0] as object)).toBe(false);

    // D-087：拒绝说明随 decided 投影（settled 行可展开查看）；空串不落键
    const f = new Projection();
    f.ingest(
      ev(1, "approval/asked", {
        turn: "t",
        step: 1,
        requestId: "r-4",
        callId: "r-4",
        tool: "bash",
        argsDigest: "d",
      }),
    );
    f.ingest(
      ev(2, "approval/decided", {
        turn: "t",
        step: 1,
        requestId: "r-4",
        decision: "rejected",
        feedback: "用 pnpm",
      }),
    );
    expect(f.rows[0]).toMatchObject({ decision: "rejected", feedback: "用 pnpm" });
    const g = new Projection();
    g.ingest(
      ev(1, "approval/asked", {
        turn: "t",
        step: 1,
        requestId: "r-5",
        callId: "r-5",
        tool: "bash",
        argsDigest: "d",
      }),
    );
    g.ingest(
      ev(2, "approval/decided", {
        turn: "t",
        step: 1,
        requestId: "r-5",
        decision: "rejected",
        feedback: "",
      }),
    );
    expect("feedback" in (g.rows[0] as object)).toBe(false);
  });

  it("提问对（R184）：asked → pending 行（题面自足）；settled answered/cancelled 原位 upsert；孤儿抑制", () => {
    const questions = [
      {
        id: "q1",
        question: "选哪个？",
        header: "选择",
        options: [{ label: "甲" }, { label: "乙", description: "慢但稳" }],
        multiSelect: true,
      },
    ];
    const p = new Projection();
    const d1 = p.ingest(
      ev(1, "question/asked", {
        turn: "t-1",
        step: 1,
        requestId: "r-q1",
        callId: "r-q1",
        questions,
      }),
    );
    expect(d1[0]?.op).toBe("row.appended");
    expect(p.rows[0]).toMatchObject({
      kind: "question",
      rowId: "q:r-q1",
      requestId: "r-q1",
      status: "pending",
      questions,
    });
    const d2 = p.ingest(
      ev(2, "question/settled", {
        turn: "t-1",
        step: 1,
        requestId: "r-q1",
        outcome: "answered",
        answers: [{ id: "q1", selected: ["甲"] }],
      }),
    );
    expect(d2[0]?.op).toBe("row.upserted");
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({
      status: "settled",
      outcome: "answered",
      answers: [{ id: "q1", selected: ["甲"] }],
      questions, // 题面沿用 asked（settled 不重写）
    });

    // 取消：无 answers 键
    const q = new Projection();
    q.ingest(
      ev(1, "question/asked", {
        turn: "t",
        step: 1,
        requestId: "r-q2",
        callId: "r-q2",
        questions: [{ id: "a", question: "继续？" }],
      }),
    );
    q.ingest(
      ev(2, "question/settled", {
        turn: "t",
        step: 1,
        requestId: "r-q2",
        outcome: "cancelled",
      }),
    );
    expect(q.rows[0]).toMatchObject({ status: "settled", outcome: "cancelled" });
    expect("answers" in (q.rows[0] as object)).toBe(false);

    // 孤儿 settled（无 asked 配对）不上 UI
    const o = new Projection();
    expect(
      o.ingest(
        ev(1, "question/settled", {
          turn: "t",
          step: 1,
          requestId: "r-ghost",
          outcome: "invalidated",
        }),
      ),
    ).toEqual([]);
    expect(o.rows).toHaveLength(0);
  });

  it("回合耗时（E3）：turn/end 结算事件 time 差入 state.turnTimings，delta 帧携带；cap 50 轮", () => {
    const p = new Projection();
    const mk = (
      seq: number,
      type: string,
      data: Record<string, unknown>,
      time: number,
    ): SessionEvent => ({ ...ev(seq, type, data), time }) as SessionEvent;
    p.ingest(mk(1, "turn/start", { turn: "t-1" }, 1000));
    p.ingest(mk(2, "turn/end", { turn: "t-1", reason: "completed" }, 5000));
    expect(p.state.turnTimings?.["t-1"]).toEqual({ durationMs: 4000, endedAt: 5000, forkSeq: 2 });

    // cap：第 51 轮结算后最老一轮被裁掉（键序 = 插入序）
    let seq = 3;
    for (let i = 2; i <= 52; i++) {
      const turn = `t-${i}`;
      p.ingest(mk(seq++, "turn/start", { turn }, i * 10_000));
      p.ingest(mk(seq++, "turn/end", { turn, reason: "completed" }, i * 10_000 + 2000));
    }
    const keys = Object.keys(p.state.turnTimings ?? {});
    expect(keys).toHaveLength(50);
    expect(keys.includes("t-1")).toBe(false);
    expect(keys.includes("t-52")).toBe(true);
  });

  it("无投影事件：system/message / request/header / approval/revoked / assistant/attempt 不产行不产增量（step/end 无 assistant 行时不投影）", () => {
    const p = new Projection();
    const deltas = [
      ...p.ingest(
        ev(1, "system/message", {
          turn: "t-1",
          step: 0,
          content: "You are Henira",
          key: "loop/base",
        }),
      ),
      ...p.ingest(
        ev(2, "request/header", {
          turn: "t-1",
          step: 1,
          model: "m",
          params: {},
          toolNames: [],
          systemPromptHash: "x",
        }),
      ),
      ...p.ingest(
        ev(3, "step/end", { turn: "t-1", step: 1, usage: { inputTokens: 0, outputTokens: 0 } }),
      ),
      ...p.ingest(ev(4, "approval/revoked", { turn: "t-1", step: 1, scope: "session" })),
      ...p.ingest(
        ev(5, "assistant/attempt", { turn: "t-1", step: 1, error: { code: "X", message: "y" } }),
      ),
    ];
    expect(deltas).toEqual([]);
    expect(p.rows).toEqual([]);
  });

  it("error 事件 → error 行（rowId = e:{seq}）", () => {
    const p = new Projection();
    p.ingest(ev(1, "error", { turn: "t-1", code: "LLM_STREAM", message: "boom" }));
    expect(p.rows[0]).toMatchObject({
      rowId: "e:1",
      kind: "error",
      code: "LLM_STREAM",
      message: "boom",
    });
  });
});

describe("流式直播（总线打字机碎片）", () => {
  it("首碎片建行（streaming）→ 后续碎片 row.delta → 账本落定整行替换（自愈）→ 迟到碎片丢弃", () => {
    const p = new Projection();
    p.ingest(ev(1, "step/start", { turn: "t-1", step: 3 }));
    const d1 = p.applyStreamDelta({ field: "text", text: "你" });
    expect(d1).toEqual([
      {
        op: "row.appended",
        row: expect.objectContaining({ rowId: "a:t-1:3", text: "你", streaming: true }),
      },
    ]);
    const d2 = p.applyStreamDelta({ field: "text", text: "好" });
    expect(d2).toEqual([{ op: "row.delta", rowId: "a:t-1:3", field: "text", text: "好" }]);
    expect(p.rows[0]).toMatchObject({ text: "你好", streaming: true });

    // 账本权威落定：流式累积是 "你好"，账本是 "你好，世界"——整行替换冲掉漂移
    const d3 = p.ingest(
      ev(2, "assistant/message", {
        turn: "t-1",
        step: 3,
        content: "你好，世界",
        model: "m",
        finishReason: "stop",
      }),
    );
    expect(d3).toEqual([
      {
        op: "row.upserted",
        row: expect.objectContaining({ text: "你好，世界", streaming: false }),
      },
    ]);
    expect(p.rows).toHaveLength(1); // 原位替换

    // 迟到碎片（步边界自愈后到达）→ 丢弃
    expect(p.applyStreamDelta({ field: "text", text: "x" })).toEqual([]);
    expect(p.rows[0]).toMatchObject({ text: "你好，世界" });
  });

  it("reasoning 与 text 分别挂字段", () => {
    const p = new Projection();
    p.ingest(ev(1, "step/start", { turn: "t-1", step: 1 }));
    p.applyStreamDelta({ field: "reasoning", text: "思考" });
    p.applyStreamDelta({ field: "text", text: "答" });
    expect(p.rows[0]).toMatchObject({ reasoning: "思考", text: "答", streaming: true });
  });

  it("无游标（step/start 未到）→ 碎片丢弃", () => {
    const p = new Projection();
    expect(p.applyStreamDelta({ field: "text", text: "x" })).toEqual([]);
    expect(p.rows).toEqual([]);
  });

  it("中止回合：turn/end{aborted} 冻结仍流式的 assistant 行并标 interrupted（中断可见），busy 落 false", () => {
    const p = new Projection();
    p.ingest(ev(1, "turn/start", { turn: "t-1" }));
    p.ingest(ev(2, "step/start", { turn: "t-1", step: 1 }));
    p.applyStreamDelta({ field: "text", text: "写到一半" });
    const deltas = p.ingest(ev(3, "turn/end", { turn: "t-1", reason: "aborted", cause: "user" }));
    const upserts = deltas.filter((d) => d.op === "row.upserted");
    expect(upserts).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ text: "写到一半", streaming: false, interrupted: true });
    expect(p.state.busy).toBe(false);
  });
});

describe("delta 前中止：合成零文本中断行（投影合成，账本不写事件）", () => {
  const gapLedger = () => [
    ev(1, "user/message", { turn: "t-1", step: 0, content: "写散文", source: "send" }),
    ev(2, "turn/start", { turn: "t-1" }),
    ev(3, "step/start", { turn: "t-1", step: 1 }),
    ev(4, "turn/end", { turn: "t-1", reason: "aborted", cause: "user" }),
  ];

  it("缺口复现（直播路径）：无任何碎片的中止回合合成零文本中断行，busy 落 false", () => {
    const p = new Projection();
    p.ingest(ev(1, "user/message", { turn: "t-1", step: 0, content: "写散文", source: "send" }));
    p.ingest(ev(2, "turn/start", { turn: "t-1" }));
    p.ingest(ev(3, "step/start", { turn: "t-1", step: 1 }));
    const deltas = p.ingest(ev(4, "turn/end", { turn: "t-1", reason: "aborted", cause: "user" }));
    expect(deltas.map((d) => d.op)).toEqual(["row.appended", "state.updated"]);
    expect(p.rows.map((r) => r.rowId)).toEqual(["u:1", "a:t-1:1"]);
    expect(p.rows[1]).toMatchObject({
      rowId: "a:t-1:1",
      rowSeq: 4,
      turn: "t-1",
      step: 1,
      text: "",
      streaming: false,
      interrupted: true,
    });
    expect(p.rows[1]).not.toHaveProperty("reasoning");
    expect(p.state.busy).toBe(false);
  });

  it("回放一致性：同账本 rebuild 产出同 rowId 同形状（直播与回放行深相等）", () => {
    const ledger = gapLedger();
    const live = new Projection();
    for (const e of ledger) live.ingest(e);
    const replay = rebuildProjection(ledger);
    expect(replay.rows).toEqual(live.rows);
  });

  it("正常完成回合零碎片不合成", () => {
    const p = rebuildProjection([
      ev(1, "user/message", { turn: "t-1", step: 0, content: "hi", source: "send" }),
      ev(2, "turn/start", { turn: "t-1" }),
      ev(3, "step/start", { turn: "t-1", step: 1 }),
      ev(4, "turn/end", { turn: "t-1", reason: "completed" }),
    ]);
    expect(p.rows.map((r) => r.kind)).toEqual(["user"]);
  });

  it("带流式行的中止只冻结不合成（既有行为不变）", () => {
    const p = new Projection();
    p.ingest(ev(1, "turn/start", { turn: "t-1" }));
    p.ingest(ev(2, "step/start", { turn: "t-1", step: 1 }));
    p.applyStreamDelta({ field: "text", text: "写到一半" });
    p.ingest(ev(3, "turn/end", { turn: "t-1", reason: "aborted", cause: "user" }));
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ text: "写到一半", interrupted: true });
  });

  it("目标步已有落定行（assistant/message 已落账）不覆盖", () => {
    const p = rebuildProjection([
      ev(1, "user/message", { turn: "t-1", step: 0, content: "hi", source: "send" }),
      ev(2, "turn/start", { turn: "t-1" }),
      ev(3, "step/start", { turn: "t-1", step: 1 }),
      ev(4, "assistant/message", {
        turn: "t-1",
        step: 1,
        content: "",
        model: "m",
        finishReason: "stop",
      }),
      ev(5, "turn/end", { turn: "t-1", reason: "aborted", cause: "user" }),
    ]);
    expect(p.rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
    expect(p.rows[1]).toMatchObject({ rowId: "a:t-1:1", text: "", streaming: false });
    expect(p.rows[1]).not.toHaveProperty("interrupted");
  });

  it("request/header 已记账 → 合成行附思考档（read-and-delete 同 assistant/message 语义）", () => {
    const p = new Projection();
    p.ingest(ev(1, "turn/start", { turn: "t-1" }));
    p.ingest(ev(2, "step/start", { turn: "t-1", step: 1 }));
    p.ingest(ev(3, "request/header", { turn: "t-1", step: 1, params: { reasoningEffort: "low" } }));
    p.ingest(ev(4, "turn/end", { turn: "t-1", reason: "aborted", cause: "user" }));
    expect(p.rows[0]).toMatchObject({
      rowId: "a:t-1:1",
      text: "",
      interrupted: true,
      reasoningEffort: "low",
    });
  });

  it("未见 turn/start（步号不可信）不猜不合成", () => {
    const p = new Projection();
    p.ingest(ev(1, "step/start", { turn: "t-9", step: 1 }));
    p.ingest(ev(2, "turn/end", { turn: "t-1", reason: "aborted", cause: "user" }));
    expect(p.rows).toEqual([]);
  });
});

describe("行时间投影（E4 操作行时间戳）", () => {
  it("user/assistant 落定行带 event.time；流式冻结行无权威落定无 time", () => {
    const p = new Projection();
    p.ingest(ev(1, "user/message", { turn: "t-1", step: 0, content: "问", source: "send" }, 1000));
    p.ingest(ev(2, "turn/start", { turn: "t-1" }, 1100));
    p.ingest(ev(3, "step/start", { turn: "t-1", step: 1 }, 1200));
    p.applyStreamDelta({ field: "text", text: "答到一半" });
    p.ingest(ev(4, "turn/end", { turn: "t-1", reason: "aborted", cause: "user" }, 9000));
    // user 行：落账事件时刻
    expect(p.rows[0]).toMatchObject({ rowId: "u:1", time: 1000 });
    // 流式冻结行：无权威落定 → 无 time
    expect(p.rows[1]).toMatchObject({ rowId: "a:t-1:1", text: "答到一半", interrupted: true });
    expect(p.rows[1]).not.toHaveProperty("time");
  });

  it("合成行（delta 前中止档）time = turn/end 时刻", () => {
    const p = new Projection();
    p.ingest(ev(1, "user/message", { turn: "t-1", step: 0, content: "问", source: "send" }, 1000));
    p.ingest(ev(2, "turn/start", { turn: "t-1" }, 1100));
    p.ingest(ev(3, "step/start", { turn: "t-1", step: 1 }, 1200));
    p.ingest(ev(4, "turn/end", { turn: "t-1", reason: "aborted", cause: "user" }, 9000));
    expect(p.rows[1]).toMatchObject({ rowId: "a:t-1:1", text: "", interrupted: true, time: 9000 });
  });

  it("assistant/message 落定行 time = 落账事件时刻", () => {
    const p = rebuildProjection([
      ev(1, "user/message", { turn: "t-1", step: 0, content: "问", source: "send" }, 1000),
      ev(2, "turn/start", { turn: "t-1" }, 1100),
      ev(3, "step/start", { turn: "t-1", step: 1 }, 1200),
      ev(
        4,
        "assistant/message",
        { turn: "t-1", step: 1, content: "答", model: "m", finishReason: "stop" },
        8000,
      ),
      ev(5, "turn/end", { turn: "t-1", reason: "completed" }, 8100),
    ]);
    expect(p.rows[1]).toMatchObject({ rowId: "a:t-1:1", text: "答", time: 8000 });
    expect(p.state.turnTimings?.["t-1"]).toEqual({
      durationMs: 7000,
      endedAt: 8100,
      forkSeq: 5,
    });
  });
});

describe("确定性：直播与回放 rowId 一致", () => {
  it("同一条对话，直播路径（账本 + 碎片）与纯回放路径产出相同 rowId 序列与行内容", () => {
    const ledger = [
      ev(1, "user/message", { turn: "t-1", step: 0, content: "列目录", source: "send" }),
      ev(2, "turn/start", { turn: "t-1" }),
      ev(3, "step/start", { turn: "t-1", step: 1 }),
      ev(4, "assistant/message", {
        turn: "t-1",
        step: 1,
        content: "",
        model: "m",
        finishReason: "tool-calls",
      }),
      ev(5, "tool/call", { turn: "t-1", step: 1, callId: "c1", name: "list-cwd", arguments: "{}" }),
      ev(6, "tool/result", {
        turn: "t-1",
        step: 1,
        callId: "c1",
        isError: false,
        content: "src",
        durationMs: 3,
      }),
      ev(7, "step/end", { turn: "t-1", step: 1, usage: { inputTokens: 1, outputTokens: 1 } }),
      ev(8, "step/start", { turn: "t-1", step: 2 }),
      ev(9, "assistant/message", {
        turn: "t-1",
        step: 2,
        content: "有 src",
        model: "m",
        finishReason: "stop",
      }),
      ev(10, "turn/end", { turn: "t-1", reason: "completed" }),
    ];
    // 回放路径
    const replay = rebuildProjection(ledger);
    // 直播路径：逐条 ingest，step 1 期间喂打字机碎片（先于账本落定到达）
    const live = new Projection();
    for (const e of ledger) {
      live.ingest(e);
      if (e.type === "step/start") live.applyStreamDelta({ field: "text", text: "(碎片)" });
    }
    expect(live.rows.map((r) => r.rowId)).toEqual(replay.rows.map((r) => r.rowId));
    expect(live.rows).toEqual(replay.rows);
  });

  it("同一 step 多条 steer → u:{seq} 各自成行不冲突", () => {
    const p = rebuildProjection([
      ev(1, "user/message", { turn: "t-1", step: 0, content: "主问", source: "send" }),
      ev(2, "turn/start", { turn: "t-1" }),
      ev(3, "step/start", { turn: "t-1", step: 1 }),
      ev(4, "user/message", { turn: "t-1", step: 1, content: "插话一", source: "steer" }),
      ev(5, "user/message", { turn: "t-1", step: 1, content: "插话二", source: "steer" }),
    ]);
    expect(p.rows.map((r) => r.rowId)).toEqual(["u:1", "u:4", "u:5"]);
  });
});

describe("surfaceOp replace 与重建", () => {
  it("replace 标记可检出；rebuildProjection 从全账本折叠出一致投影", () => {
    const replaced = ev(9, "user/message", {
      turn: "t-1",
      step: 0,
      content: "改写后",
      source: "send",
      surfaceOp: { op: "replace", startSeq: 1, endSeq: 1 },
    });
    expect(isReplaceSurface(replaced)).toBe(true);
    expect(
      isReplaceSurface(
        ev(1, "user/message", { turn: "t-1", step: 0, content: "普通", source: "send" }),
      ),
    ).toBe(false);
    const p = rebuildProjection([replaced]);
    expect(p.rows[0]).toMatchObject({ text: "改写后" });
  });
});

describe("思考档投影（request/header.params → assistant 行）", () => {
  it("params.reasoningEffort 记账 → 同步 assistant 行带档位；无 params 行不带字段", () => {
    const p = rebuildProjection([
      ev(1, "user/message", { turn: "t-1", step: 0, content: "问", source: "send" }),
      ev(2, "turn/start", { turn: "t-1" }),
      ev(3, "step/start", { turn: "t-1", step: 1 }),
      ev(4, "request/header", {
        turn: "t-1",
        step: 1,
        model: "zhipu/glm-5",
        params: { reasoningEffort: "high" },
        toolNames: [],
        systemPromptHash: "x",
      }),
      ev(5, "assistant/message", {
        turn: "t-1",
        step: 1,
        content: "答",
        model: "zhipu/glm-5",
        finishReason: "stop",
      }),
      ev(6, "turn/end", { turn: "t-1", reason: "completed" }),
    ]);
    expect(p.rows[1]).toMatchObject({ rowId: "a:t-1:1", reasoningEffort: "high" });

    const q = rebuildProjection([
      ev(1, "user/message", { turn: "t-2", step: 0, content: "问", source: "send" }),
      ev(2, "turn/start", { turn: "t-2" }),
      ev(3, "step/start", { turn: "t-2", step: 1 }),
      ev(4, "request/header", {
        turn: "t-2",
        step: 1,
        model: "m",
        params: {},
        toolNames: [],
        systemPromptHash: "x",
      }),
      ev(5, "assistant/message", {
        turn: "t-2",
        step: 1,
        content: "答",
        model: "m",
        finishReason: "stop",
      }),
    ]);
    expect(q.rows[1]).not.toHaveProperty("reasoningEffort"); // 未指定 = 无字段（缺省语义）
  });

  it("step/end 用量 upsert 不冲掉档位（{...existing} 保字段）；不同步各自归位", () => {
    const p = rebuildProjection([
      ev(1, "user/message", { turn: "t-1", step: 0, content: "问", source: "send" }),
      ev(2, "turn/start", { turn: "t-1" }),
      ev(3, "step/start", { turn: "t-1", step: 1 }),
      ev(4, "request/header", {
        turn: "t-1",
        step: 1,
        model: "m",
        params: { reasoningEffort: "low" },
        toolNames: [],
        systemPromptHash: "x",
      }),
      ev(5, "assistant/message", {
        turn: "t-1",
        step: 1,
        content: "答",
        model: "m",
        finishReason: "stop",
      }),
      ev(6, "step/end", { turn: "t-1", step: 1, usage: { inputTokens: 2, outputTokens: 1 } }),
    ]);
    expect(p.rows[1]).toMatchObject({ usage: { inputTokens: 2 }, reasoningEffort: "low" });
    // 消费后不积账：同 turn:step 再落 assistant 行（畸形序）也不带旧档
    const again = p.ingest(
      ev(7, "assistant/message", {
        turn: "t-1",
        step: 1,
        content: "再答",
        model: "m",
        finishReason: "stop",
      }),
    );
    expect(
      (again[0] as { row?: { reasoningEffort?: string } }).row?.reasoningEffort,
    ).toBeUndefined();
  });
});

describe("重启收口投影（R175）", () => {
  it("approval/invalidated：pending 行翻 settled 痕迹行 decision=invalidated（字段回填同 decided）；孤儿抑制", () => {
    const p = new Projection();
    p.ingest(
      ev(1, "approval/asked", {
        turn: "t-1",
        step: 1,
        requestId: "r-1",
        callId: "r-1",
        tool: "bash",
        argsDigest: "sha:abcd",
        args: { command: "ls" },
        reason: "fence",
      }),
    );
    const d = p.ingest(
      ev(2, "approval/invalidated", { turn: "t-1", step: 1, requestId: "r-1" }, 900),
    );
    expect(d).toHaveLength(1);
    expect(d[0].op).toBe("row.upserted");
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({
      rowId: "p:r-1",
      status: "settled",
      decision: "invalidated",
      toolName: "bash",
      argsSummary: "sha:abcd",
      args: { command: "ls" },
      reason: "fence",
    });
    // 孤儿（无 asked 配对）不上 UI（R165 同款抑制）
    const p2 = new Projection();
    expect(
      p2.ingest(ev(1, "approval/invalidated", { turn: "t", step: 1, requestId: "r-x" })),
    ).toEqual([]);
    expect(p2.rows).toHaveLength(0);
  });

  it("turn/end{interrupted}（重启收口补写）：冻结流式行带 interrupted+interruptedKind、busy/busySince 清、轮耗时定格补写 time", () => {
    const events = [
      ev(1, "user/message", { turn: "t-1", step: 0, content: "hi", source: "send" }, 1_000),
      ev(2, "turn/start", { turn: "t-1" }, 1_200),
      ev(3, "step/start", { turn: "t-1", step: 1 }),
      ev(
        4,
        "assistant/message",
        {
          turn: "t-1",
          step: 1,
          content: "部分文本",
          model: "m",
          finishReason: "tool-calls",
        },
        1_500,
      ),
      ev(5, "turn/end", { turn: "t-1", reason: "interrupted" }, 2_000), // 开档补写形状
    ];
    const p = rebuildProjection(events);
    expect(p.state.busy).toBe(false);
    expect(p.state.busySince).toBeUndefined();
    const row = p.rows.find((r) => r.kind === "assistant") as {
      interrupted?: boolean;
      interruptedKind?: string;
      streaming?: boolean;
    };
    expect(row.interrupted).toBe(true);
    expect(row.interruptedKind).toBe("restart"); // 徽章文案「已中断（服务重启）」
    expect(row.streaming).toBe(false);
    const timing = p.state.turnTimings?.["t-1"];
    expect(timing?.endedAt).toBe(2_000); // 补写 time 定格死亡时刻（不发明空洞时长）
  });

  it("turn/end{interrupted} 零文本合成行（delta 前死亡——流式行从未创建）：合成带 interruptedKind", () => {
    const p = rebuildProjection([
      ev(1, "user/message", { turn: "t-1", step: 0, content: "hi", source: "send" }, 1_000),
      ev(2, "turn/start", { turn: "t-1" }, 1_200),
      ev(3, "step/start", { turn: "t-1", step: 1 }),
      ev(4, "turn/end", { turn: "t-1", reason: "interrupted" }, 2_000),
    ]);
    const rows = p.rows.filter((r) => r.kind === "assistant");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowId: "a:t-1:1",
      text: "",
      interrupted: true,
      interruptedKind: "restart",
    });
    expect(p.state.busy).toBe(false);
  });
});
