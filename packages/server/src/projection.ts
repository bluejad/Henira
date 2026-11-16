// 账本→行投影器（interfaces.md server 段定稿）：事件→UI 的组装逻辑唯一实现处，客户端零
// reducer——可嵌入（D-037）与跨端一致的前提。行模型核心与 ZCode 同构：行 = 自包含 UI 单元，
// rowId 由账本事实确定性派生（回放重建 rowId 不变），封闭增量 4 操作，断档不猜。
// 两路喂法共用同一套行构造逻辑：①账本回放（历史 / 断线重建 / surfaceOp replace 全量重建——
// 快照永远从真相重建，自愈）；②流式增量（总线 loop/event 打字机碎片，挂到当前流式 assistant 行）。
// 步边界自愈：assistant/message / tool/result / approval/decided 落账即整行替换，冲掉流式漂移。

import type {
  ApprovalRow,
  AssistantRow,
  Delta,
  Row,
  RowId,
  SessionEvent,
  SessionState,
  ToolRow,
  UserRow,
} from "@henira/protocol";

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
  /** 当前步游标（账本 step/start 维护；流式碎片以此挂行） */
  private cursor: { turn?: string; step?: number } = {};
  /** 仍处于流式态的 assistant 行（按 turn 分组；turn/end 冻结用） */
  private readonly streamingByTurn = new Map<string, Set<RowId>>();

  /** 账本事件逐条喂入；返回可见变化（空数组 = 投影不变） */
  ingest(event: SessionEvent): Delta[] {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case "user/message": {
        const row: UserRow = {
          kind: "user",
          rowId: rowId.user(event.seq),
          turn: data.turn as string,
          text: data.content as string,
          source: data.source as string,
        };
        this.push(row);
        return [{ op: "row.appended", row }];
      }
      case "turn/start": {
        const turn = data.turn as string;
        this.cursor = { turn, step: 0 };
        if (this.state.busy && this.state.lastTurnId === turn) return [];
        this.state.busy = true;
        this.state.lastTurnId = turn;
        return [{ op: "state.updated", state: { ...this.state } }];
      }
      case "turn/end": {
        const turn = data.turn as string;
        const deltas: Delta[] = [];
        // 中止 / 出错的回合：仍处流式态的 assistant 行冻结（部分文本定格，无权威落定）
        const pending = this.streamingByTurn.get(turn);
        if (pending) {
          for (const id of pending) {
            const row = this.byId.get(id);
            if (row?.kind === "assistant" && row.streaming) {
              row.streaming = false;
              deltas.push({ op: "row.upserted", row: { ...row } });
            }
          }
          this.streamingByTurn.delete(turn);
        }
        this.cursor = {};
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
      case "assistant/message": {
        const row: AssistantRow = {
          kind: "assistant",
          rowId: rowId.assistant(data.turn as string, data.step as number),
          turn: data.turn as string,
          step: data.step as number,
          text: data.content as string,
          reasoning: data.reasoning as string | undefined,
          streaming: false,
          model: data.model as string | undefined,
          finishReason: data.finishReason as string | undefined,
        };
        return [this.upsert(row)];
      }
      case "tool/call": {
        const row: ToolRow = {
          kind: "tool",
          rowId: rowId.tool(data.turn as string, data.step as number, data.callId as string),
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
        const row: ToolRow = {
          kind: "tool",
          rowId: id,
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
          turn: data.turn as string,
          step: data.step as number,
          requestId: data.requestId as string,
          toolName: data.tool as string,
          argsSummary: data.argsDigest as string,
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
          turn: data.turn as string,
          step: data.step as number,
          requestId,
          toolName: "",
          status: "settled",
          decision,
        };
        const existing = this.byId.get(row.rowId);
        if (existing?.kind === "approval") {
          row.toolName = existing.toolName;
          row.argsSummary = existing.argsSummary;
        }
        return [this.upsert(row)];
      }
      case "error": {
        const row: Row = {
          kind: "error",
          rowId: rowId.error(event.seq),
          turn: data.turn as string | undefined,
          code: data.code as string | undefined,
          message: data.message as string,
        };
        this.push(row);
        return [{ op: "row.appended", row }];
      }
      default:
        // system/message（基底块不渲染）/ request/header / step/end / approval/revoked /
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

  /** 快照（初始渲染 + 断档重拉共用一出口）：rows 深拷贝 + 会话级状态；seq 由扇出层给当前水位 */
  snapshot(sessionId: string, seq: number) {
    return {
      sessionId,
      seq,
      rows: structuredClone(this.rows),
      state: { ...this.state },
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

/** 全账本重建（surfaceOp replace / 断线兜底）：从空投影顺序折叠——快照永远从真相重建 */
export function rebuildProjection(events: readonly SessionEvent[]): Projection {
  const projection = new Projection();
  for (const event of events) projection.ingest(event);
  return projection;
}
