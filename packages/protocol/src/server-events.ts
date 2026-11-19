// server → 客户端唯一词表（interfaces.md server 段定稿 2026-11-17）。
// 行模型核心与 ZCode 同构（取证 2026-11-16/17）：投影行 + 封闭增量 + snapshot/resync——
// 行 = 自包含 UI 单元，rowId 会话内单调唯一、账本事实的确定性函数（回放重建 rowId 不变）；
// 客户端断档不猜：seq 跳号 → 重拉快照，永不猜中间态。事件→UI 的组装逻辑收敛在 server
// 投影器一份（客户端零 reducer——可嵌入 D-037 与跨端一致的前提）。
// 纯 DTO：运行时零依赖（packages.md 规则 1）；Decision 复用 approval 词表。

import type { Decision } from "./approval.js";
import type { ReasoningEffort, TokenUsage } from "./llm.js";

/** 行标识：`a:{turn}:{step}` / `t:{turn}:{step}:{callId}` / `u:{seq}` / `p:{requestId}` / `e:{seq}` */
export type RowId = string;

export interface UserRow {
  kind: "user";
  rowId: RowId;
  /** 产生该行的账本事件 seq（翻页游标基座——会话内单调，同事件多行同 seq） */
  rowSeq: number;
  turn: string;
  text: string;
  /** 账本 user/message.source 原样（send / steer / veto / …开放词表） */
  source: string;
}

export interface AssistantRow {
  kind: "assistant";
  rowId: RowId;
  rowSeq: number;
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
  /** 本步实际生效思考档（request/header.params 投影——行上可见每次提问档位语义） */
  reasoningEffort?: ReasoningEffort;
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
  rowSeq: number;
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
  rowSeq: number;
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
  rowSeq: number;
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
  /** 该会话当前水位（此后增量帧 seq 单调 +1）——增量帧只动尾部窗口内的行 */
  seq: number;
  /** 尾部窗口（长会话分页：全量行超出 tailRows 时只含最近段——历史经 rows 翻页拉取） */
  rows: Row[];
  state: SessionState;
  /** true = 窗口首行之前还有历史（配 GET /api/sessions/:id/rows 翻页） */
  hasOlder: boolean;
  /** 全序行数（滚动条长度估计用；不随窗口化变化） */
  totalRows: number;
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

/** 登记工作目录（data-directory §4 projects.json 条目——权威工作区列表，可自愈复活） */
export interface RegisteredDir {
  /** sha256(canonical cwd) 前 16 位（大小写归一后） */
  id: string;
  cwd: string;
  /** §4 命名（--slug-hash--，只给人看，查找不靠它） */
  key: string;
  displayName: string;
  createdAt: number;
  lastOpenedAt: number;
  openCount: number;
  lastSessionId?: string | null;
}

/** GET /api/dirs/browse 单层条目（全局目录浏览，D-060 信任边界） */
export interface DirBrowseItem {
  name: string;
  path: string;
  type: "drive" | "directory";
}

/** GET /api/dirs/browse 响应：一层目录内容（懒展开树逐层拉取） */
export interface DirBrowse {
  path: string;
  /** 上一层目录（盘符根 = 自身）；盘符列表根（path=__drives__）= undefined */
  parent?: string;
  items: DirBrowseItem[];
}

/** GET/PUT /api/ui-state（全局界面态：backing state/ui.json——运行态不进 settings.json，D-063） */
export interface GlobalUiState {
  /** 全局"上次选中"：启动还原读之，在会话列表则选中，否则回落最新更新 / 新建 */
  lastSessionId: string | null;
}

/** GET/PUT /api/sessions/:id/ui-state（每会话界面绑定态：<sessionDir>/ui-state.json，D-063）。
 * 形状归 web 宿主所有，服务端不解释内容（整份收发 + 64KB 上限）；常用字段可选 + 开放索引
 * 签名随宿主加法生长。删会话随整树走。折叠组不在此列（用户裁决 2026-11-18）：刷新/重启
 * 只展开选中会话所在组、其余组收起，平时折叠/展开是纯本地临时态。 */
export interface SessionUiState {
  /** 输入框草稿文本 */
  draft?: string;
  layout?: {
    /** 左侧栏拖动宽度 px（钳位由宿主管） */
    leftWidth?: number;
    /** 右栏宽度 px（三栏骨架批已接线，每会话各记各的；钳位由宿主管） */
    rightWidth?: number;
  };
  /** 右栏开着的 tab（D-062 右栏 tab 框架随骨架批接线；只存引用，面板内部状态归插件
   * plugins-data/<id>/） */
  rightPanel?: {
    open?: boolean;
    active?: string | null;
    tabs?: Array<{ id: string; kind: string } & Record<string, unknown>>;
  };
  /** 会话级模型记忆（provider/model；composer 回填用——权威在每次请求携带，引擎无会话态） */
  model?: string;
  /** 会话级思考档记忆（同上；我们靠每次请求携带更薄） */
  reasoningEffort?: ReasoningEffort;
  [key: string]: unknown;
}

/** POST /api/sessions/:id/resource 回复（useResource 泵单跳，D-064）：执行失败走 200 +
 *  {ok:false,error}（泵语义：失败保旧数据由宿主负责）；越权 / 未声明 = 403、会话缺 = 404 */
export interface ResourceReply {
  ok: boolean;
  /** 工具返回文本（≤200KB，出口限量已应用） */
  text?: string;
  error?: string;
  updatedAt: number;
}
