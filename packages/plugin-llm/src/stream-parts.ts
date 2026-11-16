// AI SDK TextStreamPart → protocol StreamEvent（AI SDK 边界收口于此，zcode
// runner-normalization 同构：入向借用 SDK 类型，出向词表是自己的）。
// P3 三不变量在这里落地：①argsText 恒原始文本（装配器自攒，不靠 SDK 的已解析 input）
// ②usage 先于 finish（finish part 携带 usage → 先吐 usage 再吐 finish）
// ③tool-call 流末集中（deltas 只攒不吐，tool-call part 到达才发）。
// 截断 / 不可解析的 tool 调用不产 tool-call 事件（dsh max-tokens 丢块难题在我们契约下不存在）。

import { type FinishReason, LlmError, type StreamEvent, type TokenUsage } from "@reins/protocol";
import type {
  FinishReason as AiFinishReason,
  LanguageModelUsage,
  TextStreamPart,
  ToolSet,
} from "ai";

/** 工具调用原始参数装配器（dsh BlockAssembler 同构）：tool-input-start/delta/end 攒 argsText */
export class ToolCallAssembler {
  private pending = new Map<string, { name: string; argsText: string }>();

  start(id: string, name: string): void {
    this.pending.set(id, { name, argsText: "" });
  }

  /** 未知 id 也容忍——部分 provider 不发 start（或 start 带首个分片） */
  delta(id: string, delta: string): void {
    const entry = this.pending.get(id);
    if (entry) entry.argsText += delta;
    else this.pending.set(id, { name: "", argsText: delta });
  }

  /**
   * 取装配结果：已攒 → 原样返回并清除（不变量①）；providers 不发 deltas 时
   * 回退 JSON.stringify(parsedInput)（有损：键序 / 空白不保真——注释注明，P9-1 不影响账本）
   */
  take(id: string, parsedInput: unknown): string {
    const entry = this.pending.get(id);
    this.pending.delete(id);
    if (entry && entry.argsText !== "") return entry.argsText;
    return JSON.stringify(parsedInput ?? {});
  }
}

export function mapFinishReason(reason: AiFinishReason): FinishReason {
  switch (reason) {
    case "stop":
    case "tool-calls":
    case "length":
    case "content-filter":
      return reason;
    default:
      return "unknown"; // error / interrupted / other
  }
}

export function mapUsage(usage: LanguageModelUsage): TokenUsage | undefined {
  if (usage.inputTokens == null && usage.outputTokens == null) return undefined;
  return {
    inputTokens: usage.inputTokens ?? undefined,
    outputTokens: usage.outputTokens ?? undefined,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? undefined,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? undefined,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? undefined,
  };
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError") return new LlmError("ABORTED", error.message);
    return new LlmError("PROVIDER_ERROR", error.message);
  }
  return new LlmError("PROVIDER_ERROR", String(error));
}

/** 事件映射器：一次 stream() 一个实例（装配器状态随请求走） */
export class StreamEventMapper {
  readonly #assembler = new ToolCallAssembler();

  /** 一入多出（finish part 同时携带 usage 与 finish） */
  map(part: TextStreamPart<ToolSet>): StreamEvent[] {
    try {
      return this.#mapInner(part);
    } catch (err) {
      throw toLlmError(err);
    }
  }

  #mapInner(part: TextStreamPart<ToolSet>): StreamEvent[] {
    switch (part.type) {
      case "text-delta":
        return [{ type: "text-delta", text: part.text }];
      case "reasoning-delta":
        return [{ type: "reasoning-delta", text: part.text }];
      case "tool-input-start":
        this.#assembler.start(part.id, part.toolName);
        return [];
      case "tool-input-delta":
        this.#assembler.delta(part.id, part.delta);
        return [];
      case "tool-input-end":
        return [];
      case "tool-call": {
        // invalid（不可解析 / 不存在的工具）→ 不产事件：不落账本、无 dangling、模型下一步重试
        if ("invalid" in part && part.invalid === true) return [];
        return [
          {
            type: "tool-call",
            callId: part.toolCallId,
            name: part.toolName,
            argsText: this.#assembler.take(part.toolCallId, part.input),
          },
        ];
      }
      case "finish": {
        const events: StreamEvent[] = [];
        const usage = mapUsage(part.totalUsage);
        if (usage) events.push({ type: "usage", usage }); // 不变量②
        events.push({ type: "finish", reason: mapFinishReason(part.finishReason) });
        return events;
      }
      case "error":
        throw part.error; // 统一在 map() 出口转 LlmError（拒绝通道，不进 StreamEvent）
      default:
        return []; // start / start-step / finish-step / raw / ping 等结构 part 忽略
    }
  }
}
