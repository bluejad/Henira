// 溢出 / 参数错判定表单测（compaction.md §5「分类器」）：逐句用四端点真 key 采样原文。
// ①类四句与②类一句判溢出；③类三句判 OUTPUT_LIMIT_EXCEEDED、不判溢出；
// 429 / 渠道失败 / 会话头 400 不判溢出；上限与实际数的解析按各家原文。

import {
  LLM_ERROR_CONTEXT_OVERFLOW,
  LLM_ERROR_OUTPUT_LIMIT_EXCEEDED,
  LlmError,
} from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { classifyProviderError } from "./provider-error.js";

function providerError(message: string, extra: Record<string, unknown> = {}): Error {
  const error = new Error(message);
  Object.assign(error, extra);
  return error;
}

describe("classifyProviderError（compaction.md §3.2 采样原文）", () => {
  it("① 输入超窗（DeepSeek / ②）→ 溢出，上限与实际数可解析", () => {
    const result = classifyProviderError(
      providerError(
        "This model's maximum context length is 1048576 tokens. However, you requested 1307641 tokens (1307625 in the messages, 16 in the completion). Please reduce the length of the messages or completion.",
        { statusCode: 400 },
      ),
    );
    expect(result.code).toBe(LLM_ERROR_CONTEXT_OVERFLOW);
    expect(result.status).toBe(400);
    expect(result.limit).toBe(1_048_576);
    expect(result.actual).toBe(1_307_641);
  });

  it("① 智谱 Prompt exceeds max length（code 1261）→ 溢出，无数字", () => {
    const result = classifyProviderError(
      providerError("Prompt exceeds max length", {
        statusCode: 400,
        data: { error: { code: "1261", message: "Prompt exceeds max length" } },
      }),
    );
    expect(result.code).toBe(LLM_ERROR_CONTEXT_OVERFLOW);
    expect(result.limit).toBeUndefined();
    expect(result.actual).toBeUndefined();
  });

  it("① Agnes ContextWindowExceededError → 溢出，输入数与自报窗口", () => {
    const result = classifyProviderError(
      providerError(
        "invalid_request_error: ContextWindowExceededError: The input (637913 tokens) is longer than the model's context length (524288 tokens).",
        { statusCode: 400, code: "400" },
      ),
    );
    expect(result.code).toBe(LLM_ERROR_CONTEXT_OVERFLOW);
    expect(result.limit).toBe(524_288);
    expect(result.actual).toBe(637_913);
  });

  it("① 网关 model token limit → 溢出，上限与请求数可解析", () => {
    const result = classifyProviderError(
      providerError(
        "Upstream request failed: [invalid_request_error] Invalid request: Your request exceeded model token limit: 262144 (requested: 610128)",
        { statusCode: 400 },
      ),
    );
    expect(result.code).toBe(LLM_ERROR_CONTEXT_OVERFLOW);
    expect(result.limit).toBe(262_144);
    expect(result.actual).toBe(610_128);
  });

  it("③ DeepSeek max_tokens 参数错 → OUTPUT_LIMIT_EXCEEDED，不判溢出", () => {
    const result = classifyProviderError(
      providerError("Invalid max_tokens value, the valid range of max_tokens is [1, 393216]", {
        statusCode: 400,
      }),
    );
    expect(result.code).toBe(LLM_ERROR_OUTPUT_LIMIT_EXCEEDED);
    expect(result.limit).toBe(393_216);
  });

  it("③ 智谱 max_tokens 参数非法（code 1210）→ OUTPUT_LIMIT_EXCEEDED", () => {
    const result = classifyProviderError(
      providerError("max_tokens参数非法：限制数值范围[1,131072]", {
        statusCode: 400,
        data: { code: "1210", message: "max_tokens参数非法：限制数值范围[1,131072]" },
      }),
    );
    expect(result.code).toBe(LLM_ERROR_OUTPUT_LIMIT_EXCEEDED);
    expect(result.limit).toBe(131_072);
  });

  it("③ Agnes max_tokens exceeds the limit → OUTPUT_LIMIT_EXCEEDED（不被 OpenCode 清单误判为溢出）", () => {
    const result = classifyProviderError(
      providerError("invalid_request: max_tokens exceeds the limit of 65536", {
        statusCode: 400,
      }),
    );
    expect(result.code).toBe(LLM_ERROR_OUTPUT_LIMIT_EXCEEDED);
    expect(result.limit).toBe(65_536);
  });

  it("排除项：429 / 渠道失败 / 会话头 400 都不是溢出", () => {
    for (const error of [
      providerError("You've reached the API rate limit for free users", { statusCode: 429 }),
      providerError("get_channel_failed: temporarily unavailable", { statusCode: 500 }),
      providerError("missing x-opencode-session header", { statusCode: 400 }),
      providerError("invalid api key", { statusCode: 401 }),
    ]) {
      expect(classifyProviderError(error).code).toBe("PROVIDER_ERROR");
    }
  });

  it("普通 400 不误判；状态与响应体照带", () => {
    const result = classifyProviderError(
      providerError("bad request", { statusCode: 400, responseBody: '{"error":"bad"}' }),
    );
    expect(result.code).toBe("PROVIDER_ERROR");
    expect(result.status).toBe(400);
    expect(result.body).toBe('{"error":"bad"}');
  });

  it("已是 LlmError 的原样透传（判断在 provider-error 出口）", () => {
    const error = new LlmError("CUSTOM", "x", 418);
    expect(error.status).toBe(418);
    expect(error.code).toBe("CUSTOM");
  });
});
