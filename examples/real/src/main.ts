// examples/real —— 真实模型 smoke（roadmap M2 判据⑦）。
// 门槛（env 门控，不进 CI）：
//   1. 全局配置 ~/.henira/config/settings.json 写默认模型（"<provider>/<model>"），
//      models.json 写 baseUrl（默认适配器走 OpenAI 兼容线协议）；
//   2. credentials.json (0600) 写 providers.<provider> 的 key（D-030：key 不进代码 / env / git）；
//   3. 跑：pnpm --filter @henira/example-real start
// 无凭据 / 无默认模型 → 打印引导后退出（不抛——demo 友好）。

import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  CredentialMissingError,
  createConfigService,
  NoDefaultModelError,
} from "@henira/config-loader";
import { createHarness } from "@henira/kernel";
import { approvalPlugin } from "@henira/plugin-approval";
import { llmPlugin } from "@henira/plugin-llm";
import { loopPlugin } from "@henira/plugin-loop";
import { sessionPlugin } from "@henira/plugin-session";
import { toolsPlugin } from "@henira/plugin-tools";
import { asHeniraContext } from "@henira/protocol";

const globalDir = process.env.HENIRA_CONFIG_DIR ?? path.join(homedir(), ".henira", "config");
const configService = createConfigService({ cwd: process.cwd(), globalDir });

let modelId: string;
try {
  const model = await configService.model(); // 读 settings 默认模型（含字典能力字段）
  modelId = `${model.provider}/${model.model}`;
} catch (err) {
  if (err instanceof NoDefaultModelError) {
    console.log(
      '未配置默认模型：在 ~/.henira/config/settings.json 写 { "model": "<provider>/<model>" } 后重试。',
    );
    process.exit(0);
  }
  throw err;
}
try {
  await configService.credential(modelId.split("/")[0] as string); // 只探在不在（值不打印，D-030）
} catch (err) {
  if (err instanceof CredentialMissingError) {
    console.log(
      `缺少 ${modelId.split("/")[0]} 的凭据：写入 ~/.henira/config/credentials.json (0600) 后重试。`,
    );
    process.exit(0);
  }
  throw err;
}

const sessionDir = await fs.mkdtemp(path.join(tmpdir(), "henira-real-"));
const harness = createHarness()
  .use(sessionPlugin({ directory: sessionDir, cwd: process.cwd() }))
  .use(toolsPlugin({}))
  .use(llmPlugin())
  .use({
    name: "interaction",
    start() {
      // headless 缺省应答器：fail-closed 演示——写类工具会被拒，只读免问（D-039 默认放行层）
      return {
        ask: async (req) => {
          console.log(`[审批卡] ${req.toolName}（headless 自动拒绝——只读工具不会走到这里）`);
          return { kind: "approval", requestId: req.requestId, decision: "rejected" as const };
        },
        settle: () => false,
        listPending: () => [],
      };
    },
  })
  .use(approvalPlugin())
  .use({ name: "config", start: () => configService }) // config 槽位（与 mock 装配同一条路径）
  .use(loopPlugin());
await harness.start();
const ctx = asHeniraContext(harness.context);

ctx.get("tools").register({
  name: "list-cwd",
  description: "List entries in the current working directory",
  inputSchema: { type: "object", properties: {} },
  isConcurrencySafe: true,
  execute: async (_args, toolCtx) => ({
    content: (await fs.readdir(toolCtx.cwd)).join("\n") || "(empty)",
  }),
});

console.log(`真实模型 smoke：${modelId}（会话目录 ${sessionDir}）`);
for await (const event of ctx.get("loop").run("列出当前目录并总结里面有什么")) {
  console.log(`[loop] ${event.type}`, "text" in event ? event.text.slice(0, 60) : "");
}
await harness.dispose();
