// server → 客户端唯一词表（interfaces.md server 段定稿 2026-11-17）。
// 行模型核心与 ZCode 同构（取证 2026-11-16/17）：投影行 + 封闭增量 + snapshot/resync——
// 行 = 自包含 UI 单元，rowId 会话内单调唯一、账本事实的确定性函数（回放重建 rowId 不变）；
// 客户端断档不猜：seq 跳号 → 重拉快照，永不猜中间态。事件→UI 的组装逻辑收敛在 server
// 投影器一份（客户端零 reducer——可嵌入 D-037 与跨端一致的前提）。
// 纯 DTO：运行时零依赖（packages.md 规则 1）；Decision 复用 approval 词表。

import type { Decision } from "./approval.js";
import type { QuestionAnswer, QuestionSpec } from "./interaction.js";
import type { ReasoningEffort, TokenUsage } from "./llm.js";
import type { PermissionMode, QueuedPrompt } from "./loop.js";

/** 行标识：`a:{turn}:{step}` / `t:{turn}:{step}:{callId}` / `u:{seq}` / `p:{requestId}` /
 *  `q:{requestId}` / `e:{seq}` */
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
  /** 排队条目 id（R203/D-086：只在队列冲刷产生的回合出现——`onTurnFinished` 把排队回执
   *  对回回合；直接发送 / 插话 / promote 不带） */
  queueId?: string;
  /** 消息时刻（账本 user/message 事件 time，epoch ms——消息外壳时间戳，E4） */
  time?: number;
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
  /** true = 该步被中断掐停（turn/end{reason:"aborted"|"interrupted"} 投影；部分文本定格，无权威落定） */
  interrupted?: boolean;
  /** 中断来源分型（R175）：restart = turn/end{reason:"interrupted"}（开档/启动收口补写——进程死亡
   * 掐停），徽章文案「已中断（服务重启）」；aborted（用户中止）不带此字段 */
  interruptedKind?: "restart";
  /** 本步实际生效思考档（request/header.params 投影——行上可见每次提问档位语义） */
  reasoningEffort?: ReasoningEffort;
  /** 消息时刻（账本 assistant/message 事件 time，epoch ms——轮尾操作行时间戳，E4；
   *  流式行与中止冻结行无权威落定故缺此字段） */
  time?: number;
}

export interface ToolRowOutput {
  content: string;
  isError: boolean;
  durationMs: number;
  /** 输出超限截断（tools 管线结算原样透传；preview 供 UI 展示头部，path 指完整输出落盘文件，
   *  相对会话目录——如 `artifacts/<callId>.txt`，D-085） */
  truncated?: { path: string; preview: string };
  /** 工具结果带外元数据（ToolResult.__meta 原样透传，账本 tool/result.meta 同源；不进模型上下文）。
   *  形状归工具件约定、kind 标记开放集（官方 kind："shell"/"read"/"write"/"edit"/"glob"/"grep"/"mcp"）；
   *  UI 卡逐字段窄化校验，不认识或校验不过一律降级通用渲染（dsh「宁缺毋滥」纪律） */
  meta?: Record<string, unknown>;
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
  /** 真实 tool/call id（R202/D-085；approval/asked 原样携带——超限 args 丢弃时卡片按此回查 tool 行） */
  callId?: string;
  /** argsDigest（关联指纹，chain.test 锁定语义——同参同摘要） */
  argsSummary?: string;
  /** 审批载荷 args 完整原样（approval/asked 投影，E6——D-046「挂起请求自足可渲染」落地：
   * 断线重连 / 多窗口重放同一张卡；per-tool 预览体的唯一数据源。凭据经架构保证不进 args
   * （${credential} 展开只在 MCP 配置装载），且 approval/* 不进 derive——模型上下文不可达。
   * R202：>256KB 或不可序列化时事件侧丢弃 args；卡片按 callId 回查同会话 tool/call 行，
   * 行不在窗口内才回落 argsSummary） */
  args?: unknown;
  /** 审批请求解释（引擎判定链 reason 原样——围栏区外访问等；仅呈现） */
  reason?: string;
  status: "pending" | "settled";
  /** "invalidated" 仅由修理事件 approval/invalidated 投影（R175 重启收口）——客户端不可提交
   * （settle 端点 z.enum(DECISIONS) 不含它，尝试即 400） */
  decision?: Decision | "invalidated";
  /** 允许范围标记（decided{scope} 投影——settled 留痕「· 本会话/本项目」） */
  scope?: "session" | "project";
}

export interface QuestionRow {
  kind: "question";
  rowId: RowId;
  rowSeq: number;
  turn: string;
  step: number;
  requestId: string;
  /** 题目全文（question/asked 投影——挂起卡自足可渲染：断线重连 / 多窗口重放同一张卡；
   *  客户端零额外拉取）。答案不回写此处，收口走 answers/outcome。 */
  questions: QuestionSpec[];
  status: "pending" | "settled";
  /** 已答逐题答案（outcome = answered 时在场；cancelled/invalidated 不带） */
  answers?: QuestionAnswer[];
  /** "invalidated" 仅由修理事件 question/settled 投影（重启收口）——客户端不可提交 */
  outcome?: "answered" | "cancelled" | "invalidated";
}

export interface ErrorRow {
  kind: "error";
  rowId: RowId;
  rowSeq: number;
  turn?: string;
  code?: string;
  message: string;
}

export type Row = UserRow | AssistantRow | ToolRow | ApprovalRow | QuestionRow | ErrorRow;
/** 会话级状态（键级整体替换，键内绝不深合并——封闭增量语法的 state.updated 载荷） */
export interface SessionState {
  /** turn/start … turn/end 之间 */
  busy: boolean;
  lastTurnId?: string;
  /** 当前排队条目快照（排队卡 UI 数据源；投影态非账本事实——P9-1 不变，queue.json 仍是唯一持久层） */
  queue?: QueuedPrompt[];
  /** 中断冻结（队列非空时中断不冲刷，等 resume 恢复；投影态非账本事实，与 queue 键同批并线） */
  queuePaused?: boolean;
  /** 当前 busy 段的真实起点（R173：回合 turn/start 事件 time；turn/end 清除；账本重放
   *  重建自愈——刷新/重连/换窗口计时续上不归零。前端无此字段时兜底本地起表。 */
  busySince?: number;
  /** 回合耗时（E3 生命感回合头：事件时间戳取数——账本 turn/start·turn/end 的 time 差，
   * 重放重建/重载后仍在；保留最近 50 轮，键 = turn id。endedAt = turn/end 时刻（轮尾
   * 时间戳）；forkSeq = turn/end 事件 seq（E4 轮尾 fork 的账本切点——前缀复制 inclusive） */
  turnTimings?: Record<string, { durationMs: number; endedAt: number; forkSeq: number }>;
}

export interface SessionSnapshot {
  sessionId: string;
  /** 会话标题（R188：首条非 breaker 用户消息，服务端派生；缺省 = 尚无用户消息） */
  title?: string;
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
  | { kind: "delta"; sessionId: string; seq: number; delta: Delta }
  /** 会话/目录**列表**事实变了（新建 / 删除 / fork / 懒挂载 / 目录登记增删）——全局帧，
   *  无 sessionId、无 seq：不是行投影增量，消费者（侧栏列表）自行去抖重载。流式 token
   *  增量绝不发此帧（R176 五家铁律：列表管道与高频增量彻底分家）。 */
  | { kind: "sessions.changed" };

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
  /** 会话级权限模式记忆（D-080：composer 回填用；权威在每次请求携带，
   *  与模型/思考档同一条——不是「最近会话」全局值） */
  permissionMode?: PermissionMode;
  [key: string]: unknown;
}

/** POST /api/sessions/:id/resource 回复（useResource 泵单跳，D-064）：执行失败走 200 +
 *  {ok:false,error}（泵语义：失败保旧数据由宿主负责）；越权 / 未声明 = 403、会话缺 = 404 */
export interface ResourceReply {
  ok: boolean;
  /** 工具返回文本（≤200 × 1024 字符，出口限量已应用） */
  text?: string;
  error?: string;
  updatedAt: number;
}
