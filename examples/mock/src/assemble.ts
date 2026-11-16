// 五件套装配（examples/mock：离线可跑，兼作 vitest e2e 载体——roadmap M2 判据①）。
// 装配 = 宿主职责（D-016 三步的编程形态）：官方插件经公共注册路径 .use()，
// mock LLM / 自动应答 InteractionService / 临时 ConfigService 与真插件同一条路径。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConfigService } from "@reins/config-loader";
import { createHarness } from "@reins/kernel";
import { type MockEntry, mockLlm } from "@reins/llm-mock";
import { approvalPlugin } from "@reins/plugin-approval";
import { loopPlugin } from "@reins/plugin-loop";
import { sessionPlugin } from "@reins/plugin-session";
import { toolsPlugin } from "@reins/plugin-tools";
import {
  asReinsContext,
  type Decision,
  type InteractionAnswer,
  type InteractionRequest,
  type InteractionService,
  type LlmService,
  type ReinsContext,
  type ServiceDefinition,
  type ToolDefinition,
} from "@reins/protocol";

export interface MockAssemblyOptions {
  /** 脚本化 StreamEvent 序列（一次模型调用一条） */
  script: readonly MockEntry[];
  /** 注册的工具（默认给一个只读 echo） */
  tools?: readonly ToolDefinition[];
  /** 自动应答器的 Decision 队列（耗尽后默认 allowed-once——headless 语义） */
  answers?: readonly Decision[];
  /** 会话目录（缺省临时目录） */
  sessionDir?: string;
}

/** 自动应答 InteractionService（examples 用 mock 自动答——packages.md 槽位实现归属） */
export function autoAnswerInteraction(
  answers: readonly Decision[] = [],
): ServiceDefinition<InteractionService> {
  const queue = [...answers];
  const requests: InteractionRequest[] = [];
  return {
    name: "interaction",
    start() {
      return {
        ask(req: InteractionRequest): Promise<InteractionAnswer> {
          requests.push(req);
          const decision = queue.shift() ?? "allowed-once";
          return Promise.resolve({ kind: "approval", requestId: req.requestId, decision });
        },
        settle: () => false,
        listPending: () => [],
      };
    },
  };
}

function llmStub(service: LlmService): ServiceDefinition<LlmService> {
  return { name: "llm", start: () => service };
}

export const echoTool: ToolDefinition = {
  name: "echo",
  description: "Echo back the given text (readonly demo tool)",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  isConcurrencySafe: true,
  execute: async (args) => ({ content: String(args.text) }),
};

/** 装配 + start；返回类型化上下文与关键槽位 */
export async function assembleMock(options: MockAssemblyOptions): Promise<{
  harness: ReturnType<typeof createHarness>;
  ctx: ReinsContext;
  sessionDir: string;
  dispose: () => Promise<void>;
}> {
  const sessionDir =
    options.sessionDir ?? (await fs.mkdtemp(path.join(tmpdir(), "reins-example-")));
  const mock = mockLlm(options.script);
  const globalDir = await fs.mkdtemp(path.join(tmpdir(), "reins-example-config-"));
  // 真配置服务的最小 settings（mock 模型——llm 是桩，config 只需给得出 ModelConfig）
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  const harness = createHarness()
    .use(sessionPlugin({ directory: sessionDir, cwd: sessionDir }))
    .use(toolsPlugin({}))
    .use(llmStub(mock.service))
    .use(autoAnswerInteraction(options.answers))
    .use(approvalPlugin())
    .use({
      name: "config",
      start: () => createConfigService({ cwd: sessionDir, globalDir }),
    })
    .use(loopPlugin());
  await harness.start();
  const ctx = asReinsContext(harness.context);
  for (const tool of options.tools ?? [echoTool]) {
    ctx.get("tools").register(tool);
  }
  return {
    harness,
    ctx,
    sessionDir,
    dispose: () => harness.dispose(),
  };
}
