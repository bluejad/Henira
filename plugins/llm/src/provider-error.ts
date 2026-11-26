// 溢出 / 参数错的判定表（compaction.md §3.2、§4.12；2026-11-26 四端点真 key 采样）。
// 只认自家端点真实报错：借来的清单两头都会错——OpenCode 的 `exceeds the limit of \d+`
// 会把 Agnes 的 max_tokens 参数错判成溢出，dsh 要求「超出」对象明确写着 context，
// 智谱与网关的措辞它又不认。
// 排除项先于匹配：429 / 配额 / 渠道失败 / 会话头 400 都不是溢出。

import {
  LLM_ERROR_CONTEXT_OVERFLOW,
  LLM_ERROR_OUTPUT_LIMIT_EXCEEDED,
  LlmError,
} from "@henira/protocol";

interface ProviderErrorShape {
  statusCode?: unknown;
  message?: unknown;
  responseBody?: unknown;
  data?: unknown;
  code?: unknown;
}

/** 不属于「上下文超窗」的 400/429（先排除，避免压缩被错误触发） */
const EXCLUSIONS =
  /rate limit|quota|too many requests|get_channel_failed|temporarily unavailable|unauthorized|authentication|invalid api key|api key|x-opencode-session|session header/i;

function textOf(error: ProviderErrorShape): string {
  const parts: string[] = [];
  if (typeof error.message === "string") parts.push(error.message);
  if (typeof error.responseBody === "string") parts.push(error.responseBody);
  if (error.data !== undefined) {
    try {
      parts.push(JSON.stringify(error.data));
    } catch {}
  }
  return parts.join("\n");
}

function numberAfter(text: string, pattern: RegExp, group = 1): number | undefined {
  const match = pattern.exec(text);
  if (match === null) return undefined;
  const value = Number(match[group]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

interface Classified {
  code: string;
  status?: number;
  body?: unknown;
  limit?: number;
  actual?: number;
}

/** 判定一个 provider 错误：溢出 / max_tokens 参数错 / 其它（原样 PROVIDER_ERROR） */
export function classifyProviderError(error: Error): Classified {
  const shape = error as Error & ProviderErrorShape;
  const text = textOf(shape);
  const status = typeof shape.statusCode === "number" ? shape.statusCode : undefined;
  const body = shape.data !== undefined ? shape.data : shape.responseBody;
  const parsedCode = typeof shape.code === "string" ? shape.code : undefined;

  // ③ 先判：所有采样里 max_tokens 参数错都带 max_tokens 字样，且不能当溢出（压缩救不了）
  const hasMaxTokens = /max_tokens/i.test(text);
  if (
    hasMaxTokens &&
    (parsedCode === "1210" ||
      /invalid|illegal|参数非法|非法|valid range|exceeds the limit|限制数值范围/i.test(text))
  ) {
    const limit =
      numberAfter(text, /valid range of max_tokens is \[\s*\d+\s*,\s*(\d+)\s*\]/i) ??
      numberAfter(text, /限制数值范围\s*\[\s*\d+\s*[,，]\s*(\d+)\s*\]/) ??
      numberAfter(text, /max_tokens exceeds the limit of\s+(\d+)/i);
    return {
      code: LLM_ERROR_OUTPUT_LIMIT_EXCEEDED,
      ...(status !== undefined ? { status } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(limit !== undefined ? { limit } : {}),
    };
  }

  // 排除项先于溢出匹配
  if (status === 429 || EXCLUSIONS.test(text)) {
    return {
      code: "PROVIDER_ERROR",
      ...(status !== undefined ? { status } : {}),
      ...(body !== undefined ? { body } : {}),
    };
  }

  const overflow =
    parsedCode === "1261" ||
    /maximum context length/i.test(text) ||
    /prompt exceeds max length/i.test(text) ||
    /contextwindowexceeded/i.test(text) ||
    /input \(\d+ tokens\) is longer than the model's context length/i.test(text) ||
    /exceeded model token limit/i.test(text) ||
    /context (?:length|window)/i.test(text) ||
    /prompt is too long/i.test(text);
  if (!overflow) {
    return {
      code: "PROVIDER_ERROR",
      ...(status !== undefined ? { status } : {}),
      ...(body !== undefined ? { body } : {}),
    };
  }

  let limit: number | undefined;
  let actual: number | undefined;
  // DeepSeek / 第②类：maximum context length is X tokens. However, you requested Y tokens
  limit = numberAfter(text, /maximum context length is\s+(\d+)\s+tokens/i);
  actual = numberAfter(text, /you requested\s+(\d+)\s+tokens/i);
  if (limit === undefined || actual === undefined) {
    // Agnes：input (N tokens) is longer than the model's context length (M tokens)
    const agnes =
      /input \((\d+)\s+tokens\) is longer than the model's context length \((\d+)\s+tokens\)/i.exec(
        text,
      );
    if (agnes !== null) {
      actual = Number(agnes[1]);
      limit = Number(agnes[2]);
    }
  }
  if (limit === undefined || actual === undefined) {
    // 网关：Your request exceeded model token limit: M (requested: N)
    const gateway = /exceeded model token limit:\s*(\d+)\s*\(requested:\s*(\d+)\)/i.exec(text);
    if (gateway !== null) {
      limit = Number(gateway[1]);
      actual = Number(gateway[2]);
    }
  }
  if (limit === undefined) limit = numberAfter(text, /context length \((\d+)\s+tokens\)/i);

  return {
    code: LLM_ERROR_CONTEXT_OVERFLOW,
    ...(status !== undefined ? { status } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    ...(actual !== undefined && Number.isFinite(actual) ? { actual } : {}),
  };
}

/** 在适配器边界把任意错误转成类型化 LlmError（状态 / 响应体 / 自报读数一并带上） */
export function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError") return new LlmError("ABORTED", error.message);
    const classified = classifyProviderError(error);
    return new LlmError(classified.code, error.message, classified.status, {
      ...(classified.body !== undefined ? { body: classified.body } : {}),
      ...(classified.limit !== undefined ? { limit: classified.limit } : {}),
      ...(classified.actual !== undefined ? { actual: classified.actual } : {}),
    });
  }
  return new LlmError("PROVIDER_ERROR", String(error));
}
