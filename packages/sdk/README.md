# @henira/sdk

客户端 SDK（D-037 纯 TS 零 React）：进程内 runtime + 远程 client 双形态，实现同一 HeniraFacade 门面、吐同一 ServerEvent 行词表——"进程内与远程行为一致"由同一测试套件对双形态跑锁（D-034①）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) sdk 段（M3 定稿）
- 宿主契约：[hosts.md](../../docs/20-architecture/hosts.md) §3（③=cli / sdk 嵌入方自带缺省 fail-closed InteractionService）
- 不实现引擎逻辑、不携带界面（packages.md）；行为一致的前提 = 事件→UI 组装逻辑只在 server 投影器一处，两形态同词表同纪律

## 用法

```ts
// 形态一：进程内（cli run / 测试 / 嵌入③）——无 server、无端口
import { createRuntime } from "@henira/sdk";
const runtime = await createRuntime({ tools: [myTool] });
const session = await runtime.createSession({ cwd: process.cwd() });
runtime.prompt(session.id, "你好");
for await (const frame of runtime.events()) consume(frame); // ServerEvent 行词表
await runtime.stop();

// 形态二：远端（Web / 跨进程①）——连 server
import { createClient } from "@henira/sdk";
const client = createClient({ baseUrl: "http://127.0.0.1:43110", token });
const sessions = await client.listSessions();
await client.settleApproval(sessionId, requestId, "allowed-once");
for await (const frame of client.events()) consume(frame); // 同一词表
```

远端 client 内置：SSE 解析 + 重连退避（500ms→5s）+ **断档不猜**（每会话记 lastSeq，跳号即回拉快照换发——消费端永不猜中间态）。

## 文件 ↔ 设计

| 文件        | 职责                                                                                                                                                                                                                                                                                                                                   | 设计出处                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| facade.ts   | HeniraFacade 门面（createSession / prompt・steer・interrupt / settleApproval / snapshot / events / stop / 权限管理：sessionPermissions・revokeSessionApprovals opts・permissionProjects・projectPermissions・removeProjectPermissionRule・globalPermissions・removeGlobalPermissionRule）+ frameQueue 有界帧队列（溢出即断，volatile） | interfaces.md sdk 段 / D-037 / D-082               |
| runtime.ts  | 形态一③：装配三步 ①③（引擎五件聚合 + settings enabled 过滤）+ session 槽装饰组合喂投影器 + autoRejectInteraction 缺省 fail-closed（可整只替换）+ tools 注入 + 权限管理盘上实现（dirs.peek/get + config-loader helpers）；零端口零握手文件                                                                                              | hosts.md §3 / packages.md 槽位归属 / D-016 / D-082 |
| client.ts   | 形态二①：REST + SSE 解析 + 重连退避 + 断档不猜（跳号回拉快照换发）+ 权限管理 REST 方法                                                                                                                                                                                                                                                 | interfaces.md server 段 SSE / D-082                |
| settings.ts | settings.json 读取（装配③ enabled 过滤；缺失按缺省走）                                                                                                                                                                                                                                                                                 | data-directory §2.3                                |

## 测试 ↔ 判据

| 测试           | 锁什么                                                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| facade.test.ts | 行为一致套件（同一组用例对双形态各跑：生命周期 / prompt 回执 / events 词表 / snapshot 形状 / 审批挂起与收答 / R199 权限管理面：项目清单・规则视图・项目/全局删除・会话撤销 body）· client 断档不猜（跳号丢弃回拉换发）· runtime 缺省 fail-closed（ask 即拒回合照常收尾） |
