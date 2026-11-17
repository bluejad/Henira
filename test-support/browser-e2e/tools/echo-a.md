# echo-a

只读演示工具（forms.e2e 多工具并行样本）：无参数、回固定 `a`。带 `isConcurrencySafe: true`——默认放行层直接放、与 echo-b 并行执行，给浏览器 e2e 提供"一个 step 两个 call 各占一行"的形态。

| 项           | 值                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| 用途         | 多工具并行形态：与 echo-b 同 step 两 call，断言两行工具卡                                                            |
| 参数         | 无                                                                                                                   |
| 输出         | `content` = `a`（固定）                                                                                              |
| 截断行为     | 不自行截断；统一出口限量照管（tools-approval §1.1）                                                                  |
| 权限类       | 只读（`isConcurrencySafe: true`）——默认放行层放行，无审批                                                            |
| 错误情形     | 无参数可错                                                                                                           |
| 参考实现出处 | 形状 = @henira/protocol `ToolDefinition`（[interfaces.md](../../../docs/20-architecture/interfaces.md) protocol 段） |

源码：[../src/forms.e2e.ts](../src/forms.e2e.ts)（`echo`）。
