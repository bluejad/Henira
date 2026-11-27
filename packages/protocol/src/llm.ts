// llm 槽位契约与流事件 DTO（interfaces.md protocol 段，2026-11-16 定稿）。
// 失败不走事件：流以 rejection 终止、携带 LlmError（opencode 类型化错误通道同构，
// [opencode] packages/ai/src/schema/errors.ts:32-156）；中断由 loop 先查自有
// AbortController 再诊断（P6 纪律 1）。

import type { InterleavedSpec, ReasoningOption } from "./reasoning.js";
import type { ModelMessage } from "./services.js";

/** 裸 JSON Schema（D-044）：协议唯一形状——模型投影 / MCP tools/list / AI 创建内容包同形零转换 */
export type JsonSchema = Record<string, unknown>;

/** 模型配置：能力字段由 models.dev 字典预填、手写覆盖（D-040）；不含凭据（D-013②） */
export interface ModelConfig {
  /** 供应商标识（credentials / 字典键） */
  provider: string;
  /** 模型 id */
  model: string;
  /** OpenAI 兼容端点（自建 / 代理） */
  baseUrl?: string;
  /** 能力字段——引擎内禁止厂商备表（P9-4），只从配置解析 */
  contextWindow?: number;
  maxOutputTokens?: number;
  /** 思考参数形态（models.dev reasoning_options——档位集合数据真源） */
  reasoningOptions?: ReasoningOption[];
  /** 思维链回传声明（models.dev interleaved——开思考时历史 assistant 回传 reasoning_content） */
  interleaved?: InterleavedSpec;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/** 封闭词表（对齐 AI SDK finish reason 集；error / other 映射 unknown + 流 rejection） */
export const FINISH_REASONS = [
  "stop",
  "tool-calls",
  "length",
  "content-filter",
  "unknown",
] as const;
export type FinishReason = (typeof FINISH_REASONS)[number];

/** 溢出类错误码（compaction.md §4.12）：上下文超窗走压缩恢复；max_tokens 参数错是
 *  封顶引起的另一类，压缩救不了，恢复 = 去掉封顶原步重发一次 */
export const LLM_ERROR_CONTEXT_OVERFLOW = "CONTEXT_OVERFLOW";
export const LLM_ERROR_OUTPUT_LIMIT_EXCEEDED = "OUTPUT_LIMIT_EXCEEDED";
/** 空完成（D-095）：正文空白、无工具调用、finish stop——重试一次仍空时按此码落错误行 */
export const LLM_ERROR_EMPTY_COMPLETION = "EMPTY_COMPLETION";

/** 适配器边界上值得带到引擎的附加信息（报错原文自带精确读数，§3.2） */
export interface LlmErrorInfo {
  /** 已解析的响应体（APICallError.data）或原始文本（responseBody） */
  body?: unknown;
  /** 报错里自报的上限（窗口或输出上限） */
  limit?: number;
  /** 报错里自报的实际数（请求的输入 / max_tokens） */
  actual?: number;
}

/** llm 流失败的类型化错误（rejection 通道，不进 StreamEvent） */
export class LlmError extends Error {
  readonly body?: unknown;
  readonly limit?: number;
  readonly actual?: number;

  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
    info?: LlmErrorInfo,
  ) {
    super(message);
    this.name = "LlmError";
    if (info?.body !== undefined) this.body = info.body;
    if (info?.limit !== undefined) this.limit = info.limit;
    if (info?.actual !== undefined) this.actual = info.actual;
  }
}

/** provider 静默超时错误码（R193）：适配器空闲看门狗抛出 → loop 原样进 ErrorRow.code；
 *  web-ui 据此把英文原文翻成可行动中文（慢不猜、死有超时——模型活性归引擎层判） */
export const LLM_STREAM_IDLE_TIMEOUT_CODE = "LLM_STREAM_IDLE_TIMEOUT";

/** 流空闲默认上限（毫秒）：任何一次 provider part 等待超过此值即判死。
 *  覆盖口 = settings.json plugins."plugin-llm".options.streamIdleTimeoutMs；
 *  180s 是「慢思考不误杀（Agnes 实测单段思考 83s）／真死能收口」的折中（ZCode 600s、dsh 300s） */
export const DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS = 180_000;

// StreamEvent：封闭判别联合（不变量见 P3，测试锁定）：
// ① tool_call 的 argsText 恒为模型原始 JSON 文本；② usage 先于 finish；③ tool_call 流末集中发。
export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; callId: string; name: string; argsText: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "finish"; reason: FinishReason };

/** 思考档封闭词表（关/低/中/高/最高——「最高」承载厂商的 max 档，
 * 如 DeepSeek reasoning_effort 三档 low/high/max 完整呈现；档位集合由 models.dev
 * reasoning_options 数据决定子集）。随每次提问携带（PromptOptions）；厂商无对应参数时
 * 适配器不透传（reasoningCapability=none），档位不影响请求 */
export const REASONING_EFFORTS = ["off", "low", "medium", "high", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface LlmRequest {
  model: ModelConfig;
  messages: ModelMessage[];
  tools: WireToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** 思考档（按次覆盖；适配器按厂商能力映射到请求参数，none 厂商忽略） */
  reasoningEffort?: ReasoningEffort;
  /** 本请求所属会话（不透明；只供厂商要求的「每对话稳定」路由/缓存头使用，如
   * opencode 家族的 x-opencode-session——适配器不得用它做任何语义决策） */
  sessionId?: string;
}

/** tools.project() 的产物 = 模型可见清单形状 */
export interface WireToolSchema {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface LlmService {
  stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}
// prepareCall 从 M2 契约移除（无消费者；M1 纪律：只有定稿契约进 protocol）——
// contextWindow 经 ModelConfig 解析（P3），压缩预算接口随 M5 压缩设计文档回归。
