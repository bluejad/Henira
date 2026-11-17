// 单步执行（loop.md §1 step 环）：请求头快照 → 流消费（增量攒批 + 纪律① 先查 aborted）
// → 结算（纯文本收尾 / 工具回合落账）。与回合骨架（turn.ts）按职责分家（D-054）——
// 两个变化原因：回合状态机怎么走 vs 一步内部怎么执行。
// 纪律②（绝不留孤儿 tool/call）在结算段；纪律③（工具与信号竞速）委托 tools.run。

import { createHash } from "node:crypto";
import type { ModelMessage, ToolContext, TurnEndReason } from "@henira/protocol";
import type { DeltaBatcher } from "./batcher.js";
import type { LoopDeps } from "./turn.js"; // 仅类型引用（type import 擦除，无运行时环）

export function systemPromptHash(messages: readonly ModelMessage[]): string {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  return createHash("sha256").update(system).digest("hex").slice(0, 16);
}

export type StepOutcome = "tool-round" | TurnEndReason;

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

export async function runStep(args: StepArgs): Promise<StepResult> {
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
          durationMs: outcome.durationMs,
          ...(outcome.truncated !== undefined ? { truncated: outcome.truncated } : {}),
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
