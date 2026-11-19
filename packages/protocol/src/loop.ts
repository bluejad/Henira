// loop 槽位契约（interfaces.md protocol 段，2026-11-16 定稿）。
// turn/step 状态机与中断纪律见 loop.md（P6）；忙时投递唯一化见 D-045。

import type { ReasoningEffort } from "./llm.js";

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
}

/** 排队条目（queue.json 持久化，重启恢复）；steer = "立即发送"插话条目（下一 step 边界进场，
 * D-045）。模型/思考覆盖随条目持久化——重启恢复后按原选择开新回合 */
export interface QueuedPrompt {
  id: string;
  text: string;
  steer: boolean;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
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
  /** 队列条目"立即发送" = 插话升格；条目不存在返回 false */
  steer(entryId: string): Promise<boolean>;
  /** 中止当前回合（turn/end{aborted, cause:'user'}） */
  interrupt(signal?: AbortSignal): Promise<void>;
}
