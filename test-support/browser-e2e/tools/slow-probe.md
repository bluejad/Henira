# slow-probe

只读慢工具（forms.e2e 插话 steer 样本）：无参数、执行睡眠 150ms 后回 `slow done`。带 `isConcurrencySafe: true`——默认放行层放行。慢执行窗给测试留出"忙时入队 → steer 升格 → step 边界进场"的确定性时序。

| 项           | 值                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用途         | 插话形态：执行窗内入队 + steer 升格，断言 user 行带 steer 徽章                                                                                       |
| 参数         | 无                                                                                                                                                   |
| 输出         | `content` = `slow done`（固定，150ms 后）                                                                                                            |
| 截断行为     | 不自行截断；统一出口限量照管（tools-approval §1.1）                                                                                                  |
| 权限类       | 只读（`isConcurrencySafe: true`）——默认放行层放行，无审批                                                                                            |
| 错误情形     | 无参数可错                                                                                                                                           |
| 参考实现出处 | 形状 = @henira/protocol `ToolDefinition`（[interfaces.md](../../../docs/20-architecture/interfaces.md) protocol 段）；插话语义见 loop.md §1（D-045） |

源码：[../src/forms.e2e.ts](../src/forms.e2e.ts)（`slow`）。
