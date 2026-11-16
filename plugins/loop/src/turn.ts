// 回合执行核心（loop.md §1 两级状态机 + P6 中断纪律五条，各条具名测试见 loop-interrupt.test.ts）。
// 回调形态：run() 包成 AsyncIterable、send() 忙时入队 / 闲时后台跑——同走这一条路。
// 总线广播 turn/start / step/start（approval 的审计对靠它定位回合）。

import { createHash } from "node:crypto";
import type {
  LlmService,
  LoopEvent,
  ModelMessage,
  ReinsContext,
  SessionService,
  ToolContext,
  ToolsService,
  TurnEndReason,
} from "@reins/protocol";
import { DeltaBatcher } from "./batcher.js";
import { BASE_SYSTEM_KEY, BASE_SYSTEM_PROMPT } from "./prompts.js";
import type { PromptQueue } from "./queue.js";

export interface LoopDeps {
  ctx: ReinsContext;
  session: SessionService;
  llm: LlmService;
  tools: ToolsService;
  approval: import("@reins/protocol").ApprovalService;
  config: import("@reins/protocol").ConfigService;
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

export function systemPromptHash(messages: readonly ModelMessage[]): string {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  return createHash("sha256").update(system).digest("hex").slice(0, 16);
}

/** 单回合（含步循环与全部落账）；返回终局原因。队列冲刷由外层驱动 */
export async function runTurnCore(
  prompt: string,
  deps: LoopDeps,
  callbacks: TurnCallbacks,
  signal: AbortSignal,
): Promise<TurnEndReason> {
  const { session, ctx } = deps; // llm / tools / approval / config 只在 runStep 与 model 行用
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
  let turnUsage = { inputTokens: 0, outputTokens: 0 };
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
      turnUsage = outcome.usage;
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

type StepOutcome = "tool-round" | TurnEndReason;

interface StepArgs {
  turn: string;
  step: number;
  deps: LoopDeps;
  batcher: DeltaBatcher;
  signal: AbortSignal;
}

interface StepResult {
  outcome: StepOutcome;
  usage: { inputTokens: number; outputTokens: number };
}

async function runStep(args: StepArgs): Promise<StepResult> {
  const { turn, step, deps, batcher, signal } = args;
  const { session, llm, tools, approval, config } = deps; // ctx.events 只在 runTurnCore 用
  const messages = session.deriveMessages();
  const wireTools = tools.project();
  const modelConfig = await config.model();
  const model = `${modelConfig.provider}/${modelConfig.model}`;
  const request = { model: modelConfig, messages, tools: wireTools };
  await session.append({
    type: "request/header",
    data: {
      turn,
      step,
      model,
      params: {},
      toolNames: wireTools.map((t) => t.name),
      systemPromptHash: systemPromptHash(messages),
    },
  });

  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const calls: { callId: string; name: string; argsText: string }[] = [];
  let finishReason = "unknown";
  let usage = { inputTokens: 0, outputTokens: 0 };
  try {
    for await (const event of llm.stream(request, signal)) {
      if (signal.aborted) break; // 纪律 1：先查 aborted，不再消费
      switch (event.type) {
        case "text-delta":
          textParts.push(event.text);
          batcher.pushDelta({ type: "text-delta", text: event.text });
          break;
        case "reasoning-delta":
          reasoningParts.push(event.text);
          batcher.pushDelta({ type: "reasoning-delta", text: event.text });
          break;
        case "tool-call":
          calls.push(event);
          break;
        case "usage":
          usage = {
            inputTokens: event.usage.inputTokens ?? 0,
            outputTokens: event.usage.outputTokens ?? 0,
          };
          break;
        case "finish":
          finishReason = event.reason;
          break;
      }
    }
  } catch (err) {
    if (signal.aborted) return { outcome: "aborted", usage }; // 纪律 1：掐流不是 retryable 错误
    // 纪律 5：错误落盘为事件（报错的回合也要有收尾）
    const message = err instanceof Error ? err.message : String(err);
    await session.append({ type: "error", data: { turn, step, code: "LLM_STREAM", message } });
    batcher.pushStructural({ type: "error", message });
    return { outcome: "error", usage };
  }
  if (signal.aborted) return { outcome: "aborted", usage };

  const content = textParts.join("");
  const reasoning = reasoningParts.join("") || undefined;
  if (calls.length === 0) {
    // 纯文本收尾：结算 assistant/message
    await session.append({
      type: "assistant/message",
      data: { turn, step, content, reasoning, model, finishReason },
    });
    const outcome: StepOutcome = finishReason === "length" ? "max-tokens" : "completed";
    return { outcome, usage };
  }

  // 工具回合：assistant/message → 逐调用 tool/call → 执行 → tool/result → 续步
  await session.append({
    type: "assistant/message",
    data: { turn, step, content, model, finishReason },
  });
  const toolCtx: ToolContext = {
    cwd: config.cwd,
    signal,
    requestPermission: (req, opts) => approval.requestPermission(req, opts),
    config,
  };
  for (const call of calls) {
    await session.append({
      type: "tool/call",
      data: { turn, step, callId: call.callId, name: call.name, arguments: call.argsText },
    });
    batcher.pushStructural({ type: "tool-started", callId: call.callId, name: call.name });
  }
  // 纪律 3：工具执行与信号竞速——管线内未启动即中止 / 已启动保留自报错误；结果照常结算
  const outcomes = await tools.run(calls, toolCtx);
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const outcome = outcomes[i];
    if (outcome === undefined) {
      // 纪律 2：绝不留孤儿 tool/call——合成错误结果
      await session.append({
        type: "tool/result",
        data: {
          turn,
          step,
          callId: call.callId,
          isError: true,
          content: "[no tool result recorded]",
          durationMs: 0,
        },
      });
    } else {
      await session.append({
        type: "tool/result",
        data: {
          turn,
          step,
          callId: call.callId,
          isError: outcome.result.isError ?? false,
          content: outcome.result.content,
          durationMs: 0,
          ...(outcome.result.__meta ? { meta: outcome.result.__meta } : {}),
        },
      });
    }
    batcher.pushStructural({
      type: "tool-finished",
      callId: call.callId,
      name: call.name,
      isError: outcome?.result.isError ?? true,
    });
  }
  return { outcome: "tool-round", usage };
}
