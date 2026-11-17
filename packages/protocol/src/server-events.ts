// server → 客户端唯一词表（interfaces.md server 段定稿 2026-11-17）。
// 行模型核心与 ZCode 同构（取证 2026-11-16/17）：投影行 + 封闭增量 + snapshot/resync——
// 行 = 自包含 UI 单元，rowId 会话内单调唯一、账本事实的确定性函数（回放重建 rowId 不变）；
// 客户端断档不猜：seq 跳号 → 重拉快照，永不猜中间态。事件→UI 的组装逻辑收敛在 server
// 投影器一份（客户端零 reducer——可嵌入 D-037 与跨端一致的前提）。
// 纯 DTO：运行时零依赖（packages.md 规则 1）；Decision 复用 approval 词表。

import type { Decision } from "./approval.js";
import type { TokenUsage } from "./llm.js";

/** 行标识：`a:{turn}:{step}` / `t:{turn}:{step}:{callId}` / `u:{seq}` / `p:{requestId}` / `e:{seq}` */
export type RowId = string;

export interface UserRow {
  kind: "user";
  rowId: RowId;
  turn: string;
  text: string;
  /** 账本 user/message.source 原样（send / steer / veto / …开放词表） */
  source: string;
}

export interface AssistantRow {
  kind: "assistant";
  rowId: RowId;
  turn: string;
  step: number;
  text: string;
  reasoning?: string;
  /** true = 流式中（后续还有 row.delta / row.upserted）；false = 账本权威已落定 */
  streaming: boolean;
  model?: string;
  finishReason?: string;
  /** 步级用量（step/end 落账投影；词表同 llm 槽位 TokenUsage） */
  usage?: TokenUsage;
  /** true = 该步被中断掐停（turn/end{reason:"aborted"} 投影；部分文本定格，无权威落定） */
  interrupted?: boolean;
}

export interface ToolRowOutput {
  content: string;
  isError: boolean;
  durationMs: number;
  /** 输出超限截断（tools 管线结算原样透传；preview 供 UI 展示头部，path 指完整输出落盘文件） */
  truncated?: { path: string; preview: string };
}

export interface ToolRow {
  kind: "tool";
  rowId: RowId;
  turn: string;
  step: number;
  callId: string;
  name: string;
  status: "running" | "done" | "error";
  /** 模型原始 argsText（P3-1 对偶） */
  input: string;
  output?: ToolRowOutput;
}

export interface ApprovalRow {
  kind: "approval";
  rowId: RowId;
  turn: string;
  step: number;
  requestId: string;
  toolName: string;
  /** argsDigest（账本原样——摘要不原文，凭据纪律 D-030） */
  argsSummary?: string;
  status: "pending" | "settled";
  decision?: Decision;
}

export interface ErrorRow {
  kind: "error";
  rowId: RowId;
  turn?: string;
  code?: string;
  message: string;
}

export type Row = UserRow | AssistantRow | ToolRow | ApprovalRow | ErrorRow;

/** 会话级状态（键级整体替换，键内绝不深合并——封闭增量语法的 state.updated 载荷） */
export interface SessionState {
  /** turn/start … turn/end 之间 */
  busy: boolean;
  lastTurnId?: string;
}

export interface SessionSnapshot {
  sessionId: string;
  /** 该会话当前水位（此后增量帧 seq 单调 +1） */
  seq: number;
  rows: Row[];
  state: SessionState;
}

/** 封闭增量语法（4 操作）——结构变化换整行、文本增长用增量；表达不了的结构变化 → 整体快照 */
export type Delta =
  | { op: "row.appended"; row: Row }
  | { op: "row.delta"; rowId: RowId; field: "text" | "reasoning"; text: string }
  | { op: "row.upserted"; row: Row }
  | { op: "state.updated"; state: SessionState };

/** SSE 帧信封（GET /api/events；帧序 = connected → 逐会话快照帧 → 增量帧混排） */
export type ServerFrame =
  | { kind: "connected"; server: { version: string; startedAt: number } }
  | { kind: "snapshot"; sessionId: string; snapshot: SessionSnapshot }
  | { kind: "delta"; sessionId: string; seq: number; delta: Delta };

export interface SessionSummary {
  id: string;
  cwd: string;
  title?: string;
  updatedAt: number;
  busy: boolean;
}

/** prompt 端点回执：D-045 单口——闲直跑（id=null）/ 忙入队（id=排队条目） */
export interface PromptReceipt {
  queued: boolean;
  id: string | null;
}
