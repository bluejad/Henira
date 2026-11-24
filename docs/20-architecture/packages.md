# Monorepo 包结构与依赖方向

> pnpm workspaces。包粒度学 dsh 按族拆包（D-049）：一族 = 服务件 + 工具件（fs = plugin-fs / fs-tools / fs-search），
> **拆到这里为止**——契约与实现同包、围栏与策略住服务件里。
> dsh 约 350 包的成因要拆开看：契约/实现/策略三角色分立的理念已收（槽位进 protocol、换实现走 D-048、
> 策略叠服务外层，D-049）；不抄的只是"一个角色一个 npm 包"——包数跟真实实现数走，
> 出现第二种实现（如沙箱版 fs）再拆包零迁移；生成式 catalog / 文档机器是规模的函数（调研坑 1、2），
> 我们全库当前 25 个包（packages 7 ＋ plugins 14 ＋ examples 2 ＋ test-support 2；目标结构另含 desktop / tui / 9 个计划插件 / examples/cloud，随 M5/M6 与发布后 backlog 落地）用不上，长到那个体量再议。
> 架构形态依据 **D-010（机制内核 + 一切皆插件）** 与 **D-012（落地细节四条）**。
> 运行时数据目录（`~/.henira/` 与项目内 `.henira/`）见 [data-directory.md](./data-directory.md)（D-014）。

---

## 目录总览

```
henira\                              ← 仓库根（仓库根目录名即 Henira，D-002）
├── packages\                       ← 机制、契约与宿主（不含任何插件）
│   ├── kernel\           @henira/kernel         机制内核（唯一内核/承重墙）：
│   │                                          服务槽位 + inject 依赖排序 +
│   │                                          事件总线（emit/serial/waterfall/bail）
│   │                                          + 可逆卸载 + createHarness 装配 API
│   ├── protocol\         @henira/protocol       契约层（单一真源）：
│   │                                          槽位接口（Session/Llm/Tools/Approval/
│   │                                          Loop/Interaction/Config）+
│   │                                          事件注册表（开放 map）+ DTO + Decision 词表
│   ├── config-loader\    @henira/config-loader  读取 henira.config.ts → 翻译成 TS API
│   │                                          调用（宿主共享的"服务员"，D-012④）
│   ├── server\           @henira/server         HTTP + SSE 宿主（正式宿主，D-035；含插件管理端点）
│   ├── sdk\              @henira/sdk            客户端：进程内 runtime + 远程 client 双形态
│   ├── cli\              @henira/cli            henira 命令（宿主：读 config → 装配 → 跑）
│   ├── web\              @henira/web            React 19 会话界面（正式宿主，D-038；插件管理面 + UI 宿主门面）
│   ├── desktop\          @henira/desktop        Electron 薄壳宿主（中远期，D-035）：
│   │                                          utilityProcess 起 server 子进程 + 窗口加载回环地址
│   └── tui\              @henira/tui            终端宿主（占位，发布后按需求建，50-open 🟢）：
│                                              C1 薄客户端连本地 server，终端自身不起服务
├── plugins\                        ← 全部官方插件（与社区插件同权、同一条注册路径，
│   │                                  任何包可被整包替换——位置即宣言，D-012③）；
│   │                                  当前已落码 14 个，下列 fetch / compaction / subagent /
│   │                                  tasks / plan / todo / skills / hooks / commands 为计划件（M5/M6）
│   ├── session\          @henira/plugin-session       事件溯源会话（官方默认实现）
│   ├── llm\              @henira/plugin-llm           StreamEvent 实现 + AI SDK 适配器
│   ├── tools\            @henira/plugin-tools         工具注册表 + 五段执行管线
│   ├── approval\         @henira/plugin-approval      fail-closed 审批（含凭据硬拒默认清单）
│   ├── loop\             @henira/plugin-loop          agent 循环（turn/step + 中断纪律）
│   ├── breaker\          @henira/plugin-breaker       熔断件（D-058）：死循环兜底，挂 loop/turn-stopping（bail）缝
│   ├── ask-user\         @henira/plugin-ask-user      提问件（R184）：ask_user 工具（执行中向用户提问，
│   │                                                 答案即工具结果；question/* 审计对，经 interaction 槽挂起/收答）
│   ├── fs\               @henira/plugin-fs            fs 服务件（D-049）：文件能力 + 路径围栏，
│   │                                                 契约 + 本地实现同包（围栏跟着能力走）
│   ├── fs-tools\         @henira/plugin-fs-tools      read / write / edit 工具件（注入 fs 服务）
│   ├── fs-search\        @henira/plugin-fs-search     glob / grep 工具件（注入 fs 服务）
│   ├── shell\            @henira/plugin-shell         shell 服务件（D-049）：命令执行能力
│   ├── shell-tools\      @henira/plugin-shell-tools   bash / powershell 工具件（注入 shell 服务）
│   ├── fetch\            @henira/plugin-fetch         web 抓取（服务化随 M5 设计文档，D-049）
│   ├── compaction\       @henira/plugin-compaction    上下文压缩（摘要 + 投影 + 热尾巴；提供压缩服务）
│   ├── subagent\         @henira/plugin-subagent      子智能体派发与报告回灌（服务化随 M5）
│   ├── tasks\            @henira/plugin-tasks         任务服务件（D-049）：plans/ tasks/ 唯一写者、
│   │                                                 "同一时刻只有一条主线"规则
│   ├── plan\             @henira/plugin-plan          计划工具件（计划 6 工具，注入任务服务）
│   ├── todo\             @henira/plugin-todo          任务工具件（任务 5 工具，注入任务服务）
│   ├── skills\           @henira/plugin-skills        技能读者（扫插件包 skills/：目录先行、激活注全文）
│   ├── mcp\              @henira/plugin-mcp           MCP 读者（按 mcp/ 起进程 / 连远程，工具转接进注册表）
│   ├── hooks\            @henira/plugin-hooks         钩子读者（事件上执行插件包 hooks/ 声明的外部命令）
│   ├── commands\         @henira/plugin-commands      命令收集（扫 commands/，占 commands 槽位，宿主消费）
│   └── web-ui\           @henira/plugin-web-ui        官方默认界面套件（D-043）：布局 + 会话列表 / 对话面板 /
│                                                    输入框 / 审批卡 / 右栏 tab 框架与预览体（R190 预览缝通配兜底）各件各占槽；真插件，M3 随 web 诞生
├── test-support\                   ← 测试支撑件（假模型 / 假 server / 测试夹具）——目录即宣言：
│   │                                  产品包与测试假件一眼分家，整根不进发布集、不做官方件
│   ├── llm-mock\         @henira/llm-mock       llm 槽位的脚本化 mock 实现（50-open 归档 2026-11-16）：
│   │                                          响应队列 + 兜底应答 + 请求捕获 + hang/throw 条目，
│   │                                          自校验 StreamEvent 不变量；各包测试以 devDependency 消费，
│   │                                          examples/mock 与 browser-e2e 以运行依赖消费，不进官方清单
│   └── browser-e2e\      @henira/e2e-browser    真浏览器 e2e（Playwright chromium；CI 步：mock serve 起服务 →
│                                              真页面交互断言 + 截图留档——凡交付界面的里程碑必有真浏览器
│                                              e2e，jsdom 组件级测试不替代）；chromium 不进发布集
├── examples\                       ← 最小示例与部署样例
│   ├── mock\                         离线可跑（mock LLM，无需 API key，兼作 e2e 测试载体）
│   ├── real\                         真实模型 demo（用户自备 key）
│   └── cloud\                        云端部署样例（计划，发布后 backlog；docker-compose；一人一容器一进程，D-036）
└── docs\                           ← 本文档体系（INDEX.md 为入口）
```

## 插件两圈（内圈 / 外圈）

- **内圈 = 最小可运行集**（缺一不可）：`session` / `llm` / `tools` / `approval` / `loop`——它们让 agent 能跑：记得住、说得出、干得了、管得住、转得起来。**内圈 5 本来就是服务**（D-049 的规矩对它们早已成立）。
- **外圈 = 可逐块追加**，能力件一律"**服务件 + 工具件**"按族分包（D-049）：fs 族（fs / fs-tools / fs-search）、shell 族（shell / shell-tools）、fetch、compaction、subagent、任务族（tasks / plan / todo）、熔断件 1（breaker，死循环兜底，D-058），读者 4（skills / mcp / hooks / commands），以及未来的沙箱 / 评测等。每加一块只做两件事：**新增插件包** + **在官方预设里多一行 `.use(...)`**；不改任何已有插件。
- **界面套件 1**：`web-ui`——官方默认界面以**真插件**交付（D-043）：布局与会话列表 / 对话面板 / 输入框 / 审批卡 / 右栏 tab 框架与预览体（`sidebar.right.preview.*` 通配兜底，R190）各件各占槽；不属两圈（不占引擎槽位、不进 D-041 批次名额），M3 随 web 诞生。界面挂点 = 界面侧服务（D-049）。
- **唯一会动骨架的情况**：新插件需要**新槽位**（例如沙箱需要 `SandboxService`）→ 在 protocol 加接口 → 承重槽位立 ADR；**能力服务槽位随该插件的设计文档进 protocol（D-049 授权，不逐个立 ADR）**。除此之外，插件开发是纯加法。

## 依赖方向

```
不可替换层（kernel / protocol 运行时零依赖；protocol 仅以类型引用 kernel 机制形状）
   kernel（机制）          protocol（契约：槽位接口 + 事件词表 + DTO）
      ▲                       ▲
      └───────────┬───────────┘
                  │ 一切插件与宿主只依赖这两层
plugins/*（当前 14 个已实现官方插件；目标 23 个，其余随 M5/M6 落地——服务件 + 工具件按族分包，D-049 / D-058 / R184）
   · 插件彼此【禁止 import 对方实现】——运行时通过槽位（ctx.session / ctx.loop …）互相消费
   · 工具件注入服务件（ctx.get，D-049）——能力共享唯一通道；服务件被关 / 换 → 注入它的工具件不装载 + 告警
   · 需要共享的类型/纯函数 → 下沉 protocol，不允许插件间直接依赖
                  ▲
                  │ 聚合（把插件装进槽位）
宿主层：config-loader / server / sdk / cli / web / desktop
                  ▲
              examples/*
```

## 各包职责一句话

| 包                   | 职责                                                                                                                                                                                                                                                                                                                   | 明确不做                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `kernel`             | 服务槽位、依赖排序装配、4 种事件模式、可逆卸载、createHarness                                                                                                                                                                                                                                                          | 不知道任何业务接口；不懂配置文件                                               |
| `protocol`           | 槽位接口、事件注册表、DTO、Decision 词表、一切清单派生、ServerEvent 行词表 + 账本→行投影器（M3——server 与 sdk 双形态共用的唯一组装处）                                                                                                                                                                                 | 不含执行逻辑、不含官方实现                                                     |
| `config-loader`      | 读 henira.config.ts + 全局 settings.json → 按装配三步翻译成 `.use()` 调用（D-015/D-016）；导出官方默认预设与随包技能目录清单（D-026）；模型参数字典（models.dev）同步归此层——运行时拉＋缓存＋快照兜底，手写覆盖字典（D-040）                                                                                           | 不做 patch 语法；不做校验器机器                                                |
| `plugin-session`     | 追加日志、派生模型历史、fork/replay、JSONL 存储缝                                                                                                                                                                                                                                                                      | 不知道 LLM、不知道 UI                                                          |
| `plugin-llm`         | StreamEvent 契约实现、AI SDK 适配器、模型配置→能力解析                                                                                                                                                                                                                                                                 | 不做循环、不存历史                                                             |
| `plugin-tools`       | 工具定义/注册/五段执行管线                                                                                                                                                                                                                                                                                             | 不决定"该不该执行"（approval 的事）                                            |
| `plugin-approval`    | 权限判定链、审计事件、凭据硬拒清单、fail-closed                                                                                                                                                                                                                                                                        | 不做 UI 弹窗（经 `InteractionService`）                                        |
| `plugin-loop`        | turn/step 状态机、inbox、中断纪律、16ms 合并、bail 缝                                                                                                                                                                                                                                                                  | 无产品模式、无文案、无厂商备表                                                 |
| `plugin-breaker`     | 熔断件：死循环兜底——**✓ 已落码（D-065，批 B）**：回合步数 / 同形工具调用重复检测双机制（回合内提醒行 + 回合尾经 `loop/turn-stopping`（bail）否决回合结束并注入续跑提示，D-013⑤、D-058）；首发批默认装配，阈值默认必设（50/3/2）且 settings 可配                                                                        | 不做审批策略；不做用户中断                                                     |
| `plugin-ask-user`    | 提问件（R184）：`ask_user` 工具——模型执行中向用户提问，execute await 答复、答复即工具结果（与审批分离）；`question/asked` + `question/settled` 审计对经 session 落盘、挂起/收答经 interaction 槽（kind `"question"`）；取消 = 工具 Error、回合继续；无墙钟自动收口，重启由 repair 补 invalidated。**✓ 已落码（R184）** | 不走审批通道（提问不是权限裁决）；不伪造 user 消息；不做超时自动答             |
| `plugin-fs`          | fs 服务件：文件能力（read/write/edit/glob/grep）+ 路径围栏（**围栏跟着能力走**，注入者皆受，D-049 修订 D-039；围栏强制点唯一住服务层、区外经判定链问）。**✓ 已落码（D-065，批 B）**——读态守卫（read-before-mutate）同层                                                                                                | 不注册工具（工具件在 fs-tools / fs-search）；不做循环                          |
| `plugin-fs-tools`    | read / write / edit 工具件（注入 fs 服务）。**✓ 已落码（D-065，批 B）**                                                                                                                                                                                                                                                | 不自带文件实现（服务的事）                                                     |
| `plugin-fs-search`   | glob / grep 工具件（注入 fs 服务）。**✓ 已落码（D-065，批 B）**——grep 为 JS 引擎（零外部二进制）                                                                                                                                                                                                                       | 同上                                                                           |
| `plugin-shell`       | shell 服务件：命令执行能力（每次新 spawn / timeout 默认 120s 上限 600s / 进程树杀）。**✓ 已落码（D-065，批 B）**                                                                                                                                                                                                       | 不注册工具（工具件在 shell-tools）                                             |
| `plugin-shell-tools` | bash / powershell 工具件（注入 shell 服务）。**✓ 已落码（D-065，批 B）**——非零退出码不是 isError、每流尾部 20KB                                                                                                                                                                                                        | 不自带执行实现（服务的事）                                                     |
| `plugin-tasks`       | 任务服务件：会话目录内 `plans/` `tasks/` 的**唯一写者**、"同一时刻只有一条主线"规则、把当前状态喂给模型（工具回显 / 提醒 / 收尾把关 / 拉取）                                                                                                                                                                           | 不注册工具（工具件在 plan / todo）；不 import 压缩与循环的实现（只挂总线事件） |
| `plugin-plan`        | 计划工具件：计划 6 工具（注入任务服务）                                                                                                                                                                                                                                                                                | 不直接写 `plans/` 目录（经服务）；可关（关掉只剩任务工具件）                   |
| `plugin-todo`        | 任务工具件：任务 5 工具（注入任务服务）                                                                                                                                                                                                                                                                                | 不直接写 `tasks/` 目录（经服务）                                               |
| `plugin-skills`      | 技能读者：扫已装插件包的 `skills/`（agentskills.io 标准 SKILL.md）、`.agents/skills` 只读根与官方随包 `skills/`；五级优先级见 [plugins.md](./plugins.md) §4（D-032），两级披露（会话初始化注目录、激活才注全文）                                                                                                       | 不做导入 / 同步管线（D-019）；不创建 / 不迁移外部技能目录（D-020）；不进内核   |
| `plugin-mcp`         | MCP 读者：按插件包 `mcp/` 定义起进程 / 连远程（标准 MCP 协议，兼容 `.mcp.json` 生态写法），把工具转接进注册表（坏服务器退避重连）。**✓ 已落码（D-064，批 C 收尾）**——官方 SDK、确认指纹、${credential:} 宿主注入、McpService + useResource 同批                                                                        | 不做循环；不做导入 / 同步管线（D-019）                                         |
| `plugin-hooks`       | 钩子读者：事件上执行插件包 `hooks/` 声明的外部命令（stdin 灌事件、退出码裁决、fail-open；兼认生态聚合 `hooks.json` 写法）                                                                                                                                                                                              | 不做审批策略（approval 的事）；拦截语义经测试锁定                              |
| `plugin-commands`    | 命令收集：扫插件包 `commands/`（md 模板 + `$ARGUMENTS`），占 `commands` 槽位（`CommandService.list / expand`，D-025）；宿主把展开后的文本放进输入框                                                                                                                                                                    | 不渲染界面（宿主的事）                                                         |
| `plugin-web-ui`      | 官方默认界面套件（D-043）：布局 + 会话列表 / 对话面板 / 输入框 / 审批卡 / 右栏 tab 框架与预览体（R190 预览缝通配兜底）各件各占槽；宿主标准件出口（import map）的同版本来源；安全模式（双击 Alt / URL `?ui=safe`）由 web 宿主实现、此包供默认组合                                                                       | 不含引擎逻辑；不做非 web 宿主界面                                              |
| `server`             | Hono HTTP + SSE、会话注册表、投影器消费（组装逻辑住 @henira/protocol 双形态共用——ServerEvent 词表行模型核心与 ZCode 同构，interfaces.md server 段）、审批端点、设置端点、插件管理端点（M4，D-029）；回环三件套——只绑 127.0.0.1 / 随机端口 / Host 校验＋可选 token 位（D-035）                                          | 不含业务策略                                                                   |
| `sdk`                | 进程内 createRuntime + 远程 createClient，同一 HeniraFacade 门面吐同一 ServerEvent 词表（双形态行为一致测试锁定）；纯 TS，零 React / 界面依赖（D-037）                                                                                                                                                                 | 不实现引擎逻辑；不携带界面                                                     |
| `cli`                | 读 config、装配的命令入口：`serve`（起服务，命令保留，D-018）/ `run`（headless 一次性任务，进程内嵌③，D-037）/ 黑窗口聊天（发布后，D-018）                                                                                                                                                                             | 聊天 v1 不含（D-018）                                                          |
| `web`                | 会话列表、事件流渲染、审批卡、输入框、设置页（插件管理：列表 / 详情 / 版本 / 卸载；**数据区展示/删除未落码**）；插件界面 UI 挂载与 14 方法宿主门面（D-028 / D-042）；界面**可嵌入**——`createWebApp(client)` 注入 client，宿主用法即注入默认 client 的特例，npm 用户与宿主同路（D-037）                                 | 不 eval 插件源码（模块加载，D-021）                                            |
| `desktop`            | Electron 薄壳宿主（中远期，D-035）：utilityProcess 拉 server 子进程、server.json 握手、窗口加载回环地址、托盘 / 自动更新 / 防双开                                                                                                                                                                                      | 不实现引擎 / 协议 / 界面（全部复用 server 与 web）                             |
| `tui`                | 终端宿主（占位，发布后按需求建，50-open 🟢）：C1 薄客户端连本地 server，终端自身不起服务                                                                                                                                                                                                                               | 不实现引擎逻辑（复用 server 与 sdk）                                           |

## 槽位实现归属

`InteractionService` 由**引擎所在进程**实现：①=server（审批卡经 SSE 推给网页、网页提交的答案经 HTTP 端点收回——web 页是呈现端，不是该槽位的实现者）；③=cli（`henira run`）与 sdk 嵌入方——sdk 自带缺省实现（fail-closed：没人应答一律拒；`settle` / `listPending` 契约同 protocol，嵌入方用它接自己的交互面，也可整只换掉），形状 M3 在 [interfaces.md](./interfaces.md) 定稿；examples 用 mock 自动答。`ConfigService` 由 config-loader 实现，宿主启动时注入；`CommandService` 由官方 `plugin-commands` 实现并占 `commands` 槽位（D-025），宿主只消费。前两者在 protocol 定义、不属于任何插件，`CommandService` 属于官方插件。`PluginUiHost` 由 web 系宿主实现，**不进 `SlotMap`**、不是引擎协议（D-028）。desktop 复用 server 与 web，不自行实现（D-035）。

## 依赖规则（CI 强制）

1. `kernel` 运行时零依赖；`protocol` 运行时零依赖、**互不依赖实现**——protocol 仅以类型引用 kernel 机制形状（`HarnessContext` 等），kernel 不认识任何业务接口（机制类型归 kernel，业务契约归 protocol）；zod 不属于协议层（D-051：官方事件校验器由 session 包实现，zod 是其实现细节）；
2. `plugins/*` 只依赖 kernel + protocol + 第三方库；**禁止插件互相 import 实现**——运行时经槽位互消费，**能力共享 = 注入服务（ctx.get，D-049 唯一通道）**；共享类型/纯函数下沉 protocol；**插件互依赖的例外通道 = devDependencies 仅测试装配**（测试里装真同伴，镜像 examples 聚合；dependencies 运行时仍然全禁）；测试支撑包 `@henira/llm-mock` 不是插件：仅供各包**测试**与 examples 以 devDependency 消费，不进发布集（50-open 归档 2026-11-16）；测试支撑件住 `test-support\` 根（2026-11-16 划位——目录即宣言，与 packages / plugins / examples 平级，check:deps / check:docs 同扫四根）；
3. 宿主（config-loader / server / sdk / cli / web / desktop / tui）依赖 kernel + protocol，并按需把 plugins/* 聚合进预设；宿主之间不互相依赖（cli 与 web 都经 sdk；desktop 复用 server 与 web 的产物，不依赖其包）。例外：**cli 直依 server**（serve/run 是 server 的启动入口）；**web 依赖 plugin-web-ui 的官方件编译期出口**（D-043——宿主用插件的件，不是插件依赖宿主）；**server / sdk / cli 运行依赖 config-loader**（装配翻译是宿主共享服务员，D-012④）；`sdk` 仅以 devDependency 引 server 做双形态测试。实际运行依赖中只有 server / sdk 同时依赖 kernel——其余宿主经 config-loader 间接使用；
4. `sdk` 双形态共用同一套 protocol 契约：进程内（聚合插件）与远程（连 server）行为一致；
5. 禁止循环依赖——CI 加依赖方向检查（dependency-cruiser 或等价物）；
6. 新增**内核承重槽位或核心包**须先立 ADR（防止不可替换层与包数量失控）；新增**能力插件或能力服务槽位**不需要 ADR——满足依赖规则并在官方预设登记即可（能力服务槽位 = 该插件设计文档的一部分，D-049 授权）。
