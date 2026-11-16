// provider 解析（D-040：引擎零厂商备表——provider 形状由配置驱动，此处无 if (provider === 'xxx')；
// openai-compatible 通吃 OpenAI 兼容端点：OpenAI / DeepSeek / GLM / 自建代理，baseUrl 必填于 ModelConfig）。

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { ModelConfig } from "@henira/protocol";

export interface ProviderRuntime {
  /** 适配器运行期唯一网络依赖注入点：密钥由调用方从 ConfigService 取（D-013② / D-030） */
  apiKey: string;
}

export function resolveLanguageModel(
  config: ModelConfig,
  runtime: ProviderRuntime,
): LanguageModelV4 {
  if (!config.baseUrl) {
    // 引擎内禁止厂商备表（P9-4）：没有 baseUrl 又不知道 provider 形状 → 配置错误，报给装配方
    throw new Error(
      `model "${config.provider}/${config.model}" has no baseUrl; ` +
        "the default adapter speaks the OpenAI-compatible wire — set baseUrl in the model config",
    );
  }
  const provider = createOpenAICompatible({
    name: config.provider,
    baseURL: config.baseUrl,
    apiKey: runtime.apiKey,
  });
  return provider.chatModel(config.model);
}
