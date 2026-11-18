// llm 槽位契约与流事件 DTO（interfaces.md protocol 段，2026-11-16 定稿）。
// 失败不走事件：流以 rejection 终止、携带 LlmError（opencode 类型化错误通道同构，
// [opencode] packages/ai/src/schema/errors.ts:32-156）；中断由 loop 先查自有
// AbortController 再诊断（P6 纪律 1）。

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

/** llm 流失败的类型化错误（rejection 通道，不进 StreamEvent） */
export class LlmError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

// StreamEvent：封闭判别联合（不变量见 P3，测试锁定）：
// ① tool_call 的 argsText 恒为模型原始 JSON 文本；② usage 先于 finish；③ tool_call 流末集中发。
export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; callId: string; name: string; argsText: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "finish"; reason: FinishReason };

/** 思考档封闭词表（BC ReasoningSelect 语义：关/低/中/高）。随每次提问携带（PromptOptions）；
 * 厂商无对应参数时适配器不透传（reasoningCapability=none），档位不影响请求 */
export const REASONING_EFFORTS = ["off", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface LlmRequest {
  model: ModelConfig;
  messages: ModelMessage[];
  tools: WireToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** 思考档（按次覆盖；适配器按厂商能力映射到请求参数，none 厂商忽略） */
  reasoningEffort?: ReasoningEffort;
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
