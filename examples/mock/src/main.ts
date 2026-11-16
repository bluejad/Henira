// examples/mock 可运行演示：mock LLM 完整回合，打印 LoopEvent 与派生历史。
// 运行：pnpm --filter @henira/example-mock start（Node ≥22.6 类型剥离；离线无需 key）。
// 同一条装配路径的断言版 = src/e2e.test.ts（vitest）。

import { mockFinish, mockText, mockToolCall, mockUsage } from "@henira/llm-mock";
import { assembleMock } from "./assemble.js";

const USAGE = { inputTokens: 12, outputTokens: 6 };

const { ctx, dispose } = await assembleMock({
  script: [
    [
      mockToolCall("c1", "echo", '{"text":"hello from mock"}'),
      mockUsage(USAGE),
      mockFinish("tool-calls"),
    ],
    [mockText("工具说：hello from mock"), mockUsage(USAGE), mockFinish("stop")],
  ],
});

for await (const event of ctx.get("loop").run("演示回合")) {
  console.log(`[loop] ${event.type}`);
}
console.log("--- 派生历史（P1：模型可见 ⟺ 已落日志）---");
for (const message of ctx.get("session").deriveMessages()) {
  console.log(`[${message.role}]`, "content" in message ? message.content.slice(0, 80) : "");
}
await dispose();
