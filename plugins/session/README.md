# @henira/plugin-session

session 槽位官方插件：追加式 JSONL 会话账本（P1 不变量"模型可见 ⟺ 已落日志"）+ 派生消息 + fork。官方 15 个基础事件的 zod 校验器住本包（D-051），随装载注册进 protocol 开放注册表。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) protocol 段 SessionService
- 设计文档：[session.md](../../docs/20-architecture/session.md)（全篇已定稿）
- 目录布局归宿主 / [data-directory.md](../../docs/20-architecture/data-directory.md)（D-014），插件只认显式目录

## 用法

```ts
import { sessionPlugin } from "@henira/plugin-session";

createHarness().use(sessionPlugin({ directory: sessionsDir, cwd }));
```

| options     | 含义                                           |
| ----------- | ---------------------------------------------- |
| `directory` | 会话目录（data-directory.md 布局；装配方决定） |
| `cwd`       | 会话工作区（SessionHeader.cwd）                |
| `user?`     | 云端归属（D-036），本地缺省                    |

开档 = 存在即装载、缺即新建；官方 15 个基础事件的校验器随本包装载注册进开放注册表。

## 文件 ↔ 设计

| 文件          | 职责                                                                                                                                          | 设计出处                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| store.ts      | append = 校验 → 分配 seq → 追加 → fsync（P1 写入半边：append 返回时事件已在盘上）；NoOpenTurnError                                            | session.md §5 / P1        |
| atomic.ts     | tmp + rename 只用于 meta.json 等整体重写小文件；追加日志走 append + fsync（对追加日志 rename 语义错误）；临时文件与目标同目录、永不跨卷       | session.md §5             |
| derive.ts     | deriveMessages 派生规则：key 去重 → surfaceOp replace（区间起点插摘要）→ callId 配对（孤儿 tool/call 合成错误结果，防 400）——纯函数永不改日志 | session.md §4             |
| surface-op.ts | surfaceOp 写入裁决与派生应用共用一套判定（禁止两处手抄漂移）                                                                                  | session.md §4             |
| fork.ts       | 任意 seq 前缀复制到新目录（新 id、parentSession 指源；整目录复制，附件/计划随走）；切点半回合补写 turn/end{forked}                            | session.md §6             |
| reader.ts     | JSONL 读取与崩溃恢复：半行丢弃截断 / 版本闸 / 未知类型 fail-closed / seq 连续递增                                                             | session.md §3 / §5        |
| lock.ts       | 单写者锁：O_EXCL 独占创建 + PID 存活检测 + 陈旧接管（跨平台轻量等价，[dsh] 原生 flock 同职责）                                                | session.md §5             |
| validators.ts | 官方 15 变体 zod 校验器（zod 是实现细节，不进协议词汇）；插件经 registerPluginEvent 追加自有事件                                              | session.md §2.2 / D-051   |
| service.ts    | SessionService 门面：createSession = 开档（存在即装载、缺即新建）；fork 返回同构句柄                                                          | interfaces.md protocol 段 |
| plugin.ts     | sessionPlugin ServiceDefinition 壳（占 'session' 槽；实现与契约同包，D-049）                                                                  | packages.md               |

## 测试 ↔ 判据

| 测试                           | 锁什么                                                  |
| ------------------------------ | ------------------------------------------------------- |
| store.test.ts / atomic.test.ts | append + fsync / 原子写 / 单写者锁（roadmap M1 判据④）  |
| derive.test.ts                 | P1 锁定 / 孤儿合成 / surfaceOp 区间（roadmap M1 判据④） |
| fork.test.ts                   | fork / replay（roadmap M1 判据④）                       |
| plugin.test.ts                 | ServiceDefinition 壳装载 + 重开中断合成                 |
