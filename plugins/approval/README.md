# @henira/plugin-approval

approval 槽位官方插件：判定链全序 + fail-closed 答复矩阵 + 审计对。凭据与灾难在一切规则之外（D-039）；审计对写经 session 槽。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) protocol 段 approval 部分
- 设计文档：[tools-approval.md](../../docs/20-architecture/tools-approval.md) §3（判定链全序）/ §3.3（载荷，已定稿）
- turn/step 定位：监听 loop 在总线上广播的 turn/start + step/start（kernel 语义：emit 只达 on 监听者，onSerial 不行）

## 用法

```ts
import { approvalPlugin } from "@henira/plugin-approval";

createHarness().use(approvalPlugin()); // 无 options；inject: ["session", "tools", "interaction", "config"]
```

四个被注入槽位都必须在装配里（缺失 start 一次报全）；`interaction` 是弹卡出口——headless / 测试用自动应答器，见 [examples/mock](../../examples/mock/README.md) 的 `autoAnswerInteraction`。

## 文件 ↔ 设计

| 文件             | 职责                                                                                                                                                                                                                                                                            | 设计出处                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| chain.ts         | 链外硬拒（凭据 CREDENTIAL_PATTERNS / 灾难 DISASTER_PATTERNS，stringValues 深走 depth ≤ 6，argsDigest sha256-12）→ deny 规则（跨全表先扫，deny 压倒一切）→ allow 规则 → 默认放行（isConcurrencySafe 且 floor 非 "ask"）→ approval/request 缝（ask 落穿）→ InteractionService ask | tools-approval §3 / D-039             |
| session-allow.ts | 会话内允许集折叠：日志记"发生了什么"（asked 带 tool / decided{scope:'session'} 按 requestId 配对 / revoked 撤销），全部从日志派生、无独立可变状态；R199 规则同一性走 protocol canonical key（键序/未知字段无关）并去重                                                          | tools-approval §3.1 / P1 对偶 / D-082 |
| service.ts       | approvalPlugin（inject: session / tools / interaction / config）：审计对（approval/asked + approval/decided）经 session 槽落盘；fail-closed 矩阵——answerer 缺失 / 抛错 / 不合规 → unavailable（abort → cancelled 例外）；无打开回合 → unavailable；无墙钟超时                   | tools-approval §3 / P5                |

## 测试 ↔ 判据

| 测试                  | 锁什么                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| chain.test.ts         | 凭据 / 灾难 / deny 压倒 allow / 默认放行层各段（roadmap M2 判据⑤）                                                                        |
| session-allow.test.ts | 工具级兼容 / 命令规则不升级 / 按规则・按工具・清空三档撤销 / R199 canonical 去重与键序等价                                                |
| service.test.ts       | fail-closed 矩阵（roadmap M2 判据④）+ 判定链全序 + 审计对 + abort → cancelled / R198 会话语义与项目写盘降级 / R199 项目 deny 压倒会话允许 |
