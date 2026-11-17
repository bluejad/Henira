// 回合骨架（loop.md §1 两级状态机 + P6 中断纪律五条，各条具名测试见 loop-interrupt.test.ts）。
// 单步执行（请求头 / 流消费 / 结算）按职责分家在 step.ts（D-054：回合骨架与单步执行是
// 两个变化原因）。回调形态：run() 包成 AsyncIterable、send() 忙时入队 / 闲时后台跑——同走这条
// 路。总线广播 turn/start / step/start（approval 的审计对靠它定位回合）。

import type {
  ApprovalService,
  ConfigService,
  HeniraContext,
  LlmService,
  LoopEvent,
  SessionService,
  TokenUsage,
  ToolsService,
  TurnEndReason,
} from "@henira/protocol";
import { DeltaBatcher } from "./batcher.js";
import { BASE_SYSTEM_KEY, BASE_SYSTEM_PROMPT } from "./prompts.js";
import type { PromptQueue } from "./queue.js";
import { runStep } from "./step.js";

/** 用量逐字段累加（回合级 usage = 各步之和；未报字段落 0——turn/end.usage 是整回合合计） */
function addUsage(a: TokenUsage, b: TokenUsage | undefined): TokenUsage {
  if (b === undefined) return a;
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
  };
}

export interface LoopDeps {
  ctx: HeniraContext;
  session: SessionService;
  llm: LlmService;
  tools: ToolsService;
  approval: ApprovalService;
  config: ConfigService;
  queue: PromptQueue;
  maxStepsPerTurn?: number; // 步数上限：机制可选、默认不设（D-045）
}

export interface TurnHandle {
  turn: string;
  signal: AbortSignal;
}

export interface TurnCallbacks {
  /** 每个 LoopEvent（攒批已应用）——run() 喂消费者、send() 喂总线 */
  onEvent: (event: LoopEvent) => void;
  onTurnStart?: (handle: TurnHandle) => void;
}

/** 单回合（含步循环与全部落账）；返回终局原因。队列冲刷由外层驱动 */
export async function runTurnCore(
  prompt: string,
  deps: LoopDeps,
  callbacks: TurnCallbacks,
  signal: AbortSignal,
): Promise<TurnEndReason> {
  const { session, ctx } = deps; // llm / tools / approval / config 由 runStep 经 deps 取用
  const turn = `t-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  callbacks.onTurnStart?.({ turn, signal });

  const batcher = new DeltaBatcher((events) => {
    for (const e of events) callbacks.onEvent(e);
  });
  const emit = (event: LoopEvent): void => callbacks.onEvent(event);

  // 基底系统块（session.md §4：key 防重复，同名最新；已有即不再注）
  const hasBase = session
    .events()
    .some(
      (e) => e.type === "system/message" && (e.data as { key?: string }).key === BASE_SYSTEM_KEY,
    );
  if (!hasBase) {
    await session.append({
      type: "system/message",
      data: { turn, step: 0, content: BASE_SYSTEM_PROMPT, key: BASE_SYSTEM_KEY },
    });
  }
  await session.append({
    type: "user/message",
    data: { turn, step: 0, content: prompt, source: "send" },
  });
  await session.append({ type: "turn/start", data: { turn } });
  ctx.events.emit("turn/start", { turn });

  let step = 0;
  let endReason: TurnEndReason = "completed";
  let turnUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  try {
    while (true) {
      if (signal.aborted) {
        endReason = "aborted";
        break;
      }
      if (deps.maxStepsPerTurn !== undefined && step >= deps.maxStepsPerTurn) {
        endReason = "max-tokens"; // §2.4：步数 / token 上限同词
        break;
      }
      step += 1;
      await session.append({ type: "step/start", data: { turn, step } });
      ctx.events.emit("step/start", { turn, step });

      // ── step 边界：插话进场（D-045：工具结果落定后、模型请求前）────────
      const steers = await deps.queue.claimSteers();
      for (const s of steers) {
        await session.append({
          type: "user/message",
          data: { turn, step, content: s.text, source: "steer" },
        });
      }

      const outcome = await runStep({ turn, step, deps, batcher, signal });
      turnUsage = addUsage(turnUsage, outcome.usage);
      const interrupted = signal.aborted;
      await session.append({
        type: "step/end",
        data: { turn, step, usage: outcome.usage, interrupted: interrupted || undefined },
      });
      if (interrupted) {
        endReason = "aborted";
        break;
      }
      if (outcome.outcome === "tool-round") continue;
      endReason = outcome.outcome;
      break;
    }
  } catch (err) {
    // 纪律 5（回合级兜底）：setup / 结算的引擎级异常同样落盘为事件 + 有收尾。
    // 注意 abort 不走这里：runStep 先查 signal.aborted 以 aborted 返回（纪律 1）
    const message = err instanceof Error ? err.message : String(err);
    await session.append({ type: "error", data: { turn, step, code: "ENGINE", message } });
    batcher.pushStructural({ type: "error", message });
    endReason = "error";
  } finally {
    batcher.flushNow(); // 纪律 4：inflight 增量兜底补发
  }

  // ── turn-stopping bail 缝（D-012①）：completed / max-tokens 可被否决并续跑一步 ──
  if (endReason === "completed" || endReason === "max-tokens") {
    const veto = await ctx.events.bail("loop/turn-stopping", { turn, reason: endReason });
    if (veto !== undefined) {
      await session.append({
        type: "user/message",
        data: { turn, step, content: veto.resume?.prompt ?? veto.reason, source: "veto" },
      });
      step += 1;
      await session.append({ type: "step/start", data: { turn, step } });
      ctx.events.emit("step/start", { turn, step });
      const more = await runStep({ turn, step, deps, batcher, signal });
      endReason = more.outcome === "tool-round" ? "completed" : more.outcome;
      turnUsage = addUsage(turnUsage, more.usage);
      await session.append({ type: "step/end", data: { turn, step, usage: more.usage } });
    }
  }

  await session.append({
    type: "turn/end",
    data: {
      turn,
      reason: endReason,
      ...(endReason === "aborted" ? { cause: "user" } : {}),
      usage: turnUsage,
    },
  });
  ctx.events.emit("turn/end", { turn, reason: endReason });
  emit({ type: "turn-ended", reason: endReason });
  return endReason;
}
