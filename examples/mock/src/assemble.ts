// 五件套装配（examples/mock：离线可跑，兼作 vitest e2e 载体——roadmap M2 判据①）。
// 装配 = 宿主职责（D-016 三步的编程形态）：官方插件经公共注册路径 .use()，
// mock LLM / 自动应答 InteractionService / 临时 ConfigService 与真插件同一条路径。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConfigService } from "@henira/config-loader";
import { createHarness } from "@henira/kernel";
import { type MockEntry, mockLlm } from "@henira/llm-mock";
import { approvalPlugin } from "@henira/plugin-approval";
import { askUserPlugin } from "@henira/plugin-ask-user";
import { breakerPlugin } from "@henira/plugin-breaker";
import { fsPlugin } from "@henira/plugin-fs";
import { fsSearchPlugin } from "@henira/plugin-fs-search";
import { fsToolsPlugin } from "@henira/plugin-fs-tools";
import { loopPlugin } from "@henira/plugin-loop";
import { sessionPlugin } from "@henira/plugin-session";
import { shellPlugin } from "@henira/plugin-shell";
import { shellToolsPlugin } from "@henira/plugin-shell-tools";
import { toolsPlugin } from "@henira/plugin-tools";
import {
  asHeniraContext,
  type Decision,
  type HeniraContext,
  type InteractionAnswer,
  type InteractionRequest,
  type InteractionService,
  type LlmService,
  type ServiceDefinition,
  type ToolDefinition,
} from "@henira/protocol";

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
          // 提问（R184）：headless 自动答首选项（无选项 = 纯文本题，跳过）——语义与审批的
          // 自动应答队列无关，保证 examples/离线测试不会卡死在提问上
          if (req.kind === "question") {
            return Promise.resolve({
              kind: "question",
              requestId: req.requestId,
              answers: req.questions.map((q) => ({
                id: q.id,
                selected: q.options?.[0] !== undefined ? [q.options[0].label] : [],
              })),
            });
          }
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

/** shell 形状 meta 的演示工具（E5 per-tool 卡离线载体；content 与 __meta 同源分字段） */
export const demoShellTool: ToolDefinition = {
  name: "demo_shell",
  description: "Demo tool returning a shell-shaped result (readonly)",
  inputSchema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  isConcurrencySafe: true,
  execute: async (args) => ({
    content: `${String(args.command)} output\n[exit code: 0]`,
    __meta: {
      kind: "shell",
      exitCode: 0,
      stdout: `${String(args.command)} output`,
      stderr: "",
    },
  }),
};

/** 装配 + start；返回类型化上下文与关键槽位 */
export async function assembleMock(options: MockAssemblyOptions): Promise<{
  harness: ReturnType<typeof createHarness>;
  ctx: HeniraContext;
  sessionDir: string;
  dispose: () => Promise<void>;
}> {
  const sessionDir =
    options.sessionDir ?? (await fs.mkdtemp(path.join(tmpdir(), "henira-example-")));
  const mock = mockLlm(options.script);
  const globalDir = await fs.mkdtemp(path.join(tmpdir(), "henira-example-config-"));
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
    // fs / shell 能力族 + 熔断件（D-065：官方 defaultPreset 的 examples 聚合同形）
    .use(fsPlugin())
    .use(fsToolsPlugin())
    .use(fsSearchPlugin())
    .use(shellPlugin())
    .use(shellToolsPlugin())
    .use(breakerPlugin())
    // 提问件（R184）：ask_user 工具 + question/* 审计对
    .use(askUserPlugin())
    .use({
      name: "config",
      start: () => createConfigService({ cwd: sessionDir, globalDir }),
    })
    .use(loopPlugin());
  await harness.start();
  const ctx = asHeniraContext(harness.context);
  for (const tool of options.tools ?? [echoTool, demoShellTool]) {
    ctx.get("tools").register(tool);
  }
  return {
    harness,
    ctx,
    sessionDir,
    dispose: () => harness.dispose(),
  };
}
