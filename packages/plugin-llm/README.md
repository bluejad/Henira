# @reins/plugin-llm

llm 槽位官方插件：StreamEvent 契约实现 + AI SDK 适配器。AI SDK 直接用不自研（D-007 钉死）；openai-compatible 通吃 OpenAI 兼容端点，provider 形状由配置驱动、引擎零厂商备表（D-040 / P9-4）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) protocol 段 llm 部分（2026-11-16 定稿）
- 循环权在 loop：streamText 以 `stopWhen` 单步运行——适配器只管一次请求周期，不自己续圈

## 用法

```ts
import { llmPlugin } from "@reins/plugin-llm";

createHarness().use(llmPlugin()); // 无 options；inject: ["config"]——装配里必须有 config 槽（次序由拓扑排序解决，缺失 start 一次报全）
```

模型与凭据全走配置（D-013② / D-030）：默认模型住 `settings.json`、baseUrl 覆盖住 `models.json`、key 只住 `credentials.json`（0600）——本适配器自身不读 env / 文件。离线测试用 [@reins/llm-mock](../llm-mock/README.md) 直接实现 `LlmService`（不开 HTTP）。真实回合装配见 [examples/real](../../examples/real/README.md)。

## 文件 ↔ 设计

| 文件            | 职责                                                                                                                                                                                                                                                     | 设计出处                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| stream-parts.ts | AI SDK TextStreamPart → protocol StreamEvent（AI SDK 边界收口于此，入向借用 SDK 类型、出向词表是自己的）；P3 三不变量在此落地——argsText 恒原始文本（装配器自攒 delta，不靠 SDK 已解析 input）、invalid tool-call 部件不产事件、finish 先 usage 后 reason | interfaces.md protocol 段 P3；[zcode] runner-normalization 同构 |
| messages.ts     | 引擎消息 → AI SDK 消息（适配器是唯一翻译点，D-040；P1 不变量保证此处可从日志重建）                                                                                                                                                                       | D-040 / P1                                                      |
| provider.ts     | provider 解析——形状由配置驱动，无 `if (provider === …)` 厂商表；baseUrl 必填于 ModelConfig                                                                                                                                                               | D-040 / P9-4                                                    |
| service.ts      | llmPlugin（占 'llm' 槽，inject: ["config"]）——凭据只经 ConfigService 取，不读 env / 文件；maxRetries: 0（重试政策机随 M5 压缩批）                                                                                                                        | D-013② / D-030                                                  |

## 测试 ↔ 判据

| 测试                 | 锁什么                                                         |
| -------------------- | -------------------------------------------------------------- |
| stream-parts.test.ts | P3 三不变量映射侧（roadmap M2 判据⑥）+ 截断 tool-call 不产事件 |
| messages.test.ts     | 消息翻译各 role / 工具结果回灌                                 |
