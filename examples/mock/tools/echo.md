# echo

只读演示工具：把入参 `text` 原样回显。examples/mock e2e 的最小工具样本——示范一个符合 ToolDefinition 契约的完整工具长什么样。

| 项           | 值                                                                                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用途         | 回显调用方给的文本；给 e2e 提供一条可断言的工具调用路径                                                                                                                                                                             |
| 参数         | `text`（string，必填）——原样回显的对象                                                                                                                                                                                              |
| 输出         | `content` = `text` 原文（ToolResult.content）                                                                                                                                                                                       |
| 截断行为     | 不自行截断；统一出口限量照管（默认 2000 行 / 50KB，超限完整输出落盘留路径 + 预览 + 尾注——tools-approval §1.1）                                                                                                                      |
| 权限类       | `isConcurrencySafe: true`（只读）——判定链默认放行层自动过（tools-approval §3）；改成 `false` 即走审批问询（e2e 拒绝路径测试即此形态，自动应答器答 rejected → `[permission:rejected]` 错误结果）                                     |
| 错误情形     | 缺 `text` / 类型不符 → parseArgs（ajv draft-07）结构化错误结果回模型，回合不炸                                                                                                                                                      |
| 参考实现出处 | 演示用最小工具，无外部借鉴；形状 = @reins/protocol `ToolDefinition`（[interfaces.md](../../../docs/20-architecture/interfaces.md) protocol 段），管线行为见 [tools-approval.md](../../../docs/20-architecture/tools-approval.md) §2 |

源码：[../src/assemble.ts](../src/assemble.ts)（`echoTool`）。
