// 摘要请求（compaction.md §4.6、§4.1 I-4）：与主循环同形——同模型、同工具表、
// 同思考档、同会话头，只在消息末尾追加一条用户指令；先估算再发（I-14），
// 装不下时从转写尾部裁单元（第 1 档；更深的降档在第 3 层）。
// 端点自报溢出 = 本地估算低估：按 actual/估算 缩放预算再降档重发（最多两次，§17）。
// 只有 finish=stop、正文非空、无工具调用、摘要估算小于被遮蔽量（I-7）才算成功。

import {
  estimateMessages,
  estimateText,
  estimateTools,
  LLM_ERROR_CONTEXT_OVERFLOW,
  type LlmService,
  type ModelConfig,
  type ModelMessage,
  type ReasoningEffort,
  SUMMARY_OUTPUT_MAX,
  type TokenUsage,
  type WireToolSchema,
} from "@henira/protocol";

export interface SummaryRequestInput {
  llm: LlmService;
  model: ModelConfig;
  tools: readonly WireToolSchema[];
  reasoningEffort?: ReasoningEffort;
  sessionId: string;
  /** 头部转写（表面顺序） */
  messages: readonly ModelMessage[];
  instruction: string;
  hardLimit: number;
  summaryOut: number;
  /** 有效输出上限 = ContextBudget.outputBase（min(声明, 观测输出上限)）：第③类参数错
   *  学到的观测输出上限经读数透出（R216），摘要 maxTokens 与主循环封顶同源取它 */
  outputBase?: number;
  /** 第 1 档最多可从尾部移除的非系统消息数（= 保留段消息数；头部不在这里丢） */
  trimLimit?: number;
  /** 被遮蔽内容的估算量（I-7 比较基准） */
  maskedTokens: number;
  signal: AbortSignal;
}

export type SummaryResult =
  | { ok: true; text: string; usage: TokenUsage; omittedTurns?: number }
  | { ok: false; code: string; message: string; interrupted?: boolean };

const EXCERPT_HEAD = 600;
const EXCERPT_TAIL = 300;

/** 一次发送的转写与预算（降档/重试共用） */
interface Fitted {
  messages: ModelMessage[];
  instruction: string;
  /** 已按 scale 缩放的输入估算（含工具表与指令） */
  inputEstimate: number;
  maxTokens: number;
  omittedTurns: number;
}

/** 超长工具结果换头尾摘录（第 2 档；与 §4.9 的无模型摘录同款） */
function excerptText(text: string): string {
  if (text.length <= EXCERPT_HEAD + EXCERPT_TAIL) return text;
  const omitted = text.length - EXCERPT_HEAD - EXCERPT_TAIL;
  return `${text.slice(0, EXCERPT_HEAD)}\n… [omitted ${omitted} chars] …\n${text.slice(-EXCERPT_TAIL)}`;
}

/** 第 2 档：转写里的超长工具结果换成头尾摘录（无模型） */
function shrinkToolResults(messages: ModelMessage[]): boolean {
  let changed = false;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "tool" || message.content.length <= EXCERPT_HEAD + EXCERPT_TAIL) continue;
    messages[index] = { ...message, content: excerptText(message.content) };
    changed = true;
  }
  return changed;
}

/** 第 3/4 档：头部只留后一半 / 后 35%（按非系统消息取整，落点避开 tool 消息）；
 *  返回被丢弃的 assistant / user 条数（轮次 = 两者较大值；user-only 会话也能计数） */
function dropLeading(
  messages: ModelMessage[],
  keepRatio: number,
): { assistants: number; users: number } {
  const nonSystem: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role !== "system") nonSystem.push(index);
  }
  if (nonSystem.length <= 1) return { assistants: 0, users: 0 };
  const keep = Math.max(1, Math.ceil(nonSystem.length * keepRatio));
  let start = nonSystem[nonSystem.length - keep] ?? 0;
  while (start < messages.length && messages[start]?.role === "tool") start += 1;
  if (start >= messages.length) return { assistants: 0, users: 0 };

  const kept: ModelMessage[] = [];
  let assistants = 0;
  let users = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) continue;
    if (index >= start || message.role === "system") {
      kept.push(message);
    } else if (message.role === "assistant") {
      assistants += 1;
    } else if (message.role === "user") {
      users += 1;
    }
  }
  messages.splice(0, messages.length, ...kept);
  return { assistants, users };
}

export async function requestSummary(input: SummaryRequestInput): Promise<SummaryResult> {
  const toolsTokens = estimateTools(input.tools);
  const declaredOutput = Math.min(
    input.model.maxOutputTokens !== undefined && input.model.maxOutputTokens > 0
      ? input.model.maxOutputTokens
      : Number.POSITIVE_INFINITY,
    // 观测输出上限（meter 从第③类报错学来，经读数透出）；缺省不参与
    input.outputBase !== undefined && input.outputBase > 0
      ? input.outputBase
      : Number.POSITIVE_INFINITY,
  );

  /** 发送前的降档（§4.6 四档）：scale = 端点读数与本地估算的偏差倍数（首试 1）。
   *  ceiling = 硬线；端点自报上限更小时取它。装不下返回 undefined。 */
  const fitTranscript = (scale: number, trimAll: boolean, ceiling: number): Fitted | undefined => {
    const messages = [...input.messages];
    const instructionTokens = estimateText(input.instruction);
    const over = (): boolean =>
      (estimateMessages(messages) + instructionTokens + toolsTokens) * scale + input.summaryOut >
      ceiling;

    // 第 1 档：装不下就从转写尾部裁（尾部不被遮蔽，也不依赖摘要）。
    // 只裁尾部消息（trimLimit 限定），头部留给第 3/4 档；系统提示永不裁（I-4）。
    let trimBudget = trimAll
      ? Number.POSITIVE_INFINITY
      : (input.trimLimit ?? Number.POSITIVE_INFINITY);
    const lastTrimmable = (): number => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role !== "system") return index;
      }
      return -1;
    };
    while (messages.length > 1 && trimBudget > 0 && over()) {
      const index = lastTrimmable();
      if (index < 0) break;
      // 按单元边界裁：tool 消息必须连同所属 assistant（带 toolCalls）一起裁——
      // 只裁结果会留下悬空调用，端点直接 400
      let start = index;
      if (messages[index]?.role === "tool") {
        while (start > 0 && messages[start - 1]?.role === "tool") start -= 1;
        const owner = messages[start - 1];
        if (owner?.role !== "assistant" || owner.toolCalls === undefined) break;
        start -= 1;
      }
      const count = index - start + 1;
      if (count > trimBudget) break;
      messages.splice(start, count);
      trimBudget -= count;
    }

    // 第 2 档：超长工具结果换头尾摘录；第 3/4 档：头部只留后一半 / 后 35%。
    // 降的是转写，替换区间不变（compaction.md §4.6）。
    let omittedTurns = 0;
    if (over()) shrinkToolResults(messages);
    if (over()) {
      const dropped = dropLeading(messages, 0.5);
      omittedTurns += Math.max(dropped.assistants, dropped.users);
    }
    if (over()) {
      const dropped = dropLeading(messages, 0.35);
      omittedTurns += Math.max(dropped.assistants, dropped.users);
    }
    // 降档丢掉的头部轮次要告诉模型（否则摘要会宣称覆盖全部历史）
    let instruction = input.instruction;
    let finalInstructionTokens = instructionTokens;
    if (omittedTurns > 0) {
      instruction = `${input.instruction}\n\nNote: the earliest ${omittedTurns} turns were not included in this transcript; do not claim to cover them.`;
      finalInstructionTokens = estimateText(instruction);
    }
    const inputEstimate =
      (estimateMessages(messages) + finalInstructionTokens + toolsTokens) * scale;
    if (inputEstimate + input.summaryOut > ceiling) return undefined;
    const maxTokens = Math.floor(
      Math.min(SUMMARY_OUTPUT_MAX, declaredOutput, Math.max(1, ceiling - inputEstimate)),
    );
    return { messages, instruction, inputEstimate, maxTokens, omittedTurns };
  };

  let fitted = fitTranscript(1, false, input.hardLimit);
  if (fitted === undefined) {
    return {
      ok: false,
      code: "SUMMARY_TOO_LARGE",
      message: `summary input does not fit the hard limit (${input.hardLimit}) even after four tiers`,
    };
  }

  // 端点自报溢出（本地估算低估）→ 按 actual / 估算 的比例重算预算再降档重发。
  // 四家里 ZCode/CC 按报错差额裁轮次、opencode 有 85/70/50/35% 四步重试（§4.6）
  for (let attempt = 0; ; attempt += 1) {
    const textParts: string[] = [];
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let finishReason = "unknown";
    let toolCalls = 0;
    try {
      for await (const event of input.llm.stream(
        {
          model: input.model,
          messages: [...fitted.messages, { role: "user", content: fitted.instruction }],
          tools: [...input.tools],
          sessionId: input.sessionId,
          ...(input.reasoningEffort !== undefined
            ? { reasoningEffort: input.reasoningEffort }
            : {}),
          maxTokens: fitted.maxTokens,
        },
        input.signal,
      )) {
        if (input.signal.aborted) {
          return {
            ok: false,
            code: "ABORTED",
            message: "compaction interrupted",
            interrupted: true,
          };
        }
        switch (event.type) {
          case "text-delta":
            textParts.push(event.text);
            break;
          case "tool-call":
            toolCalls += 1;
            break;
          case "usage":
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
          default:
            break;
        }
      }
    } catch (err) {
      if (input.signal.aborted) {
        return { ok: false, code: "ABORTED", message: "compaction interrupted", interrupted: true };
      }
      const shaped = err as {
        code?: unknown;
        message?: unknown;
        limit?: unknown;
        actual?: unknown;
      };
      const code = typeof shaped.code === "string" ? shaped.code : "SUMMARY_REQUEST_FAILED";
      if (attempt < 2 && code === LLM_ERROR_CONTEXT_OVERFLOW) {
        const retry = retryFit(fitted, shaped);
        if (retry !== undefined) {
          fitted = retry;
          continue;
        }
        return {
          ok: false,
          code: "SUMMARY_TOO_LARGE",
          message: `summary request exceeded the provider window after ${attempt + 1} attempts`,
        };
      }
      return {
        ok: false,
        code,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    if (input.signal.aborted) {
      return { ok: false, code: "ABORTED", message: "compaction interrupted", interrupted: true };
    }
    if (toolCalls > 0) {
      return { ok: false, code: "SUMMARY_TOOL_CALL", message: "summary requested tool calls" };
    }
    if (finishReason !== "stop") {
      return {
        ok: false,
        code: "SUMMARY_UNFINISHED",
        message: `summary finished with ${finishReason}`,
      };
    }
    const text = textParts.join("").trim();
    if (text === "") {
      return { ok: false, code: "SUMMARY_EMPTY", message: "summary text is empty" };
    }
    if (estimateText(text) >= input.maskedTokens) {
      return {
        ok: false,
        code: "SUMMARY_NOT_SMALLER",
        message: `summary (${estimateText(text)}) is not smaller than masked content (${input.maskedTokens})`,
      };
    }
    return {
      ok: true,
      text,
      usage,
      ...(fitted.omittedTurns > 0 ? { omittedTurns: fitted.omittedTurns } : {}),
    };
  }

  /** 溢出重试的预算：端点读数 / 本次估算（输入 + 输出预留）的比例，钳 1.05–4；
   *  端点自报上限更小时以它为硬线，并允许裁光整段尾部 */
  function retryFit(
    previous: Fitted,
    error: { limit?: unknown; actual?: unknown },
  ): Fitted | undefined {
    const limit =
      typeof error.limit === "number" && error.limit > 0 ? error.limit : input.hardLimit;
    const actual = typeof error.actual === "number" && error.actual > 0 ? error.actual : undefined;
    const estimatedSent = previous.inputEstimate + previous.maxTokens;
    const ratio = actual !== undefined && estimatedSent > 0 ? actual / estimatedSent : 1.25;
    const scale = Math.min(4, Math.max(1.05, ratio)) * 1.02;
    return fitTranscript(scale, true, Math.min(limit, input.hardLimit));
  }
}
