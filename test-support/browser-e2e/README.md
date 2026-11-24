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

CI 同序（workflow 内 `--with-deps chromium` 装 OS 依赖），截图上传为 artifact（`artifacts/`，不入库）；失败时另传 Playwright trace + error-context（`test-results/`，保留 7 天，排查慢机 flake 的现场）。

真 key 采样（**不进 CI**）：`HENIRA_REAL=1 pnpm exec playwright test src/real.e2e.ts`——起真 `henira serve`（读用户真实 `~/.henira/config`），对 models.json 里每家 provider 逐形态真实 prompt（markdown/代码块/表格/长输出），截图 `artifacts/real/`。凭据纪律 D-030：key 只在 credentials.json，永不进代码/日志/CI。

## 文件 ↔ 设计

| 文件                             | 职责                                                                                                                                                                                                                                                                       | 设计出处                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| playwright.config.ts             | testMatch 只认 `*.e2e.ts`（vitest 不扫——`pnpm test` 与浏览器 e2e 双轨互不干扰）；失败 trace 留档                                                                                                                                                                           | CI 纪律（AGENTS.md）                                         |
| src/serve.e2e.ts                 | 11 个用例：serve 链路回合（审批/流式/会话/明暗）· 轮尾操作（复制/分叉）· 安全模式双通道 · 目录区（新增/右键删）· 长会话（尾窗/虚拟化/翻页/回底）· fs 工具（写审批/行号）· 终端卡 keyed · E6 审批卡（diff/会话允许）· R184/R192 提问卡 · R176 流式期零列表请求 + 跨窗口同步 | roadmap M4 浏览器 e2e 判据 / 判据④ / interfaces.md server 段 |
| src/forms.e2e.ts                 | mock 逐形态验收（M4 批 A 判据③ mock 半边）9 用例：推理块+usage / 错误回合 / 审批拒绝 / 中断收尾 / 多工具并行 / 插话 steer / 排队卡（入队→插话→抢占→续冲） / 中断冻结 / 输出截断（每用例独立 server + 截图 10-20）                                                          | roadmap M4 判据③ / D-057 / D-059 / E1 / R193                 |
| src/real.e2e.ts                  | 真 key 采样（env 门控不进 CI）：真 serve + 切 provider 逐形态真实 prompt + 截图 real/                                                                                                                                                                                      | roadmap M4 判据③（真 key 半边）                              |
| src/permission.e2e.ts            | 权限模式（D-080）：ask 出卡 → full 免卡 → 刷新保持 → 切回出卡                                                                                                                                                                                                              | D-080                                                        |
| src/permission-rules.e2e.ts      | 命令级规则（R198/R199）：卡四钮 → 本会话允许精确命令 → 同命令免卡 → 菜单撤销 → 再出卡；项目允许写 permissions.json → 菜单计数 → 同命令免卡                                                                                                                                 | D-081 / D-082                                                |
| src/permission-management.e2e.ts | 权限管理面（R199）4 用例：会话规则面板逐条撤销 · 项目规则设置删除后同命令再出卡 · 长项目名不溢出设置弹窗 · 预置全局 allow 删除后再出卡（文件断言在 stop 前）                                                                                                               | D-082 / tools-approval §3.5                                  |
| src/persist.e2e.ts               | 界面持久化（D-063）：刷新还原 / 重启还原 / 右栏 tab 框架持久化（3 用例）                                                                                                                                                                                                   | D-063                                                        |
| src/plugins.e2e.ts               | UI 插件体系（批 C）4 用例：目录装载渲染 + 新版本免刷新重装 + 停用消失 / 安全模式不装载 / 崩溃件隔离 / 管理面停用                                                                                                                                                           | D-043 / D-048 / 判据④                                        |
| src/preview.e2e.ts               | 预览缝（R190）2 用例：插件按后缀接管 → 停用回落官方 / 最大化右栏预览可滚动                                                                                                                                                                                                 | D-076                                                        |
| src/mcp.e2e.ts                   | MCP 全链（C5）：未确认泵 failed → 管理面确认连接 → 新会话泵 live（真 stdio server）                                                                                                                                                                                        | D-064                                                        |
| src/models.e2e.ts                | 模型管理四视图：自定义厂商连接 → 分组/开关 → 选择器过滤 → 刷新还原                                                                                                                                                                                                         | D-040 / 模型管理批                                           |
| src/stall.e2e.ts                 | 卡死治理（R193）：provider 静默 → 空闲看门狗掐流 → 错误行 + busy 归 false                                                                                                                                                                                                  | D-077                                                        |
| src/layout.e2e.ts                | 布局对齐（R200/D-083 + R201/D-084）：滚动视口铺满中列；气泡右缘 = 输入卡右缘、正文左缘 = 卡片左缘；三栏卡片 4px 栏缝/四周贴窗/12px 圆角/1px 描边/最大化同圆；1024/1280/1920/右栏开合                                                                                       | D-083 / D-084                                                |
| src/send-prompt.ts               | 发送就绪闸（fill → 发送钮可用 → Enter → 草稿清空）：全部 spec 共用，CI 慢机空提交（R166 家族）防线                                                                                                                                                                         | AGENTS.md CI 纪律                                            |
| tools/probe.md                   | probe 工具档案（非只读审批样本）                                                                                                                                                                                                                                           | AGENTS.md 一工具一 md                                        |
| tools/echo-a.md                  | echo-a 工具档案（多工具并行样本之一）                                                                                                                                                                                                                                      | AGENTS.md 一工具一 md                                        |
| tools/echo-b.md                  | echo-b 工具档案（多工具并行样本之二）                                                                                                                                                                                                                                      | AGENTS.md 一工具一 md                                        |
| tools/slow-probe.md              | slow-probe 工具档案（插话 steer 样本：150ms 执行窗）                                                                                                                                                                                                                       | AGENTS.md 一工具一 md                                        |
| tools/big-output.md              | big-output 工具档案（输出截断样本：60KB 必然触发出口限量）                                                                                                                                                                                                                 | AGENTS.md 一工具一 md                                        |

## 测试 ↔ 判据

| 用例                          | 锁什么                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| serve 链路回合（4 张截图）    | 静态页出货 + 自动选会话；busy 停止钮可见；审批卡 pending → 点允许 → 工具执行 → 流式（`.henira-streaming`）→ 完成；`+ 新会话`（POST /api/sessions）+ 列表切换；主题 light→dark 落 `[data-theme]`；截图：审批卡 / 流式中 / 完成·浅色 / 完成·深色                            |
| 安全模式双通道                | `?ui=safe` 直达安全模式（徽标可见）；双击 Alt 运行时切换来回（判据④两条通道都活）                                                                                                                                                                                         |
| 权限管理面（R199，4 用例）    | 会话两条允许 → chip 面板撤一条 → 被撤命令再出卡、另一条免卡；项目允许 → 设置 › 权限删除 → permissions.json 规则空 → 同命令再出卡；长项目名不溢出；预置全局 allow → 设置删除 → 再出卡；每用例独立 temp dataDir/globalDir + 截图                                            |
| 布局对齐（R200/R201，1 用例） | 1024 窄窗（列比列宽窄）/1280/1920/右栏开合四组量数：滚动视口右缘=中列右缘、用户气泡右缘=输入卡右缘、正文左缘=卡片左缘、零横向溢出；三栏卡片栏缝 4px、四周贴窗（顶/底/左/右 0）、圆角 12px、描边 1px；最大化右栏 = 全屏圆角卡；红测去掉槽内缩差 15px→恢复 0；截图 layout-* |
| 界面持久化（D-063，3 用例）   | 刷新还原选中/草稿/侧栏宽/正文；同 dataDir 新 server 重启还原；右栏 tab 框架持久化                                                                                                                                                                                         |
| UI 插件体系（批 C，4 用例）   | 目录装载渲染 + 2s 指纹轮询免刷新重装 + 停用消失；安全模式不装载第三方件；崩溃件隔离；管理面停用                                                                                                                                                                           |
| 预览缝（R190，2 用例）        | 插件按 `.txt` 后缀接管 → 停用回落官方；最大化右栏预览仍可滚动                                                                                                                                                                                                             |
| MCP 全链（C5，1 用例）        | 未确认 → 泵 failed；管理面确认连接 → 新会话泵 live（真 stdio server）                                                                                                                                                                                                     |
| 模型管理（1 用例）            | 自定义厂商连接 → 分组/开关 → 选择器过滤 → 刷新还原                                                                                                                                                                                                                        |
| 卡死治理（R193，1 用例）      | 静默 provider → 1.5s 空闲看门狗 → `LLM_STREAM_IDLE_TIMEOUT` 错误行 + busy 归 false；等待期只走秒                                                                                                                                                                          |

选择器全部取自 locale 字典（`import { zh } from "@henira/plugin-web-ui"`）——文案改词表这里跟着改，选择器不硬编码中文；用例内字符串一律 ASCII（判据⑥机械闸同纪律）。
