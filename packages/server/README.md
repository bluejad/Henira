# @henira/server

HTTP + SSE 宿主（正式宿主，D-035）：REST 命令面 + SSE 投影流，把引擎端成服务。不含业务策略（packages.md）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) server 段（REST 面 / ServerEvent 行词表 / 回环三件套 D-035，M3 定稿）
- 宿主契约：[hosts.md](../../docs/20-architecture/hosts.md) §3（配置注入 / InteractionService① / 事件消费 / 输入投递）
- 渲染架构：**账本→行投影器**——行模型核心与 ZCode 同构（取证 2026-11-16/17）；事件→UI 组装逻辑唯一实现处，客户端零 reducer（可嵌入 D-037 的前提）；快照永远从会话账本重建（真相兜底，自愈）

## 用法

```ts
import { Projection, rebuildProjection } from "@henira/server";

// 投影器（server② 起经会话注册表对外；此处为纯函数面）
const p = rebuildProjection(session.events()); // 历史：全账本折叠
const deltas = p.ingest(appendedEvent); // 实时：账本追加 → 增量（row.appended / row.upserted …）
const more = p.applyStreamDelta({ field: "text", text: "碎片" }); // 总线打字机碎片
const snapshot = p.snapshot(sessionId, seq); // 初始渲染 + 断档重拉共用出口
```

## 文件 ↔ 设计

| 文件          | 职责                                                                                                                                                                                                                                                      | 设计出处                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| projection.ts | 投影器：ingest（账本事件→行，封闭增量产出）/ applyStreamDelta（流式碎片挂当前游标行）/ snapshot（深拷贝出口）/ rebuildProjection（surfaceOp replace 与断线兜底的全账本重建）；rowId 账本事实确定性派生；步边界自愈 = 落账即整行替换；中止回合冻结仍流式行 | interfaces.md server 段 / loop.md §1 |

## 测试 ↔ 判据

| 测试               | 锁什么                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| projection.test.ts | 回放→快照形状 / 工具回合全序与 output / 审批对 / 无投影事件清单 / 流式自愈与迟到碎片丢弃 / 中止冻结 / 直播与回放 rowId 一致（确定性）/ replace 检出与重建 |
