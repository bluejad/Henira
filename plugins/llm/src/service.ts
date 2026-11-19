// plugin-llm 服务件（packages.md：StreamEvent 契约实现 + AI SDK 适配器，占 'llm' 槽）。
// 凭据按 D-013② 经 ConfigService.credential(provider) 取——适配器不读 env / 文件。
// streamText 以 stopWhen: [once] 单步运行——循环权在 loop 插件，适配器只管一次请求周期；
// 工具不交给 SDK 执行（执行是引擎侧 tools 管线的事，含审批）。

import type { SharedV4ProviderOptions } from "@ai-sdk/provider";
import type { ServiceDefinition } from "@henira/kernel";
import {
  asHeniraContext,
  type LlmRequest,
  type LlmService,
  reasoningCapability,
  reasoningEchoField,
  reasoningParams,
  type StreamEvent,
} from "@henira/protocol";
import { jsonSchema, streamText } from "ai";
import { toAiInstructions, toAiMessages } from "./messages.js";
import { resolveLanguageModel } from "./provider.js";
import { StreamEventMapper } from "./stream-parts.js";

/** 占 'llm' 槽的官方插件定义（inject config：凭据唯一通道，D-013②） */
export function llmPlugin(): ServiceDefinition<LlmService> {
  return {
    name: "llm",
    inject: ["config"],
    async start(ctx) {
      const config = asHeniraContext(ctx).get("config");
      const service: LlmService = {
        async *stream(req: LlmRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
          const apiKey = await config.credential(req.model.provider);
          const model = resolveLanguageModel(req.model, { apiKey });
          const mapper = new StreamEventMapper();
          const instructions = toAiInstructions(req.messages);
          // 思考档 → OpenAI 兼容请求体附加参数（能力表按厂商映射，合同层同源；
          // none 厂商 = undefined 不透传——deepseek 原生思考不可控等）。AI SDK
          // openai-compatible 把 providerOptions[providerName] 并入请求体（已知 chat
          // 选项键除外）——真实到达性经真端点活体验证（骨架批验收判据④）。
          const extraBody =
            req.reasoningEffort !== undefined
              ? reasoningParams(reasoningCapability(req.model.provider), req.reasoningEffort)
              : undefined;
          // 思维链回传（思考档批 2026-11-19）：开思考 + 模型声明 interleaved(reasoning_content)
          // → 历史 assistant 消息带 reasoning part（DeepSeek V4.1+ 带 tool_calls 不回传 400）
          const echoReasoning =
            req.reasoningEffort !== undefined &&
            req.reasoningEffort !== "off" &&
            reasoningEchoField(req.model.interleaved) === "reasoning_content";
          const result = streamText({
            model,
            ...(instructions ? { instructions } : {}), // system 块唯一通道（AI SDK 不收 system 消息）
            messages: toAiMessages(req.messages, { echoReasoning }),
            tools: Object.fromEntries(
              req.tools.map((tool) => [
                tool.name,
                // 裸 JSON Schema 直通（D-044：零转换）；execute 缺省 = SDK 侧不执行
                { inputSchema: jsonSchema(tool.inputSchema) },
              ]),
            ),
            toolChoice: req.tools.length > 0 ? "auto" : "none",
            abortSignal: signal,
            maxOutputTokens: req.maxTokens,
            temperature: req.temperature,
            ...(extraBody !== undefined
              ? {
                  providerOptions: {
                    [req.model.provider]: extraBody,
                  } as SharedV4ProviderOptions,
                }
              : {}),
            maxRetries: 0, // 重试政策机归引擎侧（M2 = 错误落盘收尾，M2 计划边界）
            stopWhen: () => true, // 单步：一次请求周期，不进 SDK 侧循环
          });
          for await (const part of result.fullStream) {
            for (const event of mapper.map(part)) yield event;
          }
          // 流自然结束（finish part 已映射）；SDK 中途失败 = fullStream 抛错 → 迭代抛出（rejection 通道）
        },
      };
      return service;
    },
  };
}
