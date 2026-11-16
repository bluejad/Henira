# list-cwd

只读演示工具：列出工具工作目录（ToolContext.cwd）下的条目。examples/real 真实模型 smoke 的配套工具——给模型一个安全的探查动作来演示带工具调用的真实回合。

| 项           | 值                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用途         | 列出当前工作目录条目（一行一个，空目录输出 `(empty)`），供真实模型 smoke 回合"列出当前目录并总结"使用                                                                                       |
| 参数         | 无（`inputSchema: { type: "object", properties: {} }`）                                                                                                                                     |
| 输出         | `content` = `fs.readdir(cwd)` 结果逐行拼接                                                                                                                                                  |
| 截断行为     | 不自行截断；统一出口限量照管（tools-approval §1.1）                                                                                                                                         |
| 权限类       | `isConcurrencySafe: true`（只读）——判定链默认放行层自动过，smoke 回合不被审批卡打断                                                                                                         |
| 错误情形     | 目录不可读 → fs 拒绝按管线错误路径落结构化错误结果（execute 抛错 → 管线包装为 isError 结果，回合照常收尾）                                                                                  |
| 参考实现出处 | 演示用最小工具，无外部借鉴；形状 = @henira/protocol `ToolDefinition`（[interfaces.md](../../../docs/20-architecture/interfaces.md) protocol 段），cwd 来自 ToolContext（tools-approval §1） |

源码：[../src/main.ts](../src/main.ts)（`list-cwd` 注册处）。
