// loop 槽位契约（interfaces.md protocol 段，2026-11-16 定稿）。
// turn/step 状态机与中断纪律见 loop.md（P6）；忙时投递唯一化见 D-045。

import type { ContextBudget } from "./context-budget.js";
import type { ContextReading } from "./context-meter.js";
import type { LlmError, ModelConfig, ReasoningEffort, WireToolSchema } from "./llm.js";
import type { ModelMessage } from "./services.js";

/** 权限模式两值（D-080）：ask = 改动前询问（默认、fail-closed）；full = 完全访问
 * （审批水瀑之后自动放行；硬拒清单 / deny 规则 / hook deny 不受影响） */
export const PERMISSION_MODES = ["ask", "full"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** turn/end.reason 7 值（session.md §2.4 同源）；interrupted / forked 只由 session 补写产生，loop 不发 */
export const TURN_END_REASONS = [
  "completed",
  "aborted",
  "blocked",
  "error",
  "max-tokens",
  "interrupted",
  "forked",
] as const;
export type TurnEndReason = (typeof TURN_END_REASONS)[number];

/** 每次提问携带的模型/思考覆盖（模型与思考档按每次提问绑定，会话级记忆只做
 * composer 回填——权威在每次请求携带；缺省回落 settings.model 全局默认） */
export interface PromptOptions {
  /** 显式模型 id（provider/model）；loop 经 config.model(id) 既有显式缝解析 */
  modelId?: string;
  /** 思考档（适配器按厂商能力映射，none 厂商忽略——llm.ts ReasoningEffort） */
  reasoningEffort?: ReasoningEffort;
  /** 权限模式（D-080：按每次提问绑定，与模型/思考档同权威；缺省 = ask）。
   * 会话级记忆只做 composer 回填——权威在每次请求携带 */
  permissionMode?: PermissionMode;
}

/** 排队条目（queue.json 持久化，重启恢复）；steer = "立即发送"插话条目（下一 step 边界进场，
 * D-045）。模型/思考覆盖随条目持久化——重启恢复后按原选择开新回合 */
export interface QueuedPrompt {
  id: string;
  text: string;
  steer: boolean;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  /** 权限模式随条目持久化（重启恢复后按原选择开新回合） */
  permissionMode?: PermissionMode;
}

/** loop/pre-step 载荷（waterfall；compaction.md §4.1）：在 runStep 内、派生之后
 *  request/header 之前派发（回合主循环与熔断续跑两条路径都经过）。监听器可替换
 *  messages / tools（压缩后重新派生），context = 本次请求前的计量读数。 */
export interface PreStepValue {
  messages: ModelMessage[];
  tools: WireToolSchema[];
  model: ModelConfig;
  reasoningEffort?: ReasoningEffort;
  sessionId: string;
  turn: string;
  step: number;
  context: ContextReading;
  /** 本次请求的预算（压缩插件选区/摘要预算用，与 loop 同一份公式） */
  budget: ContextBudget;
  /** 回合中断信号（摘要请求随之取消） */
  signal: AbortSignal;
}

/** loop/request-failed 载荷（waterfall；compaction.md §4.1）：请求失败后派发。
 *  监听器置 `retry: true` = 已处理（如压缩完成），原步重发（不新开 step、不写 error 行）。
 *  载荷带当前请求面（messages / model / tools / budget / signal），压缩不需要重新猜环境。 */
export interface RequestFailedValue {
  error: LlmError;
  turn: string;
  step: number;
  /** 本步已重试次数（0 = 首次失败） */
  retries: number;
  messages: ModelMessage[];
  tools: WireToolSchema[];
  model: ModelConfig;
  reasoningEffort?: ReasoningEffort;
  sessionId: string;
  context: ContextReading;
  budget: ContextBudget;
  signal: AbortSignal;
  /** 监听器置 true = 已处理，原步重发 */
  retry?: boolean;
}

export interface RequestFailedResult {
  retry?: boolean;
}

// run() 产出的回合事件流（增量变体走 16ms 攒批；结构事件永不攒批——[opencode]
// `publish-llm-event.ts:289` "block starts are not batched" 同规）。
export type LoopEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-started"; callId: string; name: string }
  | { type: "tool-finished"; callId: string; name: string; isError: boolean }
  | { type: "approval-requested"; requestId: string; tool: string; reason?: string }
  | { type: "turn-ended"; reason: TurnEndReason }
  | { type: "error"; message: string };

export interface LoopService {
  /** 开启一回合并流出事件（opts = 模型/思考按次覆盖） */
  run(prompt: string, signal?: AbortSignal, opts?: PromptOptions): AsyncIterable<LoopEvent>;
  /**
   * 闲时 = 直接开新回合（事件照常落账本；无返回 iterable——消费者经总线 / 会话事件观察）；
   * 忙时入队（queue.json 持久化，D-045，模型/思考覆盖随条目持久化）
   */
  send(prompt: string, opts?: { steer?: boolean } & PromptOptions): Promise<QueuedPrompt>;
  /** 当前排队条目快照（排队卡 UI 数据源；投影态——非账本事实，P9-1 不变） */
  pending(): QueuedPrompt[];
  /** 队列条目"立即发送" = 插话升格；条目不存在返回 false */
  steer(entryId: string): Promise<boolean>;
  /**
   * 立即发送（抢占式升格）：中止当前回合并等待其收尾，然后以该条原文（模型/思考覆盖随行）
   * 开新回合，此刻才从队列摘除（条目不存在返回 false）。剩余条目原位不动、原序保留，
   * 提升回合结束后照常自动续冲；本动作不产生冻结态。与 steer() 分工：steer = 不打断当前、
   * step 边界插话；promote = 打断 + 立即独占新回合
   */
  promote(entryId: string): Promise<boolean>;
  /** 删除排队条目；条目不存在返回 false */
  remove(entryId: string): Promise<boolean>;
  /** 队列是否处于「中断冻结」态（中断后不自动冲刷，等显式恢复；UI 暂停横幅判据） */
  paused(): boolean;
  /** 本会话当前余量读数（每步重算；尚无读数时 undefined）。停用压缩插件照常成立 */
  contextUsage(): ContextReading | undefined;
  /** 重启恢复（compaction.md §4.11）：装载历史会话后由宿主调用一次——无活态读数时
   *  按账本最近一条 request/header 的模型 + 当前工具表重算余量并广播；从未请求过的
   *  会话没有 header，读数保持缺省（余量入口不显示，不猜）。可选：自定义 loop 可实现 */
  restoreContext?(): Promise<void>;
  /** 是否忙（回合或冲刷链在跑，含回合间空窗）——手动压缩互斥判据（compaction.md §4.10） */
  isBusy(): boolean;
  /** 恢复被中断冻结的队列冲刷：取队头开新回合（闲时才可；无冻结/无条目返回 false） */
  resume(): Promise<boolean>;
  /** 中止当前回合（turn/end{aborted, cause:'user'}；队列非空时中断 = 队列冻结不冲刷） */
  interrupt(signal?: AbortSignal): Promise<void>;
}
