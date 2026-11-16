// loop 槽位契约（interfaces.md protocol 段，2026-11-16 定稿）。
// turn/step 状态机与中断纪律见 loop.md（P6）；忙时投递唯一化见 D-045。

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

/** 排队条目（queue.json 持久化，重启恢复）；steer = "立即发送"插话条目（下一 step 边界进场，D-045） */
export interface QueuedPrompt {
  id: string;
  text: string;
  steer: boolean;
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
  /** 开启一回合并流出事件 */
  run(prompt: string, signal?: AbortSignal): AsyncIterable<LoopEvent>;
  /**
   * 闲时 = 直接开新回合（事件照常落账本；无返回 iterable——消费者经总线 / 会话事件观察）；
   * 忙时入队（queue.json 持久化，D-045）
   */
  send(prompt: string, opts?: { steer?: boolean }): Promise<QueuedPrompt>;
  /** 队列条目"立即发送" = 插话升格；条目不存在返回 false */
  steer(entryId: string): Promise<boolean>;
  /** 中止当前回合（turn/end{aborted, cause:'user'}） */
  interrupt(signal?: AbortSignal): Promise<void>;
}
