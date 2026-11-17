# @henira/e2e-browser

浏览器端到端测试（Playwright 无头 chromium）：真浏览器跑通 serve 链路——静态页出货 → SSE 帧流 → 发回合 → 审批卡收答 → 流式渲染 → 主题切换 → 安全模式，全程截图留档。roadmap M4「浏览器 e2e 进 CI + 截图留档」判据的具名载体；jsdom 组件级测试（packages/web）不替代本包（长效规矩：凡交付界面的里程碑必须有真浏览器 e2e + 截图，ADR 随 M4 计划立）。

- 测试链路：`createServer`（进程内起真 server，tmp dataDir/globalDir 不碰真实家目录）+ [llm-mock](../llm-mock/README.md) 脚本化 LLM + probe 工具（非只读 → 走审批缝）+ 自托管页面（packages/web dist-web，server 自动发现托管）。浏览器侧与真实用法同一条链：`createClient` 同源连 server、哑渲染器行 store、审批经 REST 收答。
- 发现并锁住的真 bug：`?ui=safe` 自托管入口漏接线（main.tsx 只解析 token，未传 safeMode——判据④承诺双通道；本包安全模式用例锁住修复）。

## 运行

```sh
pnpm install
pnpm build                            # server 等包 dist（e2e 运行时 import）
pnpm --filter @henira/web bundle      # 产出 packages/web/dist-web（静态页）
pnpm --filter @henira/e2e-browser exec playwright install chromium   # 首次
pnpm test:e2e
```

CI 同序（workflow 内 `--with-deps chromium` 装 OS 依赖），截图上传为 artifact（`artifacts/`，不入库）。

真 key 采样（**不进 CI**）：`HENIRA_REAL=1 pnpm exec playwright test src/real.e2e.ts`——起真 `henira serve`（读用户真实 `~/.henira/config`），对 models.json 里每家 provider 逐形态真实 prompt（markdown/代码块/表格/长输出），截图 `artifacts/real/`。凭据纪律 D-030：key 只在 credentials.json，永不进代码/日志/CI。

## 文件 ↔ 设计

| 文件                 | 职责                                                                                                                                                             | 设计出处                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| playwright.config.ts | testMatch 只认 `*.e2e.ts`（vitest 不扫——`pnpm test` 与浏览器 e2e 双轨互不干扰）；失败 trace 留档                                                                 | CI 纪律（AGENTS.md）                                         |
| src/serve.e2e.ts     | 两个用例：①serve 链路回合（busy 停止钮 / 审批卡收答 / 流式中断言 + 截图 / 新会话 + 会话切换 / 明暗双主题截图）②安全模式双通道（`?ui=safe` + 双击 Alt）           | roadmap M4 浏览器 e2e 判据 / 判据④ / interfaces.md server 段 |
| src/forms.e2e.ts     | mock 逐形态验收（M4 批 A 判据③ mock 半边）：推理块+usage / 错误回合 / 审批拒绝 / 中断收尾 / 多工具并行 / 插话 steer / 输出截断（每用例独立 server + 截图 10-16） | roadmap M4 判据③ / D-057 / D-059                             |
| src/real.e2e.ts      | 真 key 采样（env 门控不进 CI）：真 serve + 切 provider 逐形态真实 prompt + 截图 real/                                                                            | roadmap M4 判据③（真 key 半边）                              |
| tools/probe.md       | probe 工具档案（非只读审批样本）                                                                                                                                 | AGENTS.md 一工具一 md                                        |

## 测试 ↔ 判据

| 用例                       | 锁什么                                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| serve 链路回合（5 张截图） | 静态页出货 + 自动选会话；busy 停止钮可见；审批卡 pending → 点允许 → 工具执行 → 流式（`.henira-streaming`）→ 完成；`+ 新会话`（POST /api/sessions）+ 列表切换；主题 light→dark 落 `[data-theme]`；截图：审批卡 / 流式中 / 完成·浅色 / 完成·深色 |
| 安全模式双通道             | `?ui=safe` 直达安全模式（徽标可见）；双击 Alt 运行时切换来回（判据④两条通道都活）                                                                                                                                                              |

选择器全部取自 locale 字典（`import { zh } from "@henira/plugin-web-ui"`）——文案改词表这里跟着改，选择器不硬编码中文；用例内字符串一律 ASCII（判据⑥机械闸同纪律）。
