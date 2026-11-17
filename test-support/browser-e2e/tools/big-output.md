# big-output

只读大输出工具（forms.e2e 输出截断样本）：无参数、回 60KB 文本（`TRUNCATION-MARK` 头 + 填充）。带 `isConcurrencySafe: true`——默认放行层放行。超出口限量（默认 2000 行 / 50KB）触发截断全链：头部保留 + `[truncated]` 尾注进 content、完整输出 spill 到会话 `artifacts/<callId>.txt`、`truncated{path,preview}` 落账 → 工具卡截断徽章（M4 批 A：ToolContext.artifactsDir 接线）。

| 项           | 值                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 用途         | 截断形态：徽章 + 尾注 + spill 落盘事实断言（测试递归找 `c1.txt`）                                                                              |
| 参数         | 无                                                                                                                                             |
| 输出         | `content` = 60KB 文本（出口限量后为头部 + 尾注）                                                                                               |
| 截断行为     | 必然触发出口限量（被测行为本身）                                                                                                               |
| 权限类       | 只读（`isConcurrencySafe: true`）——默认放行层放行，无审批                                                                                      |
| 错误情形     | 无参数可错                                                                                                                                     |
| 参考实现出处 | 出口限量见 [tools-approval.md](../../../docs/20-architecture/tools-approval.md) §1.1 与 tools limits；形状 = @henira/protocol `ToolDefinition` |

源码：[../src/forms.e2e.ts](../src/forms.e2e.ts)（`big`）。
