// plugin-llm 服务件（packages.md：StreamEvent 契约实现 + AI SDK 适配器，占 'llm' 槽）。
// 凭据按 D-013② 经 ConfigService.credential(provider) 取——适配器不读 env / 文件。
// streamText 以 stopWhen: [once] 单步运行——循环权在 loop 插件，适配器只管一次请求周期；
// 工具不交给 SDK 执行（执行是引擎侧 tools 管线的事，含审批）。

import type { ServiceDefinition } from "@henira/kernel";
import {
  asHeniraContext,
  type LlmRequest,
  type LlmService,
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
          const result = streamText({
            model,
            ...(instructions ? { instructions } : {}), // system 块唯一通道（AI SDK 不收 system 消息）
            messages: toAiMessages(req.messages),
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
