# Agent Loop 设计（草案）

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
- **inbox 唯一投递 = 排队（D-045）**：运行中 `send(prompt)` 进队列（闲时直接开新回合；回合结束后队列头部依次自动开新回合）；队列条目可**"立即发送"（插话）**——该条在**下一个 step 边界**进场（工具结果落定后、下一次模型请求前，不打断正在执行的工具），落 `user/message` 按同轮时间线记账，**不新增事件类型**（队列状态不进事件账本，P9-1）；排队条目持久化在会话目录 `queue.json`（tmp+rename 原子重写），重启恢复。

## 2. 中断纪律全家桶（已定，测试逐条锁定）

| #   | 纪律                                                                           | 防的事故                                    |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------- |
| 1   | 掐流后**先查 `aborted` 再诊断**错误                                            | "干净收尾"被误判 retryable → 停止变自动重发 |
| 2   | 清 **dangling tool_calls**（有 call 无 result 的从派生历史移除并合成错误结果） | 下次请求 400                                |
| 3   | 工具执行与信号**竞速**，中断合成结果走正常结算                                 | 界面留"运行中"残影                          |
| 4   | inflight 事件**兜底补发**                                                      | 客户端缺收尾事件卡死                        |
| 5   | 错误**落盘为事件**                                                             | 报错回合无收尾 → 僵尸状态                   |

## 3. 流式合并（已定）

- loop 是增量合并的**唯一**地点：16ms 窗口内同 kind（text delta / tool delta）攒批发事件；
- 首包不等待（定时器与首事件竞速）；
- 下游（server SSE、SDK）不再各自攒批。

## 4. 暴露的缝（P8 插件挂载点；waterfall / bail）

| 缝                   | 时机                                        | 典型插件                               |
| -------------------- | ------------------------------------------- | -------------------------------------- |
| `loop/pre-step`      | 每步请求前                                  | 压缩（预算检查 + 投影）、注入提醒      |
| `loop/request`       | 请求配置定稿前                              | 改写温度/截断/工具清单投影             |
| `tools/pre-execute`  | 工具执行前（归 plugin-tools，D-027）        | 权限闸、沙箱闸（见 tools-approval.md） |
| `tools/post-execute` | 工具执行后（归 plugin-tools，D-027）        | 结果剪枝、检查点捕获                   |
| `loop/turn-stopping` | 回合将结束（**bail** 模式，可否决，D-012①） | 熔断续跑、排队消费                     |

**缝载荷类型（定稿 · 2026-11-16，接口形状同 [interfaces.md](./interfaces.md) protocol 段）**：

```ts
// loop/pre-step（waterfall）：每步请求前——压缩预算投影与提醒注入在此改写
interface PreStepValue {
  messages: ModelMessage[]; // 本步将发送的派生历史
  tools: WireToolSchema[]; // 本步工具清单投影
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

_已定稿：死循环熔断 → 官方插件，走 `loop/turn-stopping`（bail）缝（2026-11-11）。_
_已定稿：bail 的 `Veto` 形状 = `{ by, reason, resume? }`（[interfaces.md](./interfaces.md) §kernel、[principles.md](./principles.md) P7，2026-11-12）。_
_已定稿：基底系统提示由官方 loop 插件在会话初始化注入（一条 `system/message`；组装规则见 [session.md](./session.md) §4，2026-11-13）。_
_已定稿：忙时投递唯一化 = 排队持久化（`queue.json`）+ 条目"立即发送"插话（step 边界进场，不打断工具）；步数上限机制可选、默认不设（主循环 / 子代理均不设），token 硬顶不做归压缩预算（D-045，2026-11-14）。_
