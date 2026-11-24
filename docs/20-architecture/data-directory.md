# 运行数据目录（Runtime Data Directory）

> 依据 **D-014**。状态：**已定稿**（2026-11-11；2026-11-12 补会话目录规则与计划 / 任务文件）。
> 回答一个问题：Henira 跑起来以后，数据放哪、谁写、能不能删。
> 设计输入：公开实现的存储层对照——Claude Code 的 per-cwd 项目目录、dsh 会话存储、OpenCode 全局 + 项目分家（D-004 / D-047）。

---

## 1. 两层结构

| 层         | 位置                                 | 放什么                                                                            | 是否随仓库走   |
| ---------- | ------------------------------------ | --------------------------------------------------------------------------------- | -------------- |
| **全局**   | `~/.henira/`（`HENIRA_HOME` 可覆盖） | 配置、工作区注册表、**所有项目的运行数据**、插件、全局记忆/代理、状态、日志、缓存 | 否             |
| **项目内** | `<repo>/.henira/`                    | **只放本项目的定义**：项目级 agents、项目级 plugins                               | 是，可提交 git |

边界一句话：**运行数据在全局，项目定义在仓库**。

- 会话、任务、计划、附件、检查点、记忆都是"这台机器上跑出来的数据"，跟仓库走会把隐私与二进制塞进 git；
- 项目级代理与插件是"项目的一部分"，应当跟仓库走、可评审、可版本化；同名时覆盖全局层；
- **外部只读**：`~/.agents/skills/` 与 `<repo>/.agents/skills/` 不是 Henira 的目录——技能读者只读扫描，不创建、不复制、不迁移（D-020）。

## 2. 全局树

```
~/.henira/
├─ projects.json                      # 工作区注册表（权威 + 可自愈）
├─ config/
│   ├─ settings.json                  # 全局设置：默认模型 / 插件开关 / 界面偏好（程序写）
│   ├─ models.json                    # provider / model 定义（不含密钥；baseUrl 承重配置——断开只清显隐永不碰它，2026-11-19 教训锁；模型管理面另存 label/hidden 开关清单/自定义厂商显式 models；连接已知厂商从目录自动种 baseUrl）
│   ├─ model-presets.json             # 厂商目录缓存（models.dev 在线刷新落盘：{fetchedAt, providers:{name/endpoint/models{name,contextWindow,maxOutputTokens,vision,reasoning,reasoningOptions,interleaved}}} 信封形状，2 空格缩进人眼可读——endpoint 供连接种子（收敛批 2026-11-19）；reasoningOptions/interleaved 供思考档位集合与思维链回传（思考档批 2026-11-19）；旧 models-dev-cache.json 已废弃清理）
│   ├─ credentials.json               # 密钥（0600，绝不进会话 / 日志）
│   └─ permissions.json               # 全局审批规则
├─ projects/
│   └─ --<slug60>-<hash8>--/
│       ├─ sessions/
│       │   └─ <sessionId>/
│       │       ├─ session.v1.jsonl   # 只追加：会话头 + 事件
│       │       ├─ meta.json          # （预留）标题等可改元数据——当前标题由账本首条 user/message 派生（R188），未落 meta
│       │       ├─ attachments/       # 本会话附件
│       │       ├─ subagents/         # 本会话子代理记录
│       │       │   └─ <runId>.jsonl
│       │       ├─ sidechats/         # 本会话的侧问
│       │       │   └─ <sideChatId>/  #   嵌套小会话，结构与会话目录相同
│       │       ├─ plans/             # 本会话的计划
│       │       │   ├─ index.json     #   计划清单：slug / active / createdAt
│       │       │   └─ <slug>.md      #   计划正文（纯 markdown）
│       │       ├─ tasks/             # 本会话的任务
│       │       │   └─ <id>.json      #   一个任务一个文件
│       │       ├─ queue.json         # 忙时排队条目（D-045；tmp+rename 原子重写，进场/直发时移除并落账）
│       │       └─ ui-state.json      # 界面绑定态：草稿 / 面板宽度 / 右栏 tab 引用 / 模型·思考·权限会话级记忆（web 宿主所有；
│       │                             #   整份原子重写，不进事件账本；折叠组不存，本地态；D-063，已落码·界面持久化批；
│       │                             #   rightPanel/rightWidth/model/reasoningEffort 已随三栏骨架批接线 2026-11-18）
│       ├─ permissions.json           # 本项目审批规则（R198：卡上「本项目允许此命令」写入；可手改；与全局同形）
│       └─ memory/
│           ├─ MEMORY.md              # 项目记忆
│           └─ config.json            # 记忆开关
├─ checkpoints/
│   └─ --<slug60>-<hash8>--/
│       ├─ objects/<2hex>/<sha256>    # 内容寻址 blob
│       ├─ sessions/<sessionId>/<stepId>.json
│       └─ scan-cache.json
├─ plugins/<id>/<version>/          # 插件（AI 创建；版本级不可变；不得存凭据，D-030；
│                                   #   engine/ 槽可带 package.json + node_modules + lockfile，D-048）
├─ plugins-data/<id>/               # 插件可变数据（与版本目录解耦；卸载默认保留，D-029）
├─ agents/<name>.md                   # 用户级子代理定义
├─ memory/MEMORY.md                   # 全局记忆
├─ state/                             # 运行时状态（server.json、ui.json 全局界面态——上次选中，D-063）
├─ logs/                              # 运行日志（可轮转）
└─ cache/                             # 可随时删除
```

### 2.1 会话目录规则（2026-11-12）

会话目录里住四类东西，**全部跟会话同生共死**：

| 类别         | 内容                                                        | 形态                                                                                   |
| ------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 对话本身     | `session.v1.jsonl`、`meta.json`                             | 只追加日志 + 可改元数据                                                                |
| 附件         | `attachments/`                                              | 文件，被日志用相对路径引用                                                             |
| 工具输出溢出 | `artifacts/<callId>.txt`                                    | 截断 spill（头部预览进 content 尾注、完整输出落盘；ToolContext.artifactsDir，M4 批 A） |
| 另一条对话   | `subagents/<runId>.jsonl`、`sidechats/<sideChatId>/`        | 各自一份日志                                                                           |
| 当前状态文件 | `plans/`、`tasks/`、`queue.json`                            | `plans/` `tasks/` 唯一写者 = 任务服务（D-049）；`queue.json` = loop 插件（D-045）      |
| 界面绑定状态 | `ui-state.json`（本会话）＋ `state/ui.json`（全局上次选中） | 整份原子重写、不进事件账本；写者 = web 宿主经 server（D-063，已落码）                  |

- **路径一律相对会话目录**（禁止绝对路径、禁止嵌 `sessionId`）——删除会话 = 删一个目录，fork = 复制一个目录，零路径改写；
- **侧问就是一个挂在主问上的主问**：`sidechats/<sideChatId>/` 是嵌套的小会话目录，结构与会话目录完全相同（自己的日志、`meta.json`、附件、计划、任务），header 的 `parentSession` 指向父会话。它不能并进主日志——侧问有独立的消息历史与独立的循环，常与主对话同时进行；混写会让主日志不再是一条直线，回合成对、压缩区间、崩溃补收尾全部要按线程重做；
- **子代理记录**是父会话派出的分身留下的日志，同一 JSONL 格式，一个 run 一个文件；
- **设计依据**：附件、子代理记录、侧问、任务、计划全部是**会话级数据**，跟着会话目录走——删除 / fork 只动一个目录、相对路径零改写；把它们放项目级目录则每个消费者都要按 `sessionId` 过滤。侧问做成嵌套小会话后，"没有父目录就没有侧问"，孤儿残渣结构上不可能出现。
- **界面绑定状态**（D-063，已落码·界面持久化批 2026-11-18；rightPanel/rightWidth/模型·思考会话级记忆随三栏骨架批接线）：草稿 / 面板宽度 / 右栏 tab 引用 / 会话级模型·思考档·权限模式记忆（composer 回填用——权威在每次请求携带，引擎无会话态；账本 request/header.params 记每回合实际生效档，turn/start 记每回合权限档——D-080）住会话目录 `ui-state.json`——"和各自会话绑定"由目录生命周期天然保证（删会话随整树走）；跨会话的"上次选中"住全局 `state/ui.json`。两者都不进事件账本（状态是"现在的样子"不是历史，同 queue.json 先例）；右栏 tab 只存引用（插件 id + 面板 id；预览 tab = 文件 path+rowId / 图片 URL src）——data: 内联图是内容不是引用，宿主落盘前剔除（只活在本页内存，R189）；预览正文同样不落任何文件（R190 工作区读取端点 `GET /api/sessions/:id/file` 只读响应、不写 ui-state / 插件数据区；行翻页出窗后按 path 现场重读）；插件内部状态归 `plugins-data/<id>/`；一个 owner 一个文件，绝不两个写者整份重写同一文件（§2.2 同规矩）。折叠组**不入档**（用户裁决 2026-11-18）：刷新 / 重启只展开选中会话所在组、其余组收起；平时的折叠 / 展开是纯本地临时态。
- **重启续聊（懒挂载 attach，已落码 2026-11-18）**：serve 重启后磁盘历史会话的只读路径（列表 / 快照 / rows / ui-state）走磁盘兜底照旧；首次**写**操作（prompt / steer / interrupt / approvals / files）按需重建运行体（定位会话目录 → 读账本头核验 id/cwd → 装配 harness → 投影从账本补账，含崩溃补写行）——会话目录自身就是重建的全部输入（本节"同生共死"的另一面）；同一活进程在订即幂等返回，另一活进程持 `session.lock` → 409 `session_busy`。

### 2.2 计划与任务文件（2026-11-12）

任务 / 计划字段为通用清单结构（id / planId / status / 子项），取舍见下。

**`tasks/<id>.json`**——一个任务一个文件：

```json
{
  "id": "t-pmg424s8",
  "planId": "tang-poets",
  "status": "in_progress",
  "active": true,
  "description": "写诗人介绍",
  "subtasks": [
    { "id": "sub-0", "content": "读现有体例", "status": "completed" },
    { "id": "sub-1", "content": "写李白", "status": "todo" }
  ],
  "createdAt": "2026-11-12T05:38:18.220Z",
  "updatedAt": "2026-11-12T05:46:38.260Z"
}
```

- `planId` 可选：挂在计划下的任务才有，独立任务没有；
- 任务状态：`todo` · `in_progress` · `completed` · `blocked`；子项状态：`todo` · `in_progress` · `completed` · `skipped`；
- 刻意不设两样：`sessionId`（文件已在该会话目录里，留着 fork 后要逐个改写）与 `path`（派生的绝对路径，本就不该落盘）。

**`plans/<slug>.md`**——计划正文，纯 markdown，不含任何元数据。

**`plans/index.json`**——计划清单：

```json
{
  "version": 1,
  "plans": [{ "slug": "tang-poets", "active": true, "createdAt": "2026-11-12T05:30:00.000Z" }]
}
```

**会话文件里刻意不留的字段**：

| 会话文件字段 | 每项内容                                         | Henira                                                                                                                                         |
| ------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks[]`    | `id`, `sessionId`, `planId?`, `active`           | **不设**——四个字段任务文件里全有；`tasks/` 只装本会话的任务，列目录即清单（"全项目任务混在一个目录、读完再按 `sessionId` 过滤"的做法才需要它） |
| `plans[]`    | `id`, `slug`, `sessionId`, `active`, `createdAt` | 搬到 `plans/index.json`（去掉 `sessionId`；`id` 与 `slug` 重复，只留 `slug`）                                                                  |

不放 `meta.json`：那是 session 插件的文件，两个插件各自整份重写同一个文件会互相覆盖。

**规则**：

1. **任务服务（`plugin-tasks` 服务件，D-049）是这两个目录的唯一写者**——计划 / 任务工具件、界面操作、第三方插件一律经任务服务落盘；不支持手工改文件；
2. **同一时刻只有一条主线**：最多一个激活计划、一个激活任务；历史保留，可再激活；
3. **日志照记**：每次改动照样落会话日志，工具结果里带改动后的状态——日志仍是事实源，这两个目录是"现在的样子"；
4. **对不上时按日志重建**：崩溃残留、回滚、分叉到更早位置时，把这两个目录重建到日志对应的那一刻。

### 2.3 全局设置 settings.json（D-015）

界面上点出来的都落这里（**程序写**，不进 git）；开发者手写的项目 `henira.config.ts` 见 [interfaces.md](./interfaces.md) §config-loader。

```json
{
  "version": 1,
  "model": "deepseek-chat",                                // 默认模型
  "permissionMode": "ask",                                 // 新会话默认权限档（D-080：ask | full；会话内可单独切换并随会话记忆）
  "plugins": {
    "plugin-shell": { "enabled": false },                  // 关掉一个官方插件
    "番茄钟":        { "enabled": false },                  // 关掉一个 AI 创建的插件
    "office-tools": { "version": "1.2.0" },                // 钉住版本
    "plugin-fetch": { "options": { "timeoutMs": 30000 } }  // 插件参数
  },
  "ui": { "theme": "sea", "locale": "ja",                  // 界面偏好（官方 light/dark/zh 或已装资产包 id，D-059）
          "preview": { "file": "panel", "image": "modal" } } // 预览打开方式（R188：文件默认右侧、图片默认弹窗；按类型可改）
}
```

- `model`：默认模型（`models.json` 里注册的 id）；缺省取 `models.json` 第一个；
- `permissionMode`：新会话默认权限档（D-080）；已切换过的会话各自记住自己的选择（ui-state `permissionMode` 压过此默认）；
- `plugins.<id>`：`enabled`（**缺 key = 启用**，显式 `false` 才停用）、`version`（钉住生效版本，缺省最高）、`options`（插件参数，经 `ConfigService.get` 下发）；
- `ui`：界面偏好，宿主消费——`theme` / `locale` 为字符串 id：官方 `light` / `dark` / `zh` 或已装语言包/主题包 id（D-059；安全模式回落官方默认）；
- 同一项若项目 `henira.config.ts` 也写了，**听项目的**。

**装配三步**（每次新会话执行，D-016）：① 基础清单 = 项目 `henira.config.ts` 写了 `plugins` 听它的，否则官方出厂清单（config-loader 导出）；② 加上已装目录里的插件（`~/.henira/plugins/` 与项目 `.henira/plugins/`，同 id 不重复算，同名项目盖用户级；用户包 id 撞官方且带 `engine/` → 经确认卡替换官方，D-048；**v1 只扫用户级，项目级随装配②**）；③ 去掉 `enabled: false` 的。对**新会话**立即生效，运行中的会话不变；内圈 5 槽位不给关。插件目录格式与槽位见 [plugins.md](./plugins.md)。

## 3. 项目内树

```
<repo>/.henira/
├─ agents/<name>.md                   # 项目级子代理；同名覆盖用户级
├─ plugins/<id>/<version>/          # 项目级插件；与用户级同构（v1 后置：v1 只做用户级，项目级随装配②）
└─ plugins-data/<id>/               # 项目级插件数据
```

**不放在这里**：会话、任务、计划、附件、检查点、记忆、配置、缓存。它们全部在全局 `~/.henira/`。

## 4. 项目目录命名

格式：`--<slug60>-<hash8>--`

- **slug**：规范化 cwd → 反斜杠转 `/` → 去掉盘符冒号 → 非法字符替换 → `/` 变 `-` → **截断到 60 字符** → 去首尾连字符（空则 `root`）；
- **hash8**：**平台感知**的规范化 cwd 哈希前 8 位（Windows 先转小写；Linux / macOS 保留大小写）；
- **唯一性**由 `projects.json` 的 `id`（`sha256(canonical cwd)` 前 16 位）保证；目录名只给人看，**查找不靠目录名**；
- 这个格式同时解决三个问题：分隔符与连字符碰撞、大小写碰撞、超长路径。

`projects.json`（**全局根目录，不在任何项目目录里**）：

```json
{
  "version": 1,
  "lastUpdatedAt": 1790000000000,
  "projects": [
    {
      "id": "a1b2c3d4e5f60718",
      "cwd": "C:\\work\\demo",
      "key": "--c-work-demo-a1b2c3d4--",
      "displayName": "demo",
      "createdAt": 1780000000000,
      "lastOpenedAt": 1790000000000,
      "openCount": 12,
      "lastSessionId": "s-..."
    }
  ]
}
```

- 它是**权威的工作区列表**（排序、最近打开、打开次数都以它为准）；**已落地（D-060，2026-11-18）**：读写器 = plugin-session `DirRegistry`（两宿主共用，规则 3 合规——知识下沉引擎层），建会话带 cwd 自动登记（server REST 与 sdk runtime 同语义），list 时扫账本自愈复活；
- 但**可自愈**：启动时扫 `projects/<key>/sessions/*`，从会话头里的 `cwd` 复活缺失条目、校正被挪动的目录；
- 项目目录里**不再放** `project.json`——`projects.json` 已有 `id ↔ cwd ↔ key` 映射，会话头也有 `cwd`，重复一份只会漂移；
- `lastSessionId` 字段现状只写未读（自动登记时刷新）；"上次选中"的权威记录 = `state/ui.json`（D-063）——本字段接消费方（每目录最后开的会话）还是作废，随批 C 定。

## 5. 每类数据的写者与生命周期

| 数据                | 写者                                                       | 变不变                      | 删除影响                                      |
| ------------------- | ---------------------------------------------------------- | --------------------------- | --------------------------------------------- |
| `session.v1.jsonl`  | session 插件                                               | **只追加**                  | 丢该会话                                      |
| `meta.json`         | session 插件                                               | 偶尔改（原子重写）          | 丢标题 / 标签，会话还在                       |
| `attachments/`      | session 插件                                               | 新增                        | 丢附件引用                                    |
| `subagents/`        | subagent 插件                                              | 只追加                      | 丢子代理过程记录，主会话还在                  |
| `sidechats/`        | session 插件（侧问即小会话）                               | 同会话目录                  | 丢该侧问，主会话还在                          |
| `plans/` · `tasks/` | 任务服务（plugin-tasks，D-049；计划 / 任务工具件经它写入） | 增删改（原子重写）          | 丢计划 / 任务的当前状态（可按日志重建）       |
| `queue.json`        | loop 插件（忙时排队，D-045）                               | 增删（tmp+rename 原子重写） | 丢排队条目（未发送的用户消息）                |
| `ui-state.json`     | web 宿主（经 server REST 整份收写，D-063）                 | 常改（整份原子重写）        | 丢界面态（草稿 / tab / 宽度），会话还在       |
| `memory/`           | memory 插件                                                | 偶尔改                      | 丢项目记忆                                    |
| `checkpoints/`      | 检查点插件                                                 | 增删（GC）                  | 丢回滚能力，不影响会话                        |
| `config/`           | 用户 / 宿主                                                | 偶尔改                      | 丢配置                                        |
| `plugins/`          | AI 创建（素材 + 可选 `engine/` 引擎模块，D-048）           | 版本级不可变                | 丢插件（卸载默认保留 `plugins-data/`，D-029） |
| `plugins-data/`     | 各插件                                                     | 各自决定                    | 丢插件数据（卸载默认保留，显式删除，D-029）   |
| `state/`            | 宿主                                                       | 常变                        | 丢运行时状态（重启重建）                      |
| `logs/`             | 宿主                                                       | 追加                        | 丢日志                                        |
| `cache/`            | 宿主 / 插件                                                | 常变                        | **可随时删，不影响任何数据**                  |

## 6. 检查点为什么是平行树

`checkpoints/<key>/` 与 `projects/<key>/` 平级，不合并进项目目录，理由：

1. `objects/` 是**内容寻址**存储，同一项目跨会话去重；
2. 检查点体积大（GB 级），需要能**单独 GC / 单独备份**；
3. 与用户数据分开后，`projects/` 可以只备份"对话与任务"，检查点按需保留。

删除项目时用同一条操作同时删两处（见 §7）。

## 7. 删除与清理语义

| 操作（网页界面） | 删除范围                                                                                                                     | 不删什么                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 删除项目         | `projects/<key>/` + `checkpoints/<key>/` + `projects.json` 条目                                                              | 插件、全局配置、全局记忆             |
| 删除会话         | `projects/<key>/sessions/<sessionId>/` 整个目录（含 meta、attachments、subagents、sidechats、plans、tasks、queue、ui-state） | 其他会话、项目记忆                   |
| 卸载插件         | `plugins/<id>/`（用户级或项目级）；`plugins-data/<id>/` 仅显式勾选时删（D-029）                                              | 其他插件、配置、插件数据（默认保留） |
| 清空缓存         | `cache/`                                                                                                                     | 一切用户数据                         |
| 回收检查点       | `checkpoints/<key>/objects/` 中无引用的 blob                                                                                 | 会话、manifest 引用的 blob           |

- 任何删除前**先列清单再执行**（不可逆操作的双确认是删除安全的硬规矩）；
- `logs/` 与 `cache/` 的删除永远安全；`state/` 删除等于重启后重建。

## 8. 凭据与权限

- 密钥只放 `config/credentials.json`，文件权限 **0600**（Windows 用用户目录 ACL）；
- 密钥只经 `ConfigService` 读取；**不进事件、meta、日志、模型上下文、导出物**；
- `models.json` 只放 provider / model 定义与能力字段，**不放 `apiKey`**（明文 key 是要避开的做法）；能力字段可由 models.dev 字典同步预填，手写覆盖字典（D-040）；模型管理面（✓ 2026-11-19）写同文件四样：厂商 `label` 显示名、模型 `hidden` 显隐清单（开关关=加入，选择器过滤）、自定义 OpenAI 兼容厂商的显式 `models` 记录（`user-` 前缀 id，无 key 也算连接态）、已知厂商缺 `baseUrl` 时连接自动从目录快照 `endpoint` 种（收敛批 2026-11-19——baseUrl 承重配置，断开永不碰）；连接/断开写 `credentials.json`（0600，只进明文 key，管理面响应永不回读——D-030）；
- **插件目录不是凭据存储**：`plugins/<id>/<version>/` 与 `plugins-data/<id>/` 的任何文件都不得写 API key / token / 密码；`mcp/*.json` 只写引用名，密钥由宿主从 `credentials.json` 注入（D-030）；
- 权限规则**三层**：会话级事件（`approval/decided{scope:'session',rule?}` + `approval/revoked` 存在会话日志里，**不是独立文件**）、项目级 `projects/<key>/permissions.json`（R198，随项目删除）、全局 `config/permissions.json`（跨项目；后两者同形、可手改）；详见 [tools-approval.md](./tools-approval.md) §3.1；
- **权限管理面（R199）**：设置 › 权限列出 `projects.json` 登记目录并逐项目读 `projects/<key>/permissions.json`；逐条删除直接改这些文件（不写会话账本事件）。坏文件只显示警示、绝不覆盖。项目身份 = `projects.json` 的 `id/key/cwd`（不新增项目元数据文件）；孤儿项目（只有 permissions.json、无目录条）不进选择器，规则仍生效、可手改；

## 9. 环境变量

- `HENIRA_HOME`：覆盖全局家目录，用于多实例 / 测试隔离（家目录可覆盖是同类工具的通行设计）；
- 项目内 `.henira/` 不受 `HENIRA_HOME` 影响，永远在仓库根；
- 所有路径解析统一走一个 `paths` 模块，禁止各处手拼（防止两套规则漂移）。
