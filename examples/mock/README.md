# examples/mock

离线可跑的最小装配示例：官方引擎四件（session / tools / approval / loop）+ mock llm + 真 config-loader，mock LLM 确定性驱动——不联网、不花钱，兼作 vitest e2e。

- 运行：`pnpm --filter @reins/example-mock test`（e2e 断言）；`node --experimental-strip-types src/main.ts`（演示）
- 装配即宿主职责的编程形态（D-016 三步）：官方插件经公共注册路径 `.use()`，mock llm / 自动应答 InteractionService / 真 config-loader（临时目录种子 settings.json）与真插件同一条路径
- 真实模型对照：[examples/real](../real/README.md)（自备 key，env 门控不进 CI）

## 文件 ↔ 设计

| 文件        | 职责                                                                                                                                                                 | 设计出处                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| assemble.ts | assembleMock 五件套装配 + autoAnswerInteraction（headless 自动应答，耗尽后默认 allowed-once）+ echoTool（最小只读演示工具，档案见 [tools/echo.md](./tools/echo.md)） | D-016 / packages.md 槽位实现归属 |
| e2e.test.ts | 完整回合 + 会话文件回放（readSessionFile 路径入参）+ 拒绝路径（`[permission:rejected]` + 审计对落盘）                                                                | roadmap M2 判据① / P1            |
| main.ts     | 命令行演示入口                                                                                                                                                       | —                                |

## 测试 ↔ 判据

| 测试        | 锁什么                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------- |
| e2e.test.ts | roadmap M2 判据①：mock LLM 驱动完整回合（工具调用 → 结果回灌 → 文本收尾）、会话可回放、拒绝路径 |
