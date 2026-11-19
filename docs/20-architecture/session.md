# 事件溯源会话设计

> 依据原则 **P1（事件溯源 = 唯一事实源）**、**P2（append-only + 发送投影）**。
> 状态：**已定稿**（2026-11-12）——信封、事件词表 v0、派生规则、存储写入语义、fork 语义均已定。
> 工具 schema（D-044）与 `PermissionRequest` 载荷（D-046）已于 2026-11-14 定稿（见 [tools-approval.md](./tools-approval.md)）；无未定项。

---

## 1. 基本模型（已定）

- 会话 = **追加式 `SessionEvent` 日志**，持久化为 JSONL 文件；
- 模型历史**从不单独存储**：`deriveMessages(events)` 从日志派生出"发给模型的 messages"；
- 不变量（测试锁定）：**模型可见 ⟺ 已落日志**——任何请求都可从日志重建。

### 1.1 三处归属（已定 · 2026-11-12）

- **压缩 = 替换记录，不是删消息**：压缩插件只在日志尾部追加一条替换记录，声明"某段 `seq` 区间在派发时用摘要代替"；原事件永久保留，文件只增不减。派生规则见 §4。
- **审批问答对在回合内，不进模型历史**：`approval/asked` + `approval/decided` 夹在本回合事件流中间（`tool/call` 与 `tool/result` 之间），`deriveMessages` 跳过它们。两条硬规则：**没有打开的回合不接受审批记录**；**先落 `decided` 再执行工具**（write-ahead）。
- **权限分两层**：会话内的"记住允许"是**事件**（追加进日志、随会话消亡、撤销 = 再追加一条）；跨会话的规则是**可手改的文件** `config/permissions.json`（经 `ConfigService` 读）。判断标准一句话：**日志记"发生了什么"，规则记"以后怎么办"**。详见 [tools-approval.md](./tools-approval.md) §3.1。

## 2. 信封与事件词表 v0（已定 · 2026-11-12）

### 2.1 信封

```ts
interface SessionEvent<T extends string = string> {
  type: T; // 'tool/call'；首段是语义域（见 2.3）
  seq: number; // 会话内单调递增，从 1 开始
  time: number; // epoch ms
  data: unknown; // 由注册表按 type 校验
  ignorable?: boolean; // 缺省 false：未知类型即拒读
}

// 文件第 1 行，不是事件、没有 seq，永不修改
interface SessionHeader {
  version: 1; // 格式版本；必须在被版本化的结构之外
  id: string;
  createdAt: number;
  cwd: string;
  parentSession?: string;
  user?: string; // 云端归属（D-036）：部署时写入的用户标识，本地缺省；写入后不改，fork / 侧问随 header 复制
}
```

- **`version` 为什么在 header 而不在事件里**：读文件的人必须先知道版本才能解析事件；把版本做成第一条事件就是循环依赖；
- `type` 排第一：读一行就知道是什么事件，不必先解析载荷；
- `turn` / `step` 放在 `data` 里、**每条事件都带**：一行即一个自足的事实，派生不必维护游标；`error` 可以不带（会话级错误）。
- `user`：云端部署写入的归属字段（D-036），本地会话缺省；属会话级身份，放 header 不放事件（归属不变，事件不必每条背）。

### 2.2 事件表（15 个）

| 事件                | `data` 载荷                                                                     | 进派生       |
| ------------------- | ------------------------------------------------------------------------------- | ------------ |
| `turn/start`        | `turn`                                                                          | —            |
| `turn/end`          | `turn`, `reason`, `usage?`, `error?`                                            | —            |
| `step/start`        | `turn`, `step`                                                                  | —            |
| `step/end`          | `turn`, `step`, `usage`, `interrupted?`                                         | —            |
| `request/header`    | `turn`, `step`, `model`, `params`, `toolNames[]`, `systemPromptHash`            | 跳过         |
| `user/message`      | `turn`, `step`, `content`, `attachments?`, `source`, `surfaceOp?`               | ✅           |
| `system/message`    | `turn`, `step`, `content`, `key?`, `surfaceOp?`                                 | ✅           |
| `assistant/message` | `turn`, `step`, `content`, `reasoning?`, `model`, `finishReason`, `surfaceOp?`  | ✅           |
| `assistant/attempt` | `turn`, `step`, `content?`, `error`                                             | 跳过         |
| `tool/call`         | `turn`, `step`, `callId`, `name`, `arguments`, `origin?`                        | ✅（配对后） |
| `tool/result`       | `turn`, `step`, `callId`, `isError`, `content`, `error?`, `durationMs`, `meta?` | ✅（配对后） |
| `approval/asked`    | `turn`, `step`, `requestId`, `callId`, `tool`, `argsDigest`                     | 跳过         |
| `approval/decided`  | `turn`, `step`, `requestId`, `decision`, `scope?`                               | 跳过         |
| `approval/revoked`  | `turn`, `step`, `scope`, `tool?`                                                | 跳过         |
| `error`             | `turn?`, `step?`, `code`, `message`, `fatal?`                                   | 跳过         |

- **`request/header`** 是**每次模型请求**的快照：`model`（实际能力字段取值）、`params`（温度 / maxTokens 等）、`toolNames`（这次投影给模型的工具名）、`systemPromptHash`（系统消息内容的哈希）。它让 P1 的"任何请求都可重建"成为字面事实；**不含任何凭据**；
- `assistant/attempt` 记**每次失败 / 中断的流残余**（`content` 是已收到的部分），重试各留一条；永不进模型历史；
- `tool/*` 的 `origin` 区分主代理与子代理（`{kind:'subagent', id}`）；`meta` 是带外通道（检查点、引用、图片），不进模型上下文（P4）；
- `system/message.key`（可选，用拥有者前缀，如 `tasks/state`）：**同名只投影最新一条**——用于"状态提醒"这类会被反复刷新的内容；旧的从模型视野消失、日志里保留（规则见 §4）；
- `user/message.attachments[].path` **必须相对会话目录**（如 `attachments/<seq>/<文件名>`），禁止绝对路径、禁止嵌 `sessionId`——fork 零改写的前提；
- 附件在**宿主入口统一校验**（定稿 · 2026-11-13）：单文件 20MB、图片 5MB、单条消息总量 50MB、个数 ≤100（经验值，经配置可调）；超限整条拒收并提示；
- `usage` 只记在 `step/end`（一次请求周期一份），不在 `assistant/message` 重复；`finishReason` 只在 `assistant/message`；
- **审批问答对留在回合内**（`tool/call` 与 `tool/result` 之间）且 `deriveMessages` 跳过；**没有打开的回合不接受审批记录**；**先落 `decided` 再执行工具**（write-ahead）。待审批队列的真源就是日志本身：`asked` 有、`decided` 无 = 仍在等，`InteractionService.listPending()` 折日志恢复，不依赖进程内状态。

### 2.3 命名规则与命名空间

- 第一段是**语义域**，不是包名。保留域：`turn` · `step` · `request` · `user` · `system` · `assistant` · `tool` · `approval` · `error` · `session`；
- 插件自有事件**必须用自己的包名做前缀**（`compaction/*`、`subagent/*`），注册时声明 owner，不得占用保留域；
- 保留域新增事件 = 改 protocol（涉及原则时立 ADR）；插件自有事件只受 `ignorable` 规则约束。

### 2.4 `turn/end.reason`（7 值）

| reason        | 含义                                                      |
| ------------- | --------------------------------------------------------- |
| `completed`   | 模型自然结束，没有更多工具调用                            |
| `aborted`     | 被中止；必带 `cause`                                      |
| `blocked`     | 回合开始前被策略拦下（未产生模型请求）                    |
| `error`       | 引擎级错误终止了回合                                      |
| `max-tokens`  | 达到 token / step 上限                                    |
| `interrupted` | 崩溃后的补记：开档时发现回合有 `start` 无 `end`，补写收尾 |
| `forked`      | fork 切在半回合处，为复制出的前缀补写收尾                 |

`aborted.cause`：`user`（用户 Esc）· `parent`（父代理取消子代理）· `hook`（熔断插件否决）· `disposed`（宿主关闭）。

### 2.5 `ignorable` 与 `surfaceOp` 的边界

- `ignorable` 只回答"不认识这个事件时能不能跳过"，**不表示事件不重要**——对话事实与审计事实**永不**标 `true`；默认 false 就是 fail-closed 在事件层的形态；
- `surfaceOp` 只出现在三个消息类事件上：缺省 `'append'`，或 `{op:'replace', startSeq, endSeq}`。它是**压缩唯一的机制入口**（§4），也是插件唯一能影响派生历史的合法方式。

## 3. 注册表与派生清单（已定）

- 开放注册表：`SessionEventRegistry = Map<type, EventValidator>`（protocol 导出；校验器 = 最小 duck 接口，D-051——protocol 零依赖、不认 schema 库牌子，官方 15 个变体由 session 包用 zod 实现并注册）；官方 session 插件注册基础 15 个变体，插件可追加；
- 消费端封闭处用 `assertNever` 收尾；
- `KNOWN_EVENT_TYPES`、schema 反查表、客户端事件清单**全部从注册表派生**，禁止手抄（P9 红线 5）；
- 未知类型只有两条路：`ignorable: true` → 跳过；否则抛 `UnknownEventTypeError` 并**拒绝重建会话**。

## 4. deriveMessages 派生规则（已定）

- `user/message` → user 消息（`content` + `attachments`）；`system/message` → system 消息；`assistant/message` → assistant 消息（含 `tool_calls`）；
- `tool/call` + 对应 `tool/result`（按 `callId` 配对）→ tool 结果消息；**孤儿 `tool/call`（无 result）在派生时合成错误结果**（中断纪律的产物，防 400）；
- `turn/*`、`step/*`、`request/header`、`approval/*`、`assistant/attempt`、`error` → **跳过**，只用于展示与审计；
- `assistant/message.reasoning` 保留给 UI；**开思考且模型声明 `interleaved`（reasoning_content）时随派生消息回传 provider**（DeepSeek V4.1+ 带 tool_calls 不回传 400——思考档批 2026-11-19；关思考 / 未声明 = 全剥不回传）；工具轮 reasoning 与纯文本轮同形落账本（回传的数据来源）；
- **`key` 去重（先于 `surfaceOp`）**：在**原始日志**上按 `key` 取 `seq` 最大的一条作为候选，其余同名事件一律跳过；候选留在自己的位置（靠近末尾——注意力最强的位置）。候选若落在被替换区间内，则随区间一起被替换，**不会"复活"更早的同名旧消息**；
- **`surfaceOp` 应用**：按 `seq` 升序处理；遇到 `{op:'replace', startSeq, endSeq}` 时跳过该区间内的全部事件、在区间起点插入本条消息；区间外原样输出。

**压缩的派生规则（已定 · 2026-11-12）**：

- 压缩插件在一次 `step/end` 之后、下一次 `step/start` 之前，追加**一条消息类事件并带 `surfaceOp:{op:'replace', startSeq, endSeq}`**（角色由插件选，通常是 `system` 或 `user` 的摘要消息）；
- **机制只有一处**：session 懂 `surfaceOp`，压缩策略全在插件——session 包不知道"压缩"这个概念（P8）；
- **区间只向前推进、不重叠**：新记录从上次压缩的终点之后开始。重叠视为插件 bug：**先写入的记录生效，后到的整条忽略**，并补一条非致命 `error`——派生结果因此永远可复现；不采用"后来者覆盖"，那会让同一份日志在不同版本重放出不同历史；
- 四个属性：压缩可重做（再追加一条更好的替换记录）、可审计（原事件还在）、可换插件（旧会话按当时记录重放）、**不可伪造历史**（插件只能声明替换哪一段，"怎么替换"由 session 保证）；
- **压缩后重注入**：压缩插件落下替换记录后，在总线上发 `compaction/applied`（serial；总线事件，不是会话事件）；持有持久状态的插件（如计划 / 任务）监听它，追加一条带 `key` 的 `system/message` 精确快照。摘要里的转述只是兜底——**不赌模型的记性**；
- 插件如需记录压缩前后的 token 等观测值，另发 `compaction/*` 事件并标 `ignorable: true`。

**系统提示的组装（定稿 · 2026-11-13）**：

- **机制不新增**：系统提示 = 流水账里的 `system/message` 消息——各插件自注自的块、`key` 防重复（同名最新），账本本身就是组装结果（标记防重复 + 原地刷新）；
- **基底身份归官方 loop 插件**：会话初始化注入一条基底 `system/message`（"你是谁"）；换 loop 者自担基底。P9-3 的"零用户可见文案"不禁给模型看的提示词——dsh `system-prompt` 包、OpenCode `system.txt` 都在引擎侧带提示词；
- **块顺序 = `seq` 顺序**（先注在前），天然稳定——顺序稳定 = 前缀逐字节稳定 = 模型厂商缓存命中（OpenCode 按共享度排序 `context.ts:162-164`、Claude Code 缓存边界标记，多家实证）；
- **压缩不碰头部系统块**：替换区间不得覆盖会话头部连续的 system 块（保前缀缓存；compaction 设计文档的硬约束之一）。

## 5. JSONL 持久化（已定）

- 一会话一文件：`~/.henira/projects/--<slug60>-<hash8>--/sessions/<sessionId>/session.v1.jsonl`；**第 1 行是 `SessionHeader`（不是事件），第 2 行起每行一个事件，`seq` 从 1 开始**（目录规则见 [data-directory.md](./data-directory.md)，D-014）；
- **追加写入**：每行一个完整事件，写入后 `fsync`；`tmp + rename` **只用于** `meta.json` / `projects.json` 这类整体重写的小文件——对只追加日志用 rename 等于整文件重写，语义错误；
- **崩溃恢复**：读取时若最后一行不完整（半行 JSON），**丢弃该行**，从最后一个完整事件继续；不因一个半行丢掉整段会话。此外开档时若发现最后一个回合有 `turn/start` 无 `turn/end`，补写 `turn/end{reason:'interrupted'}`——崩溃也要有收尾；
- 读取：全量加载入内存；**版本检查 + 拒读未来版本**（不做迁移链，过度设计）；
- 单写者：同一会话同时只有一个进程可写（文件锁或启动登记）。

存储根路径、项目目录命名与两层结构见 [data-directory.md](./data-directory.md)（D-014）。

## 6. fork / replay 语义（已定 · 2026-11-12）

- **fork**：从现有会话的**任意 `seq` 前缀**复制到新文件（新 id，`parentSession` 指向源会话），老会话不动——分支实验的基础；
- 切点落在回合中间时（复制出的前缀有 `turn/start` 无 `turn/end`），**在末尾补写 `turn/end{reason:'forked'}`**，让新会话从自洽状态开始；
- **复制而非引用**：新会话不依赖源文件，源会话被删也不影响；代价是文本重复，可接受（会话远小于检查点）；
- 会话目录内的附件、子代理记录、侧问、计划与任务文件随目录复制，相对路径原样有效；嵌套侧问的新 header 写入新的 `parentSession`；分叉点早于最新状态时，`plans/` 与 `tasks/` 按日志重建到分叉点（见 [data-directory.md](./data-directory.md) §2.2）；
- **replay**：把日志重放给消费者（UI 回放、调试、未来评测输入）——同一套 `applyEvent(visitor)` 机制。
