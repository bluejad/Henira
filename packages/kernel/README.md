# @henira/kernel

微内核：只做装配与事件机制，不认识任何业务接口（D-012②）。四种事件派发模式 + inject 依赖图 + 静态装配（D-011，不做热加载）+ 可逆卸载。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) kernel 段（已定稿）
- 包边界：[packages.md](../../docs/20-architecture/packages.md) 依赖规则 1（运行时零依赖）
- 语义钉子：[40-roadmap.md](../../docs/40-roadmap.md) M1 判据②（D-023，cordis 边界五条）

## 用法

```ts
import { asHeniraContext } from "@henira/protocol";
import { createHarness } from "@henira/kernel";

const harness = createHarness().use(sessionPlugin).use(toolsPlugin); // use() 只能在 start() 前（静态装配，D-011）
await harness.start(); // inject 缺失 / 依赖环在这里一次报全（topology.ts）
const tools = asHeniraContext(harness.context).get("tools"); // 类型化门面取槽位
await harness.dispose(); // 可逆卸载（D-023 钉子有测试）
```

一个插件 = 一个 `ServiceDefinition`（省略 `name` = 不占槽位的纯行为件）；事件四模式挂 `ctx.events`。完整五件套装配见 [examples/mock](../../examples/mock/README.md)。〔minimal composition 段式照 [dsh] packages/fs/tool-fs/README.md〕

## 文件 ↔ 设计

| 文件        | 职责                                                                                                               | 设计出处                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| events.ts   | 四种派发模式（emit / on / onSerial / waterfall），派发语义对齐 cordis（[dsh] vendor/cordis/src/events.ts）         | D-012①                                      |
| harness.ts  | createHarness 装配内核：use() → start() → dispose()；卸载语义对齐 cordis fiber（[dsh] vendor/cordis/src/fiber.ts） | D-011 / D-023                               |
| topology.ts | 静态装配分析：inject 缺失一次报全 + 依赖环检测 + Kahn 拓扑排序                                                     | interfaces.md kernel 段「四情况必须报清楚」 |
| types.ts    | 机制类型（ServiceDefinition / Disposable / FaultReporter）——kernel 不认识业务接口                                  | D-012②                                      |
| errors.ts   | 内核错误词表（消息英文，D-050 第 2 款）                                                                            | interfaces.md kernel 段                     |

## 测试 ↔ 判据

| 测试            | 锁什么                                                    |
| --------------- | --------------------------------------------------------- |
| events.test.ts  | 四模式派发语义（waterfall 短路 / emit 隔离 / 快照派发）   |
| harness.test.ts | 装配 / 卸载 / inject 图 / 可逆 effect（roadmap M1 判据①） |
| nails.test.ts   | D-023 语义钉子五条，一行一测试（roadmap M1 判据②）        |
