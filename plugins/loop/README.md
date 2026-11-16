# @henira/plugin-loop

loop 槽位官方插件：turn/step 状态机 + 忙时投递（排队持久化 + 插话升格）+ 16ms 增量攒批 + 中断纪律五条。循环权独占：续跑判据 = 收到的 tool-call 事件，不信 finish reason。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) protocol 段 loop 部分
- 设计文档：[loop.md](../../docs/20-architecture/loop.md)（§2 纪律 / §3 攒批 / §4 缝载荷已定稿）
- 忙时投递唯一化：D-045；基底系统块英文：D-050 第 2 款

## 用法

```ts
import { loopPlugin } from "@henira/plugin-loop";

createHarness().use(loopPlugin()); // options: { maxStepsPerTurn? }——可选默认不设（D-045）

for await (const event of ctx.get("loop").run(prompt, signal)) consume(event);
ctx.get("loop").send(text); // 闲 = 直开回合；忙 = 入队（queue.json）
ctx.get("loop").steer(entryId); // 插话升格：step 边界进场，不打断工具
ctx.get("loop").interrupt(); // 掐当前回合
```

## 文件 ↔ 设计

| 文件       | 职责                                                                                                                                                                                                                                                               | 设计出处                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| turn.ts    | runTurnCore / runStep：steer 在 step 边界领取（工具落定后、下次请求前冲全部插话）；中断纪律①–⑤（先查 aborted 再诊断 / 无孤儿 tool-call / 已启动工具跑完按真实结果结算 / inflight 事件兜底补发 / 错误落盘为事件——回合级 catch 让 ENGINE 错误也进事件，纪律⑤完全体） | loop.md §2                                  |
| queue.ts   | PromptQueue：会话目录 queue.json，tmp + rename 原子重写；重启恢复 = start 时装载；队列状态不进事件账本（队列不是对话事实）                                                                                                                                         | D-045 / loop.md §1 / P9-1                   |
| batcher.ts | DeltaBatcher：16ms 攒批（首包不等待——定时器与首事件竞速；结构事件永不攒批，flushNow 兜底）；16ms = 一帧，Claude Code 的渲染闸同值（行为层）                                                                                                                        | loop.md §3                                  |
| prompts.ts | 基底系统块（key `loop/base`，英文永不本地化——引擎提示词不受界面 locale 约束）                                                                                                                                                                                      | session.md §4 / D-050                       |
| service.ts | loopPlugin（占 'loop' 槽）：EventChannel 泵 run() 生成器 / send()（闲 = 直开回合、忙 = 入队）/ steer（插话升格）/ interrupt；LoopBusyError                                                                                                                         | interfaces.md protocol 段 loop 部分 / D-045 |

## 测试 ↔ 判据

| 测试                   | 锁什么                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| loop-interrupt.test.ts | 纪律①–⑤五个具名测试，一行一测试（roadmap M2 判据②）                                                                  |
| loop-turn.test.ts      | 忙时投递 / 插话 step 边界进场不打断工具 / 队列重启恢复 / maxStepsPerTurn 可选上限默认不设（roadmap M2 判据③，D-045） |
| batcher.test.ts        | 首包立即 + 窗口攒批 + 结构事件透传 + flushNow 兜底                                                                   |
