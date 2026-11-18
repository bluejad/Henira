// 思考能力表（合同层——BC reasoningCapabilityOf 在其 protocol/dto 同位）：provider id 前缀 →
// 该厂商 OpenAI 兼容端点接受的思考参数族。models-dev 快照是瘦身版（无 reasoning 能力标记），
// 能力归此表；llm 适配器映射请求参数、/api/models 出 UI 提示（思考档置灰依据）同源消费。
// none = 无参数族（deepseek 原生思考不可控 / agnes / 未知厂商）——UI 置灰「—」，适配器不透传。

import type { ReasoningEffort } from "./llm.js";

export type ReasoningCapability = "effort" | "thinking" | "enable" | "none";

const THINKING_PREFIXES = ["zhipu", "glm", "bigmodel", "chatglm"];
const ENABLE_PREFIXES = ["qwen", "dashscope", "aliyun"];
const EFFORT_PREFIXES = ["openai", "azure"];

export function reasoningCapability(providerId: string): ReasoningCapability {
  const id = providerId.toLowerCase();
  if (THINKING_PREFIXES.some((p) => id.startsWith(p))) return "thinking";
  if (ENABLE_PREFIXES.some((p) => id.startsWith(p))) return "enable";
  if (EFFORT_PREFIXES.some((p) => id.startsWith(p))) return "effort";
  return "none";
}

/** capability → OpenAI 兼容请求体附加参数（providerOptions 透传形状）；none / effort+off 无参数 = undefined */
export function reasoningParams(
  capability: ReasoningCapability,
  effort: ReasoningEffort,
): Record<string, unknown> | undefined {
  switch (capability) {
    case "effort":
      // openai 系无 "off" 档——off 不透传（模型侧不收该值）
      return effort === "off" ? undefined : { reasoning_effort: effort };
    case "thinking":
      return { thinking: { type: effort === "off" ? "disabled" : "enabled" } };
    case "enable":
      return { enable_thinking: effort !== "off" };
    case "none":
      return undefined;
  }
}
