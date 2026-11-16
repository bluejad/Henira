# examples/real — 真实模型 smoke

一个带工具调用的真实回合（roadmap M2 判据⑦）。**env 门控：没有凭据就只打印引导，不进 CI。**

## 准备（三个文件，全在 `~/.reins/config/`）

1. `settings.json` — 默认模型：

   ```json
   { "version": 1, "model": "zhipuai/glm-4.6" }
   ```

2. `models.json` — baseUrl（默认适配器走 OpenAI 兼容线协议，D-007 / D-040；能力字段已由
   models.dev 字典预填，手写覆盖字典）：

   ```json
   { "providers": { "zhipuai": { "baseUrl": "https://open.bigmodel.cn/api/paas/v4" } } }
   ```

3. `credentials.json`（权限 0600）— key 只住这里（D-030），不进代码 / env / git：

   ```json
   { "providers": { "zhipuai": "<你的 API key>" } }
   ```

## 跑

```sh
pnpm install
pnpm --filter @reins/example-real start
```

回合内容：`list-cwd`（只读工具）列目录 → 模型总结。只读工具走默认放行层免问（D-039）；
写类工具会被 headless 应答器自动拒绝（fail-closed 演示）。

会话文件落在临时目录（stdout 打印），`session.v1.jsonl` 可直接回放。
