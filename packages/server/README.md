# @henira/server

HTTP + SSE 宿主（正式宿主，D-035）：REST 命令面 + SSE 投影流，把引擎端成服务。不含业务策略（packages.md）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) server 段（REST 面 / ServerEvent 行词表 / 回环三件套 D-035，M3 定稿）
- 宿主契约：[hosts.md](../../docs/20-architecture/hosts.md) §3（配置注入 / InteractionService① / 事件消费 / 输入投递）
- 渲染架构：**账本→行投影器**——行模型核心与 ZCode 同构（取证 2026-11-16/17）；事件→UI 组装逻辑唯一实现处，客户端零 reducer（可嵌入 D-037 的前提）；快照永远从会话账本重建（真相兜底，自愈）

## 用法

```ts
import { createServer } from "@henira/server";

const server = await createServer({ token: process.env.HENIRA_SERVER_TOKEN });
// server.url → 浏览器 / @henira/sdk createClient({ baseUrl: server.url, token })
// server.registry → 宿主组合面（注册工具 / 进各会话投递）
await server.stop();
```

```ts
import { Projection, rebuildProjection } from "@henira/protocol";

// 投影器（实现住 @henira/protocol，server 与 sdk 双形态共用）
const p = rebuildProjection(session.events()); // 历史：全账本折叠
const deltas = p.ingest(appendedEvent); // 实时：账本追加 → 增量（row.appended / row.upserted …）
const more = p.applyStreamDelta({ field: "text", text: "碎片" }); // 总线打字机碎片
const snapshot = p.snapshot(sessionId, seq); // 初始渲染 + 断档重拉共用出口
```

## 文件 ↔ 设计

| 文件                   | 职责                                                                                                                                                                                                | 设计出处                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| session-registry.ts    | 会话注册表：每会话一个 harness 实例（装配三步 ①③）；session 槽装饰组合（append 旁路喂投影器，引擎零改动）；总线流式碎片订阅；data-directory §4 目录命名；磁盘会话扫描与账本读取（历史会话快照兜底） | hosts.md §3 / data-directory §4 / D-016     |
| interaction-service.ts | InteractionService 实现①：ask 挂起等待 / settle 幂等先答者赢 / listPending / abort→cancelled / dispose 收口；审批行投影归账本（approval/asked・decided），本处不重复投影                            | packages.md 槽位归属 / protocol interaction |
| fanout.ts              | SSE 扇出：seq 按会话编发（快照带水位、增量 +1 单调——断档不猜服务端半边）；订阅者溢出即断开（volatile）                                                                                              | interfaces.md server 段 SSE                 |
| app.ts                 | Hono 路由：REST 命令面（会话 / prompt・steer・interrupt / 审批收答 / 文件围栏 / 设置・凭据 / models）+ SSE 端点（connected → 快照帧 → 增量混排 + 15s 心跳）+ Host/Origin 校验 + 可选 token          | interfaces.md server 段 / D-030 / D-035     |
| server.ts              | 装配入口：只绑 127.0.0.1 + 随机端口（三件套①②）→ state/server.json 握手（写跑时在、停后删）→ stop 收尾（closeAllConnections 硬断长连接 + disposeAll）                                               | D-035 / hosts.md §3 / data-directory §2     |
| settings-store.ts      | settings.json 程序写 + credentials.json 只写不读（0600 尽力而为，D-030）；原子重写；isPluginEnabled（缺 key = 启用）                                                                                | data-directory §2.3 / §8                    |

## 测试 ↔ 判据

| 测试           | 锁什么                                                                                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| server.test.ts | **判据⑤** 三件套（回环绑定 / 随机端口 / 恶意 Origin 403 / token 位）· **判据①** 双客户端增量都达 · **判据②** 审批挂起重连快照重放 + REST 收答 · 流式 row.delta 与 seq 单调 · 设置读写 + 凭据永不回读 · 文件围栏 · 握手生命周期 · 历史会话账本重建（投影器测试住 @henira/protocol：projection.test.ts） |
