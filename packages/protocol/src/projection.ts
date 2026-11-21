// 账本→行投影器（interfaces.md server 段定稿）：事件→UI 的组装逻辑唯一实现处，客户端零
// reducer——可嵌入（D-037）与跨端一致的前提。行模型核心与 ZCode 同构：行 = 自包含 UI 单元，
// rowId 由账本事实确定性派生（回放重建 rowId 不变），封闭增量 4 操作，断档不猜。
// 两路喂法共用同一套行构造逻辑：①账本回放（历史 / 断线重建 / surfaceOp replace 全量重建——
// 快照永远从真相重建，自愈）；②流式增量（总线 loop/event 打字机碎片，挂到当前流式 assistant 行）。
// 步边界自愈：assistant/message / tool/result / approval/decided 落账即整行替换，冲掉流式漂移。

import type { SessionEvent } from "./envelope.js";
import type { ReasoningEffort, TokenUsage } from "./llm.js";
import type {
  ApprovalRow,
  AssistantRow,
  Delta,
  Row,
  RowId,
  SessionState,
  ToolRow,
  ToolRowOutput,
  UserRow,
} from "./server-events.js";

/** rowId 全部由账本事实确定性派生——直播路径与回放路径产出完全一致的标识 */
const rowId = {
  user: (seq: number): RowId => `u:${seq}`,
  assistant: (turn: string, step: number): RowId => `a:${turn}:${step}`,
  tool: (turn: string, step: number, callId: string): RowId => `t:${turn}:${step}:${callId}`,
  approval: (requestId: string): RowId => `p:${requestId}`,
  error: (seq: number): RowId => `e:${seq}`,
};

/** surfaceOp replace（P2 降级 / fork）：命中即投影失效，调用方须以全账本重建（rebuildProjection） */
export function isReplaceSurface(event: SessionEvent): boolean {
  const data = event.data as { surfaceOp?: { op?: string } } | undefined;
  return data?.surfaceOp?.op === "replace";
}

/**
 * 投影状态机：ingest（账本事件）/ applyStreamDelta（打字机碎片）逐条喂入并返回产生的
 * 增量（扇出层据此编 seq 发帧）；snapshot 随时可取（断线重建与初始渲染共用一出口）。
 * 不是纯对象——状态内聚，但喂法确定性：同一事件序列产出同一投影（确定性有测试锁定）。
 */
export class Projection {
  /** 追加序行列表（快照即它的深拷贝 + 会话级状态） */
  readonly rows: Row[] = [];
  readonly state: SessionState = { busy: false };
  private readonly byId = new Map<RowId, Row>();
  /** 已见最大账本事件 seq（流式行 rowSeq 基座——排序上位于全部已落账行之后） */
  #lastSeq = 0;
  /** 当前步游标（账本 step/start 维护；流式碎片以此挂行） */
  private cursor: { turn?: string; step?: number } = {};
  /** 仍处于流式态的 assistant 行（按 turn 分组；turn/end 冻结用） */
  private readonly streamingByTurn = new Map<string, Set<RowId>>();
  /** 各步实际生效思考档（request/header.params 记账 → 同步 assistant 行投影） */
  private readonly effortByStep = new Map<string, ReasoningEffort>();
  /** 回合开始时间（E3 回合头：turn/start 的账本 time → turn/end 结算 durationMs） */
  private readonly turnStartTimes = new Map<string, number>();

  /** 账本事件逐条喂入；返回可见变化（空数组 = 投影不变） */
  ingest(event: SessionEvent): Delta[] {
    this.#lastSeq = Math.max(this.#lastSeq, event.seq);
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case "user/message": {
        const row: UserRow = {
          kind: "user",
          rowId: rowId.user(event.seq),
          rowSeq: event.seq,
          turn: data.turn as string,
          text: data.content as string,
          source: data.source as string,
          time: event.time,
        };
        this.push(row);
        return [{ op: "row.appended", row }];
      }
      case "turn/start": {
        const turn = data.turn as string;
        this.cursor = { turn, step: 0 };
        this.turnStartTimes.set(turn, event.time); // E3 回合头：开始时戳（事件自带 time）
        if (this.state.busy && this.state.lastTurnId === turn) return [];
        this.state.busy = true;
        this.state.lastTurnId = turn;
        return [{ op: "state.updated", state: { ...this.state } }];
      }
      case "turn/end": {
        const turn = data.turn as string;
        const reason = data.reason as string | undefined;
        const deltas: Delta[] = [];
        // 中止 / 出错的回合：仍处流式态的 assistant 行冻结（部分文本定格，无权威落定）；
        // 中止回合在冻结行上标 interrupted（中断可见性——行上唯一痕迹，M4 批 A 判据③）
        const pending = this.streamingByTurn.get(turn);
        if (pending) {
          for (const id of pending) {
            const row = this.byId.get(id);
            if (row?.kind === "assistant" && row.streaming) {
              row.streaming = false;
              if (reason === "aborted") row.interrupted = true;
              deltas.push({ op: "row.upserted", row: { ...row } });
            }
          }
          this.streamingByTurn.delete(turn);
        }
        // 首个碎片前中止（delta 前中止档）：流式行从未创建，回合零痕迹——按当前步合成一条
        // 零文本中断行。rowId 从账本事实派生（回放重建同形）；合成只进投影，账本不写事件。
        // 步号不可信（未见 turn/start）或目标步已有落定行时不猜、不覆盖。
        const step = this.cursor.turn === turn ? this.cursor.step : undefined;
        if (
          reason === "aborted" &&
          !pending &&
          step !== undefined &&
          !this.byId.has(rowId.assistant(turn, step))
        ) {
          const effortKey = `${turn}:${step}`;
          const effort = this.effortByStep.get(effortKey);
          this.effortByStep.delete(effortKey);
          const row: AssistantRow = {
            kind: "assistant",
            rowId: rowId.assistant(turn, step),
            rowSeq: this.#lastSeq,
            turn,
            step,
            text: "",
            streaming: false,
            interrupted: true,
            ...(effort !== undefined ? { reasoningEffort: effort } : {}),
            time: event.time,
          };
          this.push(row);
          deltas.push({ op: "row.appended", row });
        }
        this.cursor = {};
        // 回合耗时结算（E3 回合头，事件时间戳取数）：保留最近 50 轮
        const startedAt = this.turnStartTimes.get(turn);
        this.turnStartTimes.delete(turn);
        if (startedAt !== undefined) {
          const timings = { ...(this.state.turnTimings ?? {}) };
          const keys = Object.keys(timings);
          if (keys.length >= 50) {
            for (const key of keys.slice(0, keys.length - 49)) delete timings[key];
          }
          timings[turn] = {
            durationMs: Math.max(1000, event.time - startedAt),
            endedAt: event.time, // 轮尾时间戳（E4 操作行）
            forkSeq: event.seq, // 轮尾 fork 的账本切点（E4——前缀复制 inclusive）
          };
          this.state.turnTimings = timings;
        }
        if (this.state.busy) {
          this.state.busy = false;
          deltas.push({ op: "state.updated", state: { ...this.state } });
        }
        return deltas;
      }
      case "step/start": {
        this.cursor = { turn: data.turn as string, step: data.step as number };
        return [];
      }
      case "request/header": {
        // 实际生效思考档记账（loop 落账 → assistant 行投影；无档不记）
        const effort = (data.params as { reasoningEffort?: ReasoningEffort } | undefined)
          ?.reasoningEffort;
        if (effort !== undefined) {
          this.effortByStep.set(`${data.turn as string}:${data.step as number}`, effort);
        }
        return [];
      }
      case "assistant/message": {
        const turn = data.turn as string;
        const step = data.step as number;
        const effort = this.effortByStep.get(`${turn}:${step}`);
        this.effortByStep.delete(`${turn}:${step}`); // 读后即弃（长会话不积账）
        const row: AssistantRow = {
          kind: "assistant",
          rowId: rowId.assistant(turn, step),
          rowSeq: event.seq,
          turn,
          step,
          text: data.content as string,
          reasoning: data.reasoning as string | undefined,
          streaming: false,
          model: data.model as string | undefined,
          finishReason: data.finishReason as string | undefined,
          ...(effort !== undefined ? { reasoningEffort: effort } : {}),
          time: event.time,
        };
        return [this.upsert(row)];
      }
      case "tool/call": {
        const row: ToolRow = {
          kind: "tool",
          rowId: rowId.tool(data.turn as string, data.step as number, data.callId as string),
          rowSeq: event.seq,
          turn: data.turn as string,
          step: data.step as number,
          callId: data.callId as string,
          name: data.name as string,
          status: "running",
          input: data.arguments as string,
        };
        return [this.upsert(row)];
      }
      case "tool/result": {
        const id = rowId.tool(data.turn as string, data.step as number, data.callId as string);
        const isError = data.isError as boolean;
        const truncated = data.truncated as ToolRowOutput["truncated"] | undefined;
        const meta = data.meta as ToolRowOutput["meta"] | undefined;
        const row: ToolRow = {
          kind: "tool",
          rowId: id,
          rowSeq: event.seq,
          turn: data.turn as string,
          step: data.step as number,
          callId: data.callId as string,
          name: "", // 落定时 name 未知则由已有行保留；孤儿结果兜底为空串
          status: isError ? "error" : "done",
          input: "",
          output: {
            content: data.content as string,
            isError,
            durationMs: data.durationMs as number,
            ...(truncated !== undefined ? { truncated } : {}),
            ...(meta !== undefined ? { meta } : {}),
          },
        };
        const existing = this.byId.get(id);
        if (existing?.kind === "tool") {
          row.name = existing.name;
          row.input = existing.input;
        }
        return [this.upsert(row)];
      }
      case "approval/asked": {
        const row: ApprovalRow = {
          kind: "approval",
          rowId: rowId.approval(data.requestId as string),
          rowSeq: event.seq,
          turn: data.turn as string,
          step: data.step as number,
          requestId: data.requestId as string,
          toolName: data.tool as string,
          argsSummary: data.argsDigest as string,
          // args/reason 完整原样透传（E6，D-046 归位——透传不解释，预览窄化归 UI）
          ...(data.args !== undefined ? { args: data.args as ApprovalRow["args"] } : {}),
          ...(data.reason !== undefined ? { reason: data.reason as string } : {}),
          status: "pending",
        };
        this.push(row);
        return [{ op: "row.appended", row }];
      }
      case "approval/decided": {
        const requestId = data.requestId as string;
        const decision = data.decision as ApprovalRow["decision"];
        const row: ApprovalRow = {
          kind: "approval",
          rowId: rowId.approval(requestId),
          rowSeq: event.seq,
          turn: data.turn as string,
          step: data.step as number,
          requestId,
          toolName: "",
          status: "settled",
          decision,
          ...(data.scope === "session" ? { scope: "session" as const } : {}),
        };
        const existing = this.byId.get(row.rowId);
        if (existing?.kind !== "approval") {
          // 孤儿 decided（无 asked 配对——默认放行层/规则层/会话折叠的审计）不上 UI：
          // 自动放行的工具调用不该在对话流里留「权限请求 allowed-once」噪音行（E3 实锤：
          // 每个安全工具一张幽灵行既污染流又切断相邻聚合组）；审计住账本不丢。
          return [];
        }
        row.toolName = existing.toolName;
        row.argsSummary = existing.argsSummary;
        if (existing.args !== undefined) row.args = existing.args;
        if (existing.reason !== undefined) row.reason = existing.reason;
        return [this.upsert(row)];
      }
      case "error": {
        const row: Row = {
          kind: "error",
          rowId: rowId.error(event.seq),
          rowSeq: event.seq,
          turn: data.turn as string | undefined,
          code: data.code as string | undefined,
          message: data.message as string,
        };
        this.push(row);
        return [{ op: "row.appended", row }];
      }
      case "step/end": {
        // 步级用量投影：挂到该步 assistant 行（assistant/message 已先落账，行必在）。
        // usage 在账本必填（validators）；无行（畸形序）静默忽略。
        const usage = data.usage as TokenUsage | undefined;
        if (usage === undefined) return [];
        const id = rowId.assistant(data.turn as string, data.step as number);
        const existing = this.byId.get(id);
        if (existing?.kind !== "assistant") return [];
        const row: AssistantRow = { ...existing, usage };
        return [this.upsert(row)];
      }
      default:
        // system/message（基底块不渲染）/ request/header / approval/revoked /
        // assistant/attempt（M5 重试机随批投影）/ 插件 ignorable 事件——投影为空。
        // 功能面行类型随各自功能批加法生长（interfaces.md 备考）。
        return [];
    }
  }

  /** 总线打字机碎片（刻意不落账的流式增量）：挂到当前流式 assistant 行；已落定的行丢弃迟到碎片 */
  applyStreamDelta(delta: { field: "text" | "reasoning"; text: string }): Delta[] {
    const { turn, step } = this.cursor;
    if (turn === undefined || step === undefined) return [];
    const id = rowId.assistant(turn, step);
    const existing = this.byId.get(id);
    if (existing !== undefined) {
      if (existing.kind !== "assistant") return []; // 防御：同 id 非助手行，碎片丢弃
      if (!existing.streaming) return []; // 步边界自愈后的迟到碎片
      if (delta.field === "text") existing.text += delta.text;
      else existing.reasoning = (existing.reasoning ?? "") + delta.text;
      return [{ op: "row.delta", rowId: id, field: delta.field, text: delta.text }];
    }
    const row: AssistantRow = {
      kind: "assistant",
      rowId: id,
      rowSeq: this.#lastSeq, // 流式行未落账：取已见最大 seq（排序上仍在全部已落账行之后）
      turn,
      step,
      text: delta.field === "text" ? delta.text : "",
      reasoning: delta.field === "reasoning" ? delta.text : undefined,
      streaming: true,
    };
    this.push(row);
    this.markStreaming(turn, id);
    return [{ op: "row.appended", row }];
  }

  /** 快照（初始渲染 + 断档重拉共用一出口）：rows 深拷贝 + 会话级状态；seq 由扇出层给当前水位。
   *  tailRows 传了即窗口化（长会话只回尾部窗口，历史经 rows 翻页拉取）；不传 = 全量（向后兼容） */
  snapshot(sessionId: string, seq: number, opts?: { tailRows?: number }) {
    const all = this.rows;
    const tail = opts?.tailRows;
    const sliced = tail !== undefined && all.length > tail;
    return {
      sessionId,
      seq,
      rows: sliced
        ? structuredClone(all.slice(all.length - (tail as number)))
        : structuredClone(all),
      state: { ...this.state },
      hasOlder: sliced,
      totalRows: all.length,
    };
  }

  private push(row: Row): void {
    this.rows.push(row);
    this.byId.set(row.rowId, row);
  }

  /** 落定 / 迁移 = 整行替换（步边界自愈的机制本体） */
  private upsert(row: Row): Delta {
    const existing = this.byId.get(row.rowId);
    if (existing === undefined) {
      this.push(row);
      if (row.kind === "assistant" && row.streaming) {
        this.markStreaming(row.turn, row.rowId);
      }
      return { op: "row.appended", row };
    }
    // 原位替换保留追加序（列表下标不变）
    const index = this.rows.indexOf(existing);
    this.rows[index] = row;
    this.byId.set(row.rowId, row);
    return { op: "row.upserted", row };
  }

  private markStreaming(turn: string, id: RowId): void {
    let set = this.streamingByTurn.get(turn);
    if (set === undefined) {
      set = new Set();
      this.streamingByTurn.set(turn, set);
    }
    set.add(id);
  }
}

/** 行翻页单页（GET /api/sessions/:id/rows 与 sdk 门面 sessionRows 的共同载荷形状） */
export interface RowsPage {
  rows: Row[];
  /** true = 本页首行之前还有历史（继续翻页直到 false） */
  hasOlder: boolean;
}

/** 行列表翻页（rows 端点 / sdk runtime / 前端 loadOlder 合并守卫共用一份——投影域共享知识）：
 *  beforeSeq 排他（返回 rowSeq < before 的行段尾部 limit 行；缺省 = 尾部 limit 行）；
 *  页首向前补齐到轮边界（turn 相同行不切散——页不切轮，dsh turnWindow 同思想）。
 *  行列表 append-only（投影不删行不重排），rowSeq 沿追加序单调不减——切片确定性成立。 */
export function sliceRowsPage(
  rows: readonly Row[],
  beforeSeq: number | undefined,
  limit: number,
): RowsPage {
  let end: number;
  if (beforeSeq === undefined) {
    end = rows.length;
  } else {
    // 找第一个 rowSeq >= beforeSeq 的下标（排他上界）——行按 rowSeq 单调不减可线性扫
    end = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r: Row | undefined = rows[i];
      if (r !== undefined && r.rowSeq >= beforeSeq) {
        end = i;
        break;
      }
    }
  }
  const start0 = Math.max(0, end - limit);
  // 轮边界补齐：页首行若属某轮，把同轮更早行全部收进本页
  let start = start0;
  const headTurn = rows[start]?.turn;
  if (headTurn !== undefined) {
    while (start > 0 && rows[start - 1]?.turn === headTurn) start--;
  }
  return {
    rows: rows.slice(start, end),
    hasOlder: start > 0,
  };
}

/** 全账本重建（surfaceOp replace / 断线兜底）：从空投影顺序折叠——快照永远从真相重建 */
export function rebuildProjection(events: readonly SessionEvent[]): Projection {
  const projection = new Projection();
  for (const event of events) projection.ingest(event);
  return projection;
}
