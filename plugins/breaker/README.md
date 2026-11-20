# @henira/plugin-breaker

熔断件（D-058 / D-065）：死循环兜底，`loop/turn-stopping`（bail）缝的**首个生产消费者**。
无名件（不占槽位）、inject `["session", "config"]`、进 defaultPreset（v0.1.0 默认装配）、可停用
（不在内圈保护集）。**双机制**：

1. **回合内提醒**：观测 `tools/pre-execute`（waterfall 透传 `next(value)`，不否决不截流），
   签名 = 工具名 + 稳定序 JSON args；连续同形 ≥ 阈值 → 追加一条
   `user/message{source:"breaker"}` 英文提醒（模型下一步即见、自纠），封顶 `maxRemindersPerTurn`
   条/回合，`2×` 阈值档位可再提一条；
2. **回合尾否决**：计步（bus `step/start`）+ 记忆本回合重复；`onBail("loop/turn-stopping")`
   触发且超限 → `Veto{by:"plugin-breaker", reason, resume:{prompt}}`——loop 注入续跑提示并
   多跑一步。内核每回合只查一次缝 = 每回合至多一次否决干预。

- 契约出处：[loop.md](../../docs/20-architecture/loop.md) §4（turn-stopping 缝 / Veto 形状）
- 设计决定：[10-decisions.md](../../docs/10-decisions.md) D-058（批次归属）/ D-065（双机制落形）

## 阈值（默认必设，settings 可配）

| 阈值                | 默认 | settings 键（`plugins.plugin-breaker.options.*`） |
| ------------------- | ---- | ------------------------------------------------- |
| 步数 / 回合         | 50   | `maxStepsPerTurn`                                 |
| 同形重复提醒 / 否决 | 3    | `maxRepeatsPerCall`                               |
| 提醒条数 / 回合     | 2    | `maxRemindersPerTurn`                             |

工厂 opts（嵌入方兜底）< settings（用户面）。为什么双机制：纯否决盖不住「永不完成」的跑飞回合
（bail 缝只在回合将结束时触发），纯提醒又缺 D-013⑤ 要求的否决生产消费者——并集即本件。

## 边界

- 不做审批策略（approval 的事）、不做用户中断（中断纪律的事，D-058）；
- 提醒行 / veto 行在对话流可见（P2 失败可见；web 界面 source 药丸支持 `breaker`）；
- 引擎消息恒英文（D-050）。

## 文件 ↔ 设计

| 文件     | 职责                                                    | 设计出处                   |
| -------- | ------------------------------------------------------- | -------------------------- |
| index.ts | 双机制 + 阈值合并（默认 / 工厂 / settings）+ 回合状态机 | D-058 / D-065 / loop.md §4 |

判据 ↔ 测试：`breaker.test.ts`（提醒档位 / 封顶 / 不同形重置 / veto 一次 / 阈值可配 / 回合重置 6 例）

- examples/mock e2e「熔断件」（mock 连续同形 → 提醒行 + 回合尾 veto + resume 续跑一步，真 loop 全链）。
