# Agent Loop 设计

> 依据原则 **P6（loop 状态机 + 中断纪律）**、**P8（一切皆插件）**、**P9（红线）**。
> 定位：`plugin-loop` 是**官方 loop 插件**（官方预设默认装载；可被整包替换，中断纪律等语义责任随替换转移，见 D-010）。
> 状态：**已定稿**（2026-11-14 收口：忙时投递与插话、步数上限，D-045；2026-11-16 收口：三缝载荷类型）。loop 是全框架语义最重的插件，实施顺序放在其余语义插件之后。

---

## 1. 状态机（已定的两级结构）

```
turn（用户回合）
 └── step（一次模型请求周期）
      ├── request → 流式响应 → 纯文本：累加 → 结算 assistant/message → turn 可能结束
      └── request → 流式响应 → tool_calls：执行工具 → 结果回灌 → 下一个 step
```

- **Phase**：`idle | running`，per-phase AbortController；取消原因闭合计入 `turn/end.reason`（[session.md](./session.md) §2.4）；
- **inbox 唯一投递 = 排队（D-045）**：运行中 `send(prompt)` 进队列（闲时直接开新回合；回合结束后队列头部依次自动开新回合；**D-086：冲刷产生的回合在 `user/message` 带 `queueId` = 条目 id**——客户端把排队回执对回回合，直接发送 / 插话 / promote 不带）；队列条目可**"立即发送"（插话）**——该条在**下一个 step 边界**进场（工具结果落定后、下一次模型请求前，不打断正在执行的工具），落 `user/message` 按同轮时间线记账，**不新增账本事件类型**（队列状态不进事件账本，P9-1）；每条插话落账后广播 bus 事件 `user/steer`（观察者据此重置回合内状态——D-065 插话重置的观察口）；排队条目持久化在会话目录 `queue.json`（tmp+rename 原子重写），重启恢复。**队列可见面（E1，2026-11-20）**：`LoopService.pending()/remove(entryId)` 读删两能力 + 每次队列变更（入队/升格/删除/claim/冲刷）广播 bus 事件 `queue/changed`（载荷 = 当前条目快照）——server/sdk 经既有 `state.updated` 帧并线 `SessionState.queue` 推排队卡 UI（投影态非账本事实，P9-1 不变）；REST 面 `DELETE /api/sessions/:id/queue/:entryId` 与 prompt `steer` 参数同批落码。**中断冻结（2026-11-20）**：队列非空时中断 = 冲刷守卫接住不带走队列（否则 abort 信号传入冲刷循环，条目「生而为 abort」——user 行落账、零回复）；`LoopService.paused()/resume()` 冻结判据与显式恢复（resume 取队头开新回合，回合末照常自动续冲；冻结期间 `send()` 新消息 = 解冻开跑），UI 暂停横幅判据经 `SessionState.queuePaused` 同批并线；REST 面 `POST /api/sessions/:id/queue/resume`。**立即发送 = 抢占式升格（2026-11-20，`LoopService.promote(entryId)`）**：停止当前回合并等待收尾（abort 带 promote 标记——守卫据此不置冻结态，抢占不产生暂停横幅）+ 以该条原文开新回合（模型/思考覆盖随行）+ 此刻才从队列摘除（条目不存在直接 false，不 abort 任何在跑回合）；剩余条目原位不动、原序保留，提升回合结束后照常自动续冲；闲时可点（preempt 变 no-op）。与插话分工：`steer()` 不打断当前（step 边界进场，steer 徽章），`promote()` 打断 + 独占新回合；REST 面 `POST /api/sessions/:id/queue/:entryId/promote`。

## 2. 中断纪律全家桶（已定，测试逐条锁定）

| #   | 纪律                                                                           | 防的事故                                        |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1   | 掐流后**先查 `aborted` 再诊断**错误                                            | "干净收尾"被误判 retryable → 停止变自动重发     |
| 2   | 清 **dangling tool_calls**（有 call 无 result 的从派生历史移除并合成错误结果） | 下次请求 400                                    |
| 3   | 工具执行与信号**竞速**，中断合成结果走正常结算                                 | 界面留"运行中"残影                              |
| 4   | inflight 事件**兜底补发**                                                      | 客户端缺收尾事件卡死                            |
| 5   | 错误**落盘为事件**                                                             | 报错回合无收尾 → 僵尸状态                       |
| 6   | 队列非空时中断 = **冻结不冲刷**（`resume()` 显式恢复）                         | abort 传入冲刷 → 条目生而为 abort（落账无回复） |

## 3. 流式合并（已定）

- loop 是增量合并的**唯一**地点：16ms 窗口内同 kind（text delta / tool delta）攒批发事件；
- 首包不等待（定时器与首事件竞速）；
- 下游（server SSE、SDK）不再各自攒批。

## 4. 暴露的缝（P8 插件挂载点；waterfall / bail）

| 缝                    | 时机                                         | 典型插件                                        |
| --------------------- | -------------------------------------------- | ----------------------------------------------- |
| `loop/pre-step`       | 每步请求前（已派发，2026-11-26）             | 压缩（压力检查 + 投影）、注入提醒               |
| `loop/request-failed` | 请求失败后（已派发，2026-11-26）             | 溢出恢复（压缩后原步重发）                      |
| `loop/request`        | 请求配置定稿前（文档位；暂无派发、无消费者） | 改写温度/截断/工具清单投影                      |
| `tools/pre-execute`   | 工具执行前（归 plugin-tools，D-027）         | 权限闸、沙箱闸（见 tools-approval.md）          |
| `tools/post-execute`  | 工具执行后（归 plugin-tools，D-027）         | 结果剪枝、检查点捕获                            |
| `loop/turn-stopping`  | 回合将结束（**bail** 模式，可否决，D-012①）  | 熔断续跑（`plugin-breaker`，✓ D-065）、排队消费 |

**缝载荷类型（定稿 · 2026-11-16；2026-11-26 压缩批扩载，接口形状同 [interfaces.md](./interfaces.md) protocol 段）**：

```ts
// loop/pre-step（waterfall）：每步请求前——压缩预算投影与提醒注入在此改写
interface PreStepValue {
  messages: ModelMessage[]; // 本步将发送的派生历史
  tools: WireToolSchema[]; // 本步工具清单投影
  model: ModelConfig; // 即将请求的模型（阈值按它算）
  reasoningEffort?: ReasoningEffort;
  sessionId: string;
  turn: string;
  step: number;
  context: ContextReading; // 计量读数（used / size / pressure / hardLimit / estimated / parts / suspicion）
  budget: ContextBudget; // 本次请求的预算（retain / headMin / summaryOut / outputBase…）
  signal: AbortSignal; // 回合中断信号（摘要请求随之中断）
}
// loop/request-failed（waterfall）：请求失败后——置 retry:true = 已处理，原步重发
interface RequestFailedValue {
  error: LlmError;
  turn: string;
  step: number;
  retries: number; // 本步已重试次数
  messages: ModelMessage[];
  tools: WireToolSchema[];
  model: ModelConfig;
  reasoningEffort?: ReasoningEffort;
  sessionId: string;
  context: ContextReading;
  budget: ContextBudget;
  signal: AbortSignal;
  retry?: boolean; // 监听器置 true
}
// loop/request（waterfall）：请求对象定稿前——温度 / 上限 / 投影改写
interface RequestValue {
  request: LlmRequest;
}
// loop/turn-stopping（bail）：回合将结束——返回 Veto{by, reason, resume?} 否决并续跑（D-012①）
interface TurnStoppingValue {
  turn: string;
  reason: TurnEndReason;
}
```

_已定稿：死循环熔断 → 官方插件，走 `loop/turn-stopping`（bail）缝（2026-11-11）。**✓ 生产消费者已落码**（`plugin-breaker`，D-065 批：回合内提醒 + 回合尾否决双机制；内核每回合只查一次缝 = 每回合至多一次否决干预）。_
_已定稿：bail 的 `Veto` 形状 = `{ by, reason, resume? }`（[interfaces.md](./interfaces.md) §kernel、[principles.md](./principles.md) P7，2026-11-12）。_
_已定稿：基底系统提示由官方 loop 插件在会话初始化注入（一条 `system/message`；组装规则见 [session.md](./session.md) §4，2026-11-13）。_
_已定稿：忙时投递唯一化 = 排队持久化（`queue.json`）+ 条目"立即发送"插话（step 边界进场，不打断工具）；步数上限机制可选、默认不设（主循环 / 子代理均不设），token 硬顶不做归压缩预算（D-045，2026-11-14）。落盘串行化（D-092 决定 6，2026-11-27）：`queue.json` 的每次写排进同一条链——冲刷链摘条与并发入队的两次落盘曾各写各的（tmp+rename 交错：Windows 上 rename 撞替换窗口报错、内容还可能是旧快照）。_
