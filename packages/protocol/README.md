# @henira/protocol

契约层：槽位接口（SlotMap 7 槽）+ 引擎 DTO + 封闭词表。零运行时依赖（[packages.md](../../docs/20-architecture/packages.md) 规则 1），所有插件的公共依赖——工具参数"同形零转换"（D-044）从这里开始。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) protocol 段（2026-11-16 定稿）
- 事件表与注册表：[session.md](../../docs/20-architecture/session.md) §2 / §3

## 文件 ↔ 设计

| 文件           | 职责                                                                                    | 设计出处                                         |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| envelope.ts    | 会话事件信封 + 首行头（type 第一键 / version 在头）                                     | session.md §2                                    |
| registry.ts    | 事件注册表：开放 map，校验器 = 最小 duck 接口（不认 schema 库牌子）                     | session.md §3 / D-051                            |
| context.ts     | 类型化门面（asHeniraContext）+ SlotMap 7 槽                                             | interfaces.md kernel 段「类型化门面在 protocol」 |
| services.ts    | SessionService 契约（含 readonly directory）                                            | interfaces.md protocol 段                        |
| llm.ts         | StreamEvent 5 变体 / LlmError / FinishReason 5 值 / LlmRequest / LlmService             | interfaces.md protocol 段（2026-11-16 定稿）     |
| tools.ts       | ToolDefinition（裸 JSON Schema）/ ToolContext / ToolResult / ToolOutcome / ToolsService | tools-approval.md §1 / D-044 / D-046             |
| approval.ts    | Decision 四值 / PermissionRule / GateVerdict / mergeGateVerdict / ApprovalService       | tools-approval.md §3 / D-039                     |
| interaction.ts | InteractionService（M2 审批专用；settle 先答者赢）                                      | interfaces.md protocol 段                        |
| config.ts      | ConfigService（model / get 异步，文件 backing）                                         | interfaces.md protocol 段 / D-013②               |
| loop.ts        | LoopService / LoopEvent 7 变体 / TurnEndReason 7 值 / QueuedPrompt                      | loop.md §1 / D-045                               |

## 测试 ↔ 判据

| 测试             | 锁什么                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| registry.test.ts | 注册表派生清单；新增插件事件类型不需改核心代码（roadmap M1 判据③）                                                    |
| context.test.ts  | SlotMap 编译期检查（7 槽）与类型化门面                                                                                |
| contract.test.ts | 封闭词表钉住（DECISIONS / FINISH_REASONS / TurnEndReason）+ SlotMap 7 槽 + InteractionService settle 先答者赢参考实现 |
