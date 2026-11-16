// 消息翻译测试：引擎 ModelMessage → AI SDK ModelMessage（P1 的出向对偶）。

import { describe, expect, it } from "vitest";
import { toAiMessages } from "./messages.js";

describe("toAiMessages", () => {
  it("system / user 直通", () => {
    expect(
      toAiMessages([
        { role: "system", content: "你是" },
        { role: "user", content: "hi" },
      ]),
    ).toEqual([
      { role: "system", content: "你是" },
      { role: "user", content: "hi" },
    ]);
  });

  it("assistant 无工具 = 纯文本；有工具 = text part + tool-call parts（arguments 解析回对象）", () => {
    expect(
      toAiMessages([
        { role: "assistant", content: "我看一下" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ callId: "c1", name: "read", arguments: '{"path":"a.txt"}' }],
        },
      ]),
    ).toEqual([
      { role: "assistant", content: "我看一下" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "read", input: { path: "a.txt" } },
        ],
      },
    ]);
  });

  it("assistant 空内容 + 工具时不产空 text part", () => {
    const msgs = toAiMessages([
      { role: "assistant", content: "", toolCalls: [{ callId: "c1", name: "t", arguments: "{}" }] },
    ]);
    expect(msgs[0].content).toHaveLength(1);
  });

  it("tool 结果：isError → error-text output（模型可见错误形态）", () => {
    expect(
      toAiMessages([{ role: "tool", callId: "c1", name: "read", content: "boom", isError: true }]),
    ).toEqual([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "read",
            output: { type: "error-text", value: "boom" },
          },
        ],
      },
    ]);
  });

  it("账本被外部改坏（arguments 非 JSON）→ fail-loud 不静默（P2）", () => {
    expect(() =>
      toAiMessages([
        {
          role: "assistant",
          content: "",
          toolCalls: [{ callId: "c", name: "t", arguments: "{截断" }],
        },
      ]),
    ).toThrow();
  });
});
