// 单步执行（loop.md §1 step 环）：派生表面 → 计量 + loop/pre-step → 请求头快照 →
// 流消费（增量攒批 + 纪律① 先查 aborted）→ 结算（纯文本收尾 / 工具回合落账）。
// 与回合骨架（turn.ts）按职责分家（D-054）——两个变化原因：回合状态机怎么走 vs
// 一步内部怎么执行。缝落在本文件：runStep 有两个调用方（回合主循环 / 熔断续跑），
// 只有落在里面两条路径才都经过（compaction.md §3.1）。
// 纪律②（绝不留孤儿 tool/call）在结算段；纪律③（工具与信号竞速）委托 tools.run。

import { createHash } from "node:crypto";
import path from "node:path";
import {
  capOutputTokens,
  LLM_ERROR_CONTEXT_OVERFLOW,
  LLM_ERROR_EMPTY_COMPLETION,
  LLM_ERROR_OUTPUT_LIMIT_EXCEEDED,
  LlmError,
  type LlmRequest,
  type ModelMessage,
  type PreStepValue,
  type PromptOptions,
  type RequestFailedValue,
  reasoningEchoField,
  type TokenUsage,
  type ToolContext,
  type TurnEndReason,
} from "@henira/protocol";
import type { DeltaBatcher } from "./batcher.js";
import type { ContextMeter } from "./meter.js";
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
  /** 模型/思考按次覆盖（回合开始即定，全步一致——每次提问绑定语义） */
  opts?: PromptOptions;
}

interface StepResult {
  outcome: StepOutcome;
  usage: TokenUsage;
}

interface TypedLlmError {
  code: string;
  status?: number;
  limit?: number;
  actual?: number;
}

/** 跨包 name 判别（不把 fs / 系统 errno 的 code 混进模型错误） */
function asTypedLlmError(err: unknown): TypedLlmError | undefined {
  if (!(err instanceof Error) || err.name !== "LlmError") return undefined;
  const shaped = err as Error & {
    code?: unknown;
    status?: unknown;
    limit?: unknown;
    actual?: unknown;
  };
  if (typeof shaped.code !== "string") return undefined;
  return {
    code: shaped.code,
    ...(typeof shaped.status === "number" ? { status: shaped.status } : {}),
    ...(typeof shaped.limit === "number" ? { limit: shaped.limit } : {}),
    ...(typeof shaped.actual === "number" ? { actual: shaped.actual } : {}),
  };
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

export async function runStep(args: StepArgs): Promise<StepResult> {
  const { turn, step, deps, batcher, signal, opts } = args;
  const { session, llm, tools, approval, config, meter } = deps; // ctx.events 只在 runTurnCore 用
  const wireTools = tools.project();
  // 显式覆盖缝（config.model(id) 既有参数，首次生产消费）：按次 modelId 优先，缺省回落
  // settings.model 全局默认。解析失败（未知 id / 无默认）照常抛错——回合落 error 事件收尾。
  const modelConfig = await config.model(opts?.modelId);
  const model = `${modelConfig.provider}/${modelConfig.model}`;

  // 派生一次表面：messages 与计量读数共用同一份折叠（I-1）
  const surface = session.deriveSurface();
  const measurement: ReturnType<ContextMeter["measure"]> = meter.measure({
    events: session.events(),
    surface,
    tools: wireTools,
    modelConfig,
    model,
  });

  // loop/pre-step（waterfall）：派生之后、request/header 之前——压缩插件在此做压力检查与压缩
  const effort = opts?.reasoningEffort;
  const preStep: PreStepValue = {
    messages: surface.map((entry) => entry.message),
    tools: wireTools,
    model: modelConfig,
    ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    sessionId: session.header().id,
    turn,
    step,
    context: measurement.reading,
    budget: measurement.budget,
    signal,
  };
  const effective = await deps.ctx.events.waterfall<PreStepValue>("loop/pre-step", preStep);
  const effectiveModel = effective.model;
  const effectiveModelId = `${effectiveModel.provider}/${effectiveModel.model}`;

  // 缝之后按可能已被压缩的表面重算读数（只读 peek，不动 k）：输出封顶与下游读数
  // 必须基于压缩后的表面——否则刚压完的主请求会按压缩前的余量被无故截断输出
  const postSurface = session.deriveSurface();
  const post = meter.peek({
    events: session.events(),
    surface: postSurface,
    tools: effective.tools,
    modelConfig: effectiveModel,
    model: effectiveModelId,
  });
  if (effective.messages !== preStep.messages) meter.setReading(post.reading);
  // request-failed 重试后再派发时的读数口径：跟表面走（重试前重算），不陈回首次
  let latestPost = post;

  // 思维链回传与否：与适配器同一判定（开思考 + interleaved 声明）——写进 request/header，
  // 计量器据此扣减不进下一条 prompt 的思考 token（compaction.md §4.2）
  const echoReasoning =
    effort !== undefined &&
    effort !== "off" &&
    reasoningEchoField(effectiveModel.interleaved) === "reasoning_content";

  // 主请求按剩余窗口封顶（§4.3）：只在 0 < 剩余 < 输出基线时带 max_tokens
  const cap = capOutputTokens(post.reading.used, post.budget);
  const baseRequest: LlmRequest = {
    model: effectiveModel,
    messages: effective.messages,
    tools: effective.tools,
    // 会话 id 只给适配器做厂商路由头（opencode 家族要求每对话稳定值；语义决策不归它）
    sessionId: session.header().id,
    ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    ...(cap !== undefined ? { maxTokens: cap } : {}),
  };
  // 硬线（I-13 / F-6）：压缩后仍到硬线，拒绝发送——落致命 error，不把必败请求发出去
  if (post.reading.used >= post.budget.hardLimit) {
    const message = `context usage ${post.reading.used} reached hard limit ${post.budget.hardLimit}; request not sent`;
    await session.append({
      type: "error",
      data: { turn, step, code: "CONTEXT_UNCOMPACTABLE", message, fatal: true },
    });
    batcher.pushStructural({ type: "error", message });
    return { outcome: "error", usage: emptyUsage() };
  }

  const headerParams = {
    ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    ...(echoReasoning ? { echoReasoning: true } : {}),
  };
  const writeHeader = async (
    messages: readonly ModelMessage[],
    toolNames: readonly string[],
  ): Promise<void> => {
    await session.append({
      type: "request/header",
      data: {
        turn,
        step,
        model: effectiveModelId,
        params: headerParams,
        toolNames: [...toolNames],
        systemPromptHash: systemPromptHash(messages),
      },
    });
  };

  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const calls: { callId: string; name: string; argsText: string }[] = [];
  let finishReason = "unknown";
  let usage: TokenUsage = emptyUsage();

  /** 单次请求周期（重试用时重置累积——错峰重发不把半截文本当结果） */
  const consumeOnce = async (request: LlmRequest): Promise<void> => {
    textParts.length = 0;
    reasoningParts.length = 0;
    calls.length = 0;
    finishReason = "unknown";
    usage = emptyUsage();
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
          // 五字段全收（cache / reasoning 明细随 step/end 落账——计量锚点与缓存命中率要用）
          usage = {
            inputTokens: event.usage.inputTokens ?? 0,
            outputTokens: event.usage.outputTokens ?? 0,
            ...(event.usage.cacheReadTokens !== undefined
              ? { cacheReadTokens: event.usage.cacheReadTokens }
              : {}),
            ...(event.usage.cacheWriteTokens !== undefined
              ? { cacheWriteTokens: event.usage.cacheWriteTokens }
              : {}),
            ...(event.usage.reasoningTokens !== undefined
              ? { reasoningTokens: event.usage.reasoningTokens }
              : {}),
          };
          break;
        case "finish":
          finishReason = event.reason;
          break;
      }
    }
  };

  let request = baseRequest;
  let retries = 0;
  let emptyRetries = 0;
  let failure: TypedLlmError | undefined;
  let failureMessage = "";
  let original: TypedLlmError | undefined;
  let originalMessage: string | undefined;

  while (true) {
    await writeHeader(
      request.messages,
      request.tools.map((tool) => tool.name),
    );
    try {
      await consumeOnce(request);
    } catch (err) {
      if (signal.aborted) return { outcome: "aborted", usage }; // 纪律 1：掐流不是 retryable 错误
      const typed = asTypedLlmError(err) ?? { code: "LLM_STREAM" };
      const message = err instanceof Error ? err.message : String(err);

      // 封顶引起的第③类（§4.3）：去掉封顶原步重发一次，并记下报错自报的输出上限。
      // 只认「本次确实带了 maxTokens」——无封顶的参数错不是我们造成的，不走这条恢复。
      if (typed.code === LLM_ERROR_OUTPUT_LIMIT_EXCEEDED && request.maxTokens !== undefined) {
        meter.recordOutputLimit(effectiveModelId, typed.limit);
        const retryRequest: LlmRequest = { ...request };
        delete retryRequest.maxTokens;
        request = retryRequest;
        continue;
      }

      // 失败后缝（compaction.md §4.1）：监听器可以压缩后置 retry，原步重发（不新开 step）。
      // 溢出路径上报原始错误（F-1）——重试仍失败时不用第二次的错误覆盖第一次的。
      if (typed.code === LLM_ERROR_CONTEXT_OVERFLOW) {
        meter.recordContextLimit(effectiveModelId, typed.limit); // 报错自报上限回灌（§4.2）
      }
      const llmError =
        err instanceof Error && err.name === "LlmError"
          ? (err as LlmError)
          : new LlmError(typed.code, message, typed.status, {
              ...(typed.limit !== undefined ? { limit: typed.limit } : {}),
              ...(typed.actual !== undefined ? { actual: typed.actual } : {}),
            });
      let dispatched: RequestFailedValue | undefined;
      try {
        dispatched = await deps.ctx.events.waterfall<RequestFailedValue>("loop/request-failed", {
          error: llmError,
          turn,
          step,
          retries,
          messages: request.messages,
          tools: request.tools,
          model: effectiveModel,
          ...(effort !== undefined ? { reasoningEffort: effort } : {}),
          sessionId: session.header().id,
          context: latestPost.reading,
          budget: latestPost.budget,
          signal,
          retry: false,
        });
      } catch {
        dispatched = undefined; // 监听器异常不吞掉原始错误（压缩自己的失败另有 error 行）
      }
      if (dispatched?.retry === true && retries < 2) {
        retries += 1;
        original ??= typed;
        originalMessage ??= message;
        // 压缩可能刚改写了表面：重新派生 + 重算封顶，再发
        const nextSurface = session.deriveSurface();
        const nextPost = meter.peek({
          events: session.events(),
          surface: nextSurface,
          tools: request.tools,
          modelConfig: effectiveModel,
          model: effectiveModelId,
        });
        meter.setReading(nextPost.reading);
        latestPost = nextPost;
        // 重发前硬线复检（I-13 / F-6）：两次尝试之间表面可能又被顶回硬线上——同样拒绝
        // 发送，不把必败请求发出去（终局与首查同形：fatal CONTEXT_UNCOMPACTABLE）
        if (nextPost.reading.used >= nextPost.budget.hardLimit) {
          const hardMessage = `context usage ${nextPost.reading.used} reached hard limit ${nextPost.budget.hardLimit}; request not sent`;
          await session.append({
            type: "error",
            data: { turn, step, code: "CONTEXT_UNCOMPACTABLE", message: hardMessage, fatal: true },
          });
          batcher.pushStructural({ type: "error", message: hardMessage });
          return { outcome: "error", usage };
        }
        const nextCap = capOutputTokens(nextPost.reading.used, nextPost.budget);
        const nextRequest: LlmRequest = {
          ...request,
          messages: nextSurface.map((entry) => entry.message),
        };
        if (nextCap !== undefined) nextRequest.maxTokens = nextCap;
        else delete nextRequest.maxTokens;
        request = nextRequest;
        continue;
      }
      failure = original ?? typed;
      failureMessage = original !== undefined ? (originalMessage ?? message) : message;
      break;
    }

    // 空完成重试一次（D-095）：正文空白、无工具调用、finish stop（reasoning 有值也算）。
    // 与溢出监听器重试（retries）并列的独立计数器；重发重写 request/header 留审计痕，
    // consumeOnce 自带清零累加器（只有最终尝试的 usage 落 step/end，锚点不受影响）。
    // 不重试：length（思考吃满输出预算，同参重发无益）/ content-filter / 有 tool_calls
    // 的空正文（工具轮合法形态）；aborted 时走既有中止路径（纪律 1）。
    const emptyStop =
      calls.length === 0 && textParts.join("").trim() === "" && finishReason === "stop";
    if (emptyStop && !signal.aborted) {
      if (emptyRetries === 0) {
        emptyRetries += 1;
        continue;
      }
      // 二次仍空：EMPTY_COMPLETION 错误行收尾，不落空 assistant 行（派生层 D-094 已把
      // 该形态剔出模型历史；这里补「用户看得到什么」）——零新事件类型，回合按 error 收束
      failure = { code: LLM_ERROR_EMPTY_COMPLETION };
      failureMessage = "model returned an empty response (retried once)";
      break;
    }
    break;
  }
  if (failure !== undefined) {
    // 纪律 5：错误落盘为事件（报错的回合也要有收尾）。状态 / 自报上限与实际数一并落账
    // （溢出错误翻可行动中文要用；compaction.md §4.11）
    await session.append({
      type: "error",
      data: {
        turn,
        step,
        code: failure.code,
        message: failureMessage,
        ...(failure.status !== undefined ? { status: failure.status } : {}),
        ...(failure.limit !== undefined ? { limit: failure.limit } : {}),
        ...(failure.actual !== undefined ? { actual: failure.actual } : {}),
      },
    });
    batcher.pushStructural({ type: "error", message: failureMessage });
    return { outcome: "error", usage };
  }
  if (signal.aborted) return { outcome: "aborted", usage };

  const content = textParts.join("");
  const reasoning = reasoningParts.join("") || undefined;
  if (calls.length === 0) {
    // 纯文本收尾：结算 assistant/message
    await session.append({
      type: "assistant/message",
      data: { turn, step, content, reasoning, model: effectiveModelId, finishReason },
    });
    const outcome: StepOutcome = finishReason === "length" ? "max-tokens" : "completed";
    return { outcome, usage };
  }

  // 工具回合：assistant/message → 逐调用 tool/call → 执行 → tool/result → 续步。
  // reasoning 与纯文本轮同形落账本（思考档批 2026-11-19；2026-11-26 真 key 采样未复现
  // 「带 tool_calls 不回传 reasoning_content 会 400」——回传保留为多轮一致性，非硬要求）
  await session.append({
    type: "assistant/message",
    data: { turn, step, content, reasoning, model: effectiveModelId, finishReason },
  });
  const toolCtx: ToolContext = {
    cwd: config.cwd,
    signal,
    requestPermission: (req, opts) => approval.requestPermission(req, opts),
    config,
    // 截断 spill：会话目录 artifacts/——随会话同生共死（M4 批 A 接线，此前全库无人传参）
    artifactsDir: path.join(session.directory, "artifacts"),
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
