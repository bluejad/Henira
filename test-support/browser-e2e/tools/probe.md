# probe

非只读演示工具：收一个 `question` 参数、回一句固定 `pong`。browser-e2e 的审批路径样本——没有 `isConcurrencySafe: true`（非只读），判定链默认放行层不放、必走审批问询（tools-approval §3），给浏览器 e2e 提供一张真实挂起的审批卡。

| 项           | 值                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 用途         | 触发审批挂起 → 浏览器收答全链（卡渲染 / 点允许 / 工具执行 / 结果行）                                                                                                                                                                 |
| 参数         | `question`（string，必填）——只进审批卡的 argsSummary，不参与输出                                                                                                                                                                     |
| 输出         | `content` = `pong`（固定）                                                                                                                                                                                                           |
| 截断行为     | 不自行截断；统一出口限量照管（tools-approval §1.1）                                                                                                                                                                                  |
| 权限类       | 非只读（无 `isConcurrencySafe`）——`tools/pre-execute` 判定链落到审批缝，`ServerInteraction.ask` 挂起真审批；浏览器点「允许」→ `allowed-once` → 执行                                                                                  |
| 错误情形     | 缺 `question` / 类型不符 → parseArgs 结构化错误结果回模型，回合不炸                                                                                                                                                                  |
| 参考实现出处 | 演示用最小工具，无外部借鉴；形状 = @henira/protocol `ToolDefinition`（[interfaces.md](../../../docs/20-architecture/interfaces.md) protocol 段），审批语义见 [tools-approval.md](../../../docs/20-architecture/tools-approval.md) §3 |

源码：[../src/serve.e2e.ts](../src/serve.e2e.ts)（`probeTool`）。
