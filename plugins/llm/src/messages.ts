// 引擎消息 → AI SDK 消息（D-040：适配器是唯一翻译点；P1 不变量保证此处可从日志重建）。
// system 角色不进 messages 数组——AI SDK 拒收（InvalidPromptError），单独走 streamText
// 的 instructions 选项（toAiInstructions）；这是真模型 smoke 揪出的映射层缺陷（mock 不经此层）。
// 思维链回传（思考档批 2026-11-19）：本次请求开思考且模型声明 interleaved（reasoning_content）
// 时，历史 assistant 消息拼一个 reasoning part——AI SDK openai-compatible 会自动发
// reasoning_content（DeepSeek V4.1+ 带 tool_calls 不回传 400）；关思考 = 全剥（严格网关安全）。

import type { ModelMessage } from "@henira/protocol";
import type { ModelMessage as AiModelMessage, ToolResultPart } from "ai";

/** system 块合并为 instructions 文本（多块按序空行连接；无 system = 空串，调用方据此省略选项） */
export function toAiInstructions(messages: readonly ModelMessage[]): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
}

export function toAiMessages(
  messages: readonly ModelMessage[],
  opts?: { echoReasoning?: boolean },
): AiModelMessage[] {
  const echo = opts?.echoReasoning === true;
  return messages.flatMap<AiModelMessage>((message): AiModelMessage[] => {
    switch (message.role) {
      case "system":
        return []; // 不进 messages——见 toAiInstructions
      case "user":
        // 附件（图片 / 文件进模型上下文）随 M4 附件批定稿后扩展；M2 文本会话
        return [{ role: "user", content: message.content }];
      case "assistant": {
        // 思维链 part（echo 关闭 = 空——不回传；历史消息缺 reasoning 也跳过）
        const reasoningParts =
          echo && message.reasoning !== undefined && message.reasoning !== ""
            ? [{ type: "reasoning" as const, text: message.reasoning }]
            : [];
        if (!message.toolCalls || message.toolCalls.length === 0) {
          if (reasoningParts.length === 0) {
            return [{ role: "assistant", content: message.content }];
          }
          return [
            {
              role: "assistant",
              content: [
                ...reasoningParts,
                ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
              ],
            },
          ];
        }
        return [
          {
            role: "assistant",
            content: [
              ...reasoningParts,
              ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
              ...message.toolCalls.map((call) => ({
                type: "tool-call" as const,
                toolCallId: call.callId,
                toolName: call.name,
                // 日志侧 arguments 恒为模型原始 JSON 文本（P3-1）；此处解析回对象上送。
                // 解析失败 = 会话账本被外部改坏，fail-loud 不静默（P2 降级必须可见）。
                input: JSON.parse(call.arguments),
              })),
            ],
          },
        ];
      }
      case "tool": {
        const part: ToolResultPart = {
          type: "tool-result",
          toolCallId: message.callId,
          toolName: message.name,
          output: message.isError
            ? { type: "error-text", value: message.content }
            : { type: "text", value: message.content },
        };
        return [{ role: "tool", content: [part] }];
      }
      default:
        // 封闭联合兜底：新角色加入 protocol 时编译在此报错（P3 封闭判别联合纪律）
        throw new Error(`unreachable message role: ${JSON.stringify(message)}`);
    }
  });
}
