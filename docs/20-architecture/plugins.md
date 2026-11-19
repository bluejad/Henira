# 插件规范（Plugin Spec）

> 插件机制的**唯一事实**：目录结构、清单、槽位、界面 UI、启停、管理与创建流程。
> 状态：**已定稿**（2026-11-12）——同名覆盖（D-032）与宿主槽位词表（D-033）已收口；实现中发现形状问题按 [interfaces.md](./interfaces.md) 的流程改。
> 依据：D-015（配置面）、D-016（启用与装配）、D-017（格式与来源）、D-018（排期）、D-019（生态兼容）、D-020（技能来源）、D-021（界面 UI 形态）、D-022（替换粒度）、D-024（更新语义）、D-025（命令槽位）、D-026（官方随包技能）、D-027（缝命名）、D-028（UI 宿主门面）、D-029（插件管理面）、D-030（安全基线）、D-031（UI 位置静态申报）、D-032（同名覆盖）、D-033（宿主槽位词表）、D-048（engine 槽位与同 id 替换）、D-049（能力服务化）、D-057（行级挂载点）、D-059（语言 / 主题资产槽）、D-062（结构性槽与右栏 tab 框架）。
> 设计参照：公开实现的插件机制（dsh / Claude Code / ZCode）——只借鉴机制，零代码复用（D-004）。**格式采用行业标准**（MCP 协议、agentskills.io、生态常见写法），市面上现成的直接可用；**不做导入 / 同步管线**（界面无入口、后台不扫描，D-019 修订 D-017）。
> 包结构（22 个官方插件作为 npm 包，按族分包：服务件 + 工具件，D-049 / D-058）见 [packages.md](./packages.md)；数据落盘位置见 [data-directory.md](./data-directory.md) §2。

---

## 1. 插件的两种形态

| 形态                | 分发方式                         | 谁写                                                           | 能造引擎工具 / 替换官方插件吗                                                 | 例子                                                                                                                                                                                                                                                                            |
| ------------------- | -------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **引擎 / 界面插件** | npm 包，随宿主发布               | 官方 22 个（社区可整包替换）                                   | **能**（ToolDefinition 直写；替换官方 = `henira.config.ts` 显式清单，D-016④） | session / llm / tools / approval / loop / breaker（熔断，D-058）/ fs 族（fs / fs-tools / fs-search）/ shell 族（shell / shell-tools）/ fetch / compaction / subagent / tasks 族（tasks / plan / todo）/ skills / mcp / hooks / commands / **web-ui**（官方默认界面套件，D-043） |
| **内容包**          | 版本目录（`~/.henira/plugins/`） | **AI 创建**——插件的唯一用户侧来源（D-017；技能文件另见 D-020） | **带 `engine/` 槽能**（同 id 经确认卡替换官方，D-048）；纯素材包不能          | 一组技能、一个 MCP server、几条钩子、带界面或引擎代码的工具件                                                                                                                                                                                                                   |

**四个词（盒 / 货 / 通道 / 清单，D-049）**：

- **插件 = 盒子（App）**：可装载的包，管理单位——开关、钉版本、卸载、数据区都按整包操作；
- **工具 = 货（按钮）**：ToolDefinition 注册进 tools 注册表的一行，模型看见与调用的单位，**永远不是插件**；装载插件 = 把盒里的货摆上货架（注册表全场共享，不分谁的）；
- **服务 = 共享的能力通道**：有名字、有生命周期的对象，**跨包共享的唯一方式**（D-049）——官方件与第三方件注入的是同一个；
- **清单 = 勾盒子的配置表**：出厂清单 / `henira.config.ts` / settings 开关，是配置不是插件（不学 dsh"preset 亦为插件"）。

复用只有两条路：**装插件**（其工具全场可用）或**注入服务**；不存在"单独写个工具再共享"——工具永不独立存在。

- 官方与内容包走**同一条注册路径**，官方无特权（P8）。官方替换两条路并存：开发者 = `henira.config.ts` 显式写清单（不列官方、列自己的）；用户 / AI = 同 id + `engine/` 经确认卡替换（D-048）——**不做静默顶替**（D-016④）。
- AI 创建的包 = 素材槽位 + **两个代码口子**：`ui/` 界面模块（D-021）与 `engine/` 引擎模块（D-048）——同为普通 ESM、模块加载、不求值，其余槽位均为纯内容。带 `engine/` 的包用与官方**同一套 API**（defineTool / ServiceDefinition / 挂事件 / 占槽位），P8 同权字面成立。
- **落码状态（2026-11-19 批 C）**：目录发现/清单校验（§2/§3）、engine 装载（jiti + `@henira/*` alias 唯一实例 + 依赖表硬规矩 + `inject` 预检 + `engines` 兼容门）、确认卡 fail-closed（§4 :105）、装配三步（§5，含 config.plugins 基础清单）、UI 装载（import map shim + 版本化 URL + 指纹轮询免刷新重装）、管理面启停/版本/卸载/确认（§6.4）、未知槽告警（§7.2）已落码；项目级插件、D-048 同 id 替换官方、运行时文件级 HMR、MCP/凭据注入（D-030）、插件数据区详情随后续小批。

## 2. 版本目录结构（唯一事实）

```
~/.henira/plugins/<id>/          ← 一个插件一个根（id：字母/数字开头，可含 . _ -，支持中文）
   └─ <version>/                ← 版本目录（版本级不可变）
      ├─ plugin.json            ← 必需：清单（见 §3）
      ├─ skills/<名>/SKILL.md   ← 技能槽
      ├─ commands/<名>.md       ← 命令槽
      ├─ hooks/<名>.json        ← 钩子槽
      ├─ mcp/<名>.json          ← MCP 槽
      ├─ agents/<名>.md         ← 子代理槽
      ├─ ui/main.js             ← 界面模块（ESM；清单 ui.entry 指定，D-021）
      ├─ engine/main.js         ← 引擎模块（ESM；清单 engine.entry 指定，D-048）；
      │                            标准 Node 包目录——需要依赖时可带 package.json +
      │                            node_modules + pnpm-lock.yaml（AI 自己装，见 §5）
      └─ 其余任意目录/文件       ← 自由区：装载器不碰，谁的内容谁自己用
```

- **开放内容目录**：目录存在即生效，各读者插件认领自己那类；**没人认领的目录装载器永远不碰**——将来新增机制零改格式，新读者认领新目录名即可。
- 项目级 `<项目>/.henira/plugins/` 与用户级同构，同名时项目盖用户级（**v1 后置**：v1 只做用户级；项目级随装配②）；
- 插件持久数据放 `~/.henira/plugins-data/<id>/`，与版本目录解耦（升级、卸载默认都不丢数据；D-029）。
- **版本目录与 `plugins-data/` 是用户内容，不是凭据存储**：任何文件都不得写 API key / token / 密码；MCP 需要的密钥由宿主从 `config/credentials.json` 注入（D-030）。

## 3. 清单 plugin.json

```json
{
  "name": "番茄钟",
  "version": "1.0.0",
  "description": "右栏倒计时小件：25 分钟，支持开始/暂停/重置。",
  "author": "…",
  "ui": { "entry": "ui/main.js", "title": "番茄钟", "slots": ["sidebar.right"] }
}
```

- `name` **必填且必须与目录名一致**；`version` 写了必须与版本目录名一致、缺省取目录名（不一致 → 跳过并告警）；其余可选；
- 解析口径：**缺省救缺失，写错丢整段**；清单缺失 / 损坏 → 跳过该插件并告警，**不挡启动**（坏插件不该让整个软件打不开；真缺关键插件跑不起来，内核报错兜底——"loop 需要槽位 'llm'，没有插件提供它"）；
- `ui` 段（D-021 / D-031）：`entry` 可选（相对版本目录的 ESM 入口，**缺省 `ui/main.js`**）、`title` 可选（插件列表展示）、`slots` **可选**（声明计划挂载点，供插件页提前展示 / 加载前校验 / AI 自测；v1 取值见 §4 挂载点词表——结构性 / 区域级五个 ＋ 行级五个（D-057 / D-062）；keyed 槽声明写实际要注册的全名，如 `tool.call.view.search`）；**实际挂载仍以 `ctx.registerSlot` 为准**，字段名是 `ui.slots` 不是 `slot`。
- `engine` 段（D-048）：`entry` 可选（相对版本目录的 ESM 入口，**缺省 `engine/main.js`**）；顶层可选字符串字段 **`engines`**（如 `"engines": "^0.1"`；2026-11-19 定名——原名 `engine` 与段名撞 key，JSON 无法同义）声明兼容的引擎版本，装载时校验、不符跳过 + 告警（兼容门）。注入哪些能力服务由**引擎模块导出**声明（`export const inject = [...]`，D-049），manifest 不复写——单一事实源。

## 4. 槽位文件格式

| 槽位     | 文件                                         | 格式                                                                                                                                                                                                                                                                                                                                            | 读者                                                               |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| skills   | `skills/<名>/SKILL.md`                       | YAML frontmatter（`name` / `description`）+ 正文；对齐 Agent Skills 规范（agentskills.io）                                                                                                                                                                                                                                                      | plugin-skills（另只读扫描 `.agents/skills` 与官方随包，见下）      |
| commands | `commands/<名>.md`                           | frontmatter（`description` / `argument-hint`）+ 正文模板，`$ARGUMENTS` 为参数占位                                                                                                                                                                                                                                                               | plugin-commands（占 `commands` 槽位，D-025）                       |
| hooks    | `hooks/<名>.json`                            | `{ event, matcher?, type: process\|shell, command, args?, timeout?, statusMessage? }`                                                                                                                                                                                                                                                           | plugin-hooks                                                       |
| mcp      | `mcp/<名>.json`                              | 本地：`{ command, args?, env? }`；远程：`{ url, headers?, type? }`                                                                                                                                                                                                                                                                              | plugin-mcp                                                         |
| locales  | `locales/<lang>.json`                        | 语言字典：顶层 `string → string` 映射，键集 = 官方 zh 词表同键；**缺 key 回落官方 zh**（语言包是内容不是逻辑，不 fail-loud，D-059）                                                                                                                                                                                                             | 官方界面件（web 宿主装配时扫已装插件，D-059；**已落码，M4 批 A**） |
| themes   | `themes/<名>.css`                            | 主题变量组：`.henira-app[data-theme="<名>"]` 一组 CSS 变量（结构同官方 tokens.css）；官方 light / dark 两档永在不可覆盖，第三方方案追加进下拉（D-059）                                                                                                                                                                                          | 官方界面件（同上，D-059；**已落码，M4 批 A**）                     |
| agents   | `agents/<名>.md`                             | frontmatter（`name` / `description` / `tools?` / `model?`）+ 正文 = 系统提示词；**缺 description 不产代理**（description 是委派的唯一依据）                                                                                                                                                                                                     | plugin-subagent                                                    |
| ui       | `ui/main.js`（ESM，`ui.entry` 指定）         | 导出 `apply(ctx)`；`ctx.registerSlot(name, component, { order? })` + `ctx.host`（13 方法，D-028 / D-042）；只依赖 `react` + 同目录相对路径                                                                                                                                                                                                      | 网页宿主                                                           |
| engine   | `engine/main.js`（ESM，`engine.entry` 指定） | 导出引擎插件定义（**与官方同一套 API**：defineTool / ServiceDefinition / 挂事件 / 占槽位，D-048）；依赖四源——Node 内置、`engine/` 自带依赖（package.json + node_modules，AI 用 pnpm 装）、**能力服务（`inject` 声明注入，官方与第三方同权，D-049）**、宿主经 import map 注入的 `@henira/kernel` / `@henira/protocol` **唯一实例**（禁自带副本） | 装配层（config-loader / kernel 装配）                              |

**槽位校验与失败语义（定稿）**：清单与槽位一律「**缺省救缺失、写错丢该项**」——坏一个槽位不拖垮整插件；只有 `plugin.json` 本身缺失 / 损坏才跳过整个插件。槽位目录不存在 = 没有该槽位，不告警。

| 槽位     | 校验                                                                                                                                                               | 坏了怎么办                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| skills   | `<名>/SKILL.md` 有 YAML frontmatter 的 `name` / `description` + 非空正文；`name` 与目录名一致                                                                      | 跳过该技能 + 告警；其他技能照常                                                                                                                                     |
| commands | `<名>.md` frontmatter 有 `description`；正文非空；`$ARGUMENTS` 可选                                                                                                | 跳过该命令 + 告警（`CommandInfo.description` 必填，D-025）                                                                                                          |
| hooks    | `event` 在事件表内；`matcher` 是合法正则；`type` ∈ process / shell；`command` 非空；`timeout` 为数字                                                               | 跳过该钩子 + 告警；**不执行**                                                                                                                                       |
| mcp      | JSON 合法；`command` 或 `url` 至少一个；env / headers 只写非敏感配置（密钥引用宿主注入，D-030）                                                                    | 跳过该 server + 告警；**不 spawn**                                                                                                                                  |
| locales  | JSON 合法；顶层为 string → string 映射                                                                                                                             | 不采用该字典 + 告警（其他已装语言不受影响）；其他槽位照常                                                                                                           |
| themes   | 文件存在且可读                                                                                                                                                     | 不采用该主题 + 告警；其他槽位照常                                                                                                                                   |
| agents   | frontmatter `name` = 文件名、`description` 必填、`tools` ∈ 已知工具；正文非空                                                                                      | 缺 `description` 不产代理（description 是委派唯一依据）；其他非法 → 跳过 + 告警                                                                                     |
| ui       | `ui.entry` 文件存在；模块可加载并导出 `apply`；`registerSlot` 的挂载点合法                                                                                         | 不挂该 UI + 告警；**其他槽位照常**，插件列表标黄                                                                                                                    |
| engine   | `engine.entry` 文件存在；模块可加载并导出插件定义（可选导出 `inject` 数组）；清单 `engines` 版本字段匹配（兼容门）；依赖表无 `@henira/kernel` / `@henira/protocol` | 不装载该包引擎代码 + 告警；**同 id 替换场景自动回落官方实现**（D-048）；**声明的注入服务无提供者 → 该件不装载 + 告警、其余照常**（装配层预检，D-049）；其余槽位照常 |

**安全规则（D-030，定稿）**：

- **插件目录不是保险箱**：版本目录与 `plugins-data/` 内不得出现明文凭据；`mcp/*.json` 的 `env` / `headers` 只放非敏感配置，密钥引用由宿主从 `config/credentials.json` 注入；
- **静态资源隔离**：插件自带的 html / svg / js 以文档形式伺服时带 `CSP: sandbox`（opaque origin）；ESM UI 模块与宿主同源，**不是安全边界**（D-021），不得写入凭据；
- **MCP 定义变更要确认**：新增 / 修改 `mcp/*.json` 会在新会话自动 spawn，宿主在插件管理面首次连接或变更后让用户确认（安装动作本身即确认）；
- **hooks 要明示**：创建 / 启用 hook 时展示 `event` 与将执行的命令；拦截类（退出码 2）说明影响面；
- **UI 引擎交互走门面**：`sendPrompt` / `useResource` 等经 `ctx.host`，不直接调宿主内部端点；门面不提供凭据、文件系统任意路径、进程能力。
- **引擎代码经确认卡进门（D-048，2026-11-19 范围统一）**：**任何**带 `engine/` 的包首次生效（及每次版本升级）前须管理面确认卡放行——卡上写明：**注册了什么（工具 / 占哪个槽 / 挂哪些事件）、依赖的第三方包、是否替换官方（替换谁）、代码路径**；"作者可信"由用户点头，不由装载器猜。**未确认 = 不装载**（fail-closed，状态 `awaiting-confirm`）；同 id 替换官方的场景卡上额外写明替换对象，拒绝则官方照常。依赖安装命令（`pnpm install`）本身走既有审批链。

**能力服务与注入（D-049）**：

- 官方插件对外提供的能力**一律是服务，只有一种写法**（单消费者也直接做，不做"先私有后升级"两轨道）；**跨包共享必经服务**——注入声明在引擎模块导出（`export const inject = [...]`），装载器照声明排装载顺序；首批 fs / shell / tasks，其余随各插件设计文档落契约（清单见 [interfaces.md](./interfaces.md) 能力服务表，开放不封顶）；
- **装配层预检**：声明注入的服务在装配结果里没有提供者 → 该引擎件不装载 + 告警（坏插件同款，不挡其他插件）；
- **第三方同权**：AI 创建的插件既可注入官方 / 第三方服务，也可用 ServiceDefinition 提供自己的服务给别人注入（P8 字面）；
- **东西不是服务，通道才是**：工具、UI 组件、技能 / 命令等内容永远不是服务——它们分别经由 tools 注册表、槽位、读者共享。

**钩子执行语义（定稿）**：`event` 用**生态标准名**（Claude Code 那套是事实标准：`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PermissionRequest` / `PostToolUse` / `PostToolUseFailure` / `Stop`）；Henira 独有的时刻用 `henira/` 前缀扩展，不占用生态名。**名字是 hook 层的公共词表，触发时机是我们的内部缝**——映射由 plugin-hooks 内部完成，不暴露给插件作者：

| `event`              | 触发时机（内部缝）                              |
| -------------------- | ----------------------------------------------- |
| `SessionStart`       | 会话 / agent 创建                               |
| `UserPromptSubmit`   | `loop/pre-step` 的 enter 决策                   |
| `PreToolUse`         | `tools/pre-execute`（waterfall）                |
| `PermissionRequest`  | `approval/request`（规则未命中、弹卡前，D-027） |
| `PostToolUse`        | `tools/post-execute`（成功分支）                |
| `PostToolUseFailure` | `tools/post-execute`（isError 分支）            |
| `Stop`               | `loop/turn-stopping`（bail）                    |
| `henira/…`           | 将来 Henira 独有的时刻（清单随实现加）          |

`PreCompact` / `SubagentStart` / `SubagentStop` 等生态名随后按需加入（名字不变）。stdio 灌事件 JSON；退出码 0 放行、**2 = 拦截**、其他非零一律放行；stdout 为 JSON 时支持 deny / ask / allow / 改写参数 / 改写提问 / 附加上下文（封顶 4000 字）；**fail-open**——钩子崩溃 / 超时 / 输出非法 → 目标动作照走；顺序执行，首个拦截短路剩余；超时缺省 60 秒。

**技能披露语义（定稿）**：两级披露——会话初始化只注入目录（名字 + 描述），模型要用时才"激活"、此时才注入全文（带去重与内容缓存）。

**模板变量（定稿）**：`${HENIRA_PLUGIN_ROOT}` = 插件版本目录；`${HENIRA_PROJECT_DIR}` = 会话 cwd。

**技能来源（D-020 / D-026 / D-032，定稿）**：技能按五级来源发现（插件包槽位 + 生态标准目录 + 官方随包）——

- 优先级五级（D-032）：**项目 `.agents/skills/` > 项目插件 `skills/` > 用户 `~/.agents/skills/` > 用户插件 `skills/` > 官方随包 `skills/`**（官方最低，D-026）；同名时高层级赢；同层多插件同名按插件 id 字典序，靠前者赢并告警；
- `.agents/skills` 三个"不"：**不创建目录、不复制 / 迁移文件、不登记为插件**（无 `plugin.json`、无开关）；目录不存在 = 没有，外部技能的开关就是文件本身；
- 形态限 `<name>/SKILL.md` 目录包（agentskills.io），不递归任意层级；发现后与插件技能同走两级披露；
- 官方随包 = 官方 npm 包内的 `skills/`（目录清单由 config-loader 导出；创建技能随 `plugin-skills` 发布，D-026）；
- 不新造 `~/.henira/skills/` 或项目 `.henira/skills/` 根。

**界面 UI 模块契约（D-021 / D-028，定稿）**：

- **形态**：ESM 模块，`export function apply(ctx)`（可返回 cleanup）；宿主以只读静态路由伺服**该插件版本目录**（禁路径穿越），网页 `import()` 加载；
- **允许 import**：`react`（import map 指到宿主同一份）、同目录相对路径；第三方实现库必须自带（随模块打包），宿主不解析 `node_modules`；
- **源码随包走**：需要构建的界面件，源码可住在 `ui/src/`（自由区：TS 源文件、package.json、开发用 node_modules、构建配置），AI 写完在原地构建、产物进 `ui/` 根；**宿主只加载 `ui.entry` 产物**，源码与开发依赖不加载、不解析；更新写新版本目录时源码随版本一起拷——源码与产物永远同版本（D-024），不漂移；分发 / 备份不带 node_modules（开发脚手架，到场要改时 AI `pnpm install` 重装即可）；
- **禁止**：Node API、自带 React、改写应用根节点 / `document.body`、读别的插件的 DOM / 样式；
- **ctx 门面**：`registerSlot(name, component, { order? }) → disposer` + **`host: PluginUiHost`**（13 方法，见下）；样式 / 监听 / 定时器在 `apply` 内注册，随页面卸载撤销；
- **挂载点 v1 十个（D-057 行级四缝 2026-11-17 ＋ D-062 结构性 / 右栏 tab / 词表正名 2026-11-18）**：
  - **结构性一个**：`layout`——**整页框架槽**；官方框架件（左中右框架本体，现 web Shell 拆出）默认占用，并在占槽的同一注册里声明子槽（**槽套槽**：声明 = 独占渲染权，dsh AppFrame 理念行为层）；`replaceSlot("layout")` = **整页重排**（风险标注同 dsh root 槽：影子化官方 UI——官方区域槽声明随框架件消失；安全模式回落官方框架）；
  - **区域级四个**：`sidebar`（左栏）· `conversation`（中柱）· `composer`（输入区）· `sidebar.right`（右栏；官方默认件 = tab 框架，见下行）；D-062 起三名正名与宿主代码一致（原 D-033 名 `session.top` / `composer.above` / `sidebar.right` 作废——按文档写插件从"静默忽略"变"直接生效"）；
  - **行级五个**：`tool.call.view.<工具名>`（**工具卡自定义渲染**，按工具名 keyed——插件给自家工具定制卡片、或顶替官方工具卡）· `conversation.images`（**消息图片画廊**，单槽；官方默认件渲染行内图片组）· `turn.tail`（**回合尾追加位**——回合结束后追加呈现块：交付卡 / 富结果卡；追加不改写回复正文）· `sidebar.right.tab`（**右栏 tab 追加位**——一件 = 一个 tab 面板，加号 / 下拉列已注册面板；官方 tab 与插件 tab 并存）· `sidebar.right.preview.<扩展名>`（**侧栏文件预览实现**，按扩展名 keyed——docx / pptx / pdf / 表格 / 视频 / 图片等富预览由此扩；文件预览 tab 的 body 实现缝）；
  - **槽位词表按宿主定义**（D-033）：行级三条 `turn.tail` / `conversation.images` / `tool.call.view.*` 是 web 系共享核心；`layout`、区域四名与三个 `sidebar.right.*` 属桌面 web 宿主词表；
  - **落码状态**：行级三条已生效（M4 批 A——`tool.call.view.` / `conversation.images` / `turn.tail` 宿主已接受、对话流已消费）；**三栏骨架批已生效（2026-11-18，先行于批 C，D-063 先例）**：`layout` 槽（官方框架件占槽 + 同一注册声明子槽，宿主 root 只挂 layout）· `sidebar.right` 区域槽（官方默认件 = tab 框架：⌄ 已开面板清单 + tab 条横滚 + ＋ 空白面板展位 + ⤢ 最大化；`rightPanel{open,active,tabs}` 进 ui-state 按会话持久化）· `sidebar.right.tab` 追加位（宿主接受、框架消费——注册件各成一 tab，标签暂取件名）；`sidebar.right.preview.` 前缀宿主已接受、渲染挂点仍缺（随批 C / 桌面批）；批 C 余项（第三方 UI 装载通道 / 插件管理面 / useResource / listPlugins / D-048 确认卡）不变；
- **keyed 词表按前缀识别（D-057）**：`tool.call.view.` / `sidebar.right.preview.` 前缀合法、后缀自由（工具名 / 扩展名——含插件自家工具名）；`sidebar.right.tab` / `turn.tail` 是追加位非 keyed（`registerSlot` 多件共存，`order` 排序）；未知前缀照 D-033 处置（别的宿主词表 → 静默忽略，完全未知 → 丢弃告警）；
- **区域替换（D-043）**：`replaceSlot(name, component)` 替换该区域的官方默认件；同区冲突报错（D-022 同款）；没装东西的框**收起**（不渲染不占宽，不留空白）；装法可自定义（件挂哪个槽可配置）；`layout` 槽替换 = 整页重排（风险标注见挂载点词表块）；
- **keyed 槽占用语义（D-057）**：官方内置件默认占用（工具卡 / 预览各有官方默认实现）；插件 `replaceSlot` 顶替，卸载 / 停用自动回落官方；同 key 第二家顶替 → 报错不装载 ＋ 告警（与 D-022 唯一占用、D-048 回落官方同语义）；`conversation.images` 同理可顶替；`turn.tail` 纯追加（`registerSlot` 多件共存，`order` 排序）；**安全模式**（双击 Alt / `?ui=safe`）行级缝全部收起、回落官方默认渲染（编译期出口 defaultParts 占位）；`sidebar.right` 官方默认件 = tab 框架（ZCode 式 tab 条 + 加号 / 下拉列已注册面板——dsh tab 注册制 extension 优先 builtin 行为层，v1 简化：插件 tab 追加共存，preview 的 keyed 顶替缝不变）；顶替 `sidebar.right` 本体 = 整条右栏替换（tab 框架一并换）；
- **标准件出口（D-043）**：官方界面件（**整页框架件** / 会话列表 / 对话面板 / 输入框 / 审批卡…）经宿主标准件出口（import map，与 react 同口子）供插件 import——同一份同版本件，插件间禁止私拉直连；件与**会话上下文**一起给（承重缝，M3 定稿）；插件可 import 官方件复用（站在官方件上写自己的），不强制从零造；
- **官方界面 = 真插件（D-043）**：`plugin-web-ui` 一个包装下整页框架（`layout` 槽）与各件、各占各槽；与社区插件同一条注册路径；内圈 UI 槽位**不给关、不提供版本钉**（D-016 机制，装配层规则）；三级后手 = 槽位级自动回退 → 双击 Alt 安全模式 → URL `?ui=safe` 兜底；
- **位置申报（D-031 / D-033）**：`ui.slots` 可选；声明了才校验——声明未注册 = 死声明告警，注册未声明 = 漏声明告警；未知挂载点：属于别的宿主词表 → 静默忽略，完全未知 → 丢弃该条并告警（D-033）；不是数组 / 类型错 = 忽略该字段（保留 `entry` / `title`）并告警；不写 `ui.slots` 完全合法；实际挂载仍以 `ctx.registerSlot` 为准；
- **错误与隔离**：未知挂载点 / 重名 / 模块加载失败 → **不挂该 UI 并告警**，其他槽位与宿主照常；插件列表标黄；`ui.slots` 与实际注册不一致 → 告警但不阻断（D-031）；
- **安全口径**：同源同权限，**不是安全边界**；门面不提供凭据、文件、进程能力；插件来源仍限"用户自己装的 / AI 创建的"；**不求值源码**（无 `new Function` / eval）。

**UI 宿主门面 13 方法（D-028 12 个 ＋ D-042 subscribe）**：

| 组       | 方法                          | 语义                                                                                                                                               |
| -------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **对话** | `sendPrompt(text)`            | 把一句话作为用户提问送进中柱（与手打同一条路），返回 `{ messageId, sessionId }`；`messageId` 为 null = 发送失败                                    |
|          | `subscribe(filter, cb)`       | 订阅本会话引擎事件（含流式增量）；过滤 = 类型白名单 + 可选 turnId；不订阅不收；有界队列背压——增量可丢可并、终局必达（D-042，细则见下节双向事件流） |
|          | `onTurnFinished(receipt, cb)` | 注册回合落定回调，**恰调用一次**；只收该 UI 模块自己发起的那一轮；返回 `Disposable`                                                                |
|          | `prefill({ chip?, text })`    | 把技能 chip + 引导语回填输入框，不发送                                                                                                             |
|          | `renderMarkdown(text, opts?)` | 返回宿主同款、已消毒的 Markdown 元素；`{ highlight?: false }` 可关代码高亮                                                                         |
| **数据** | `useResource(address)`        | 订阅实时数据，返回 `{ status: 'loading' \| 'live' \| 'failed', data?, text?, error?, updatedAt? }`；React hook 语义，仅 render 期调用              |
|          | `listPlugins({ category? })`  | 插件清单（id / name / version / description / category / enabled）                                                                                 |
|          | `listDir(path)`               | 列目录（只限会话工作区内；隐藏项不返）                                                                                                             |
|          | `listSessionsByCwd(cwd)`      | 某工作目录全部会话，按更新时间新→旧                                                                                                                |
| **宿主** | `getSession()`                | `{ sessionId, cwd }`；无会话时皆 null                                                                                                              |
|          | `openInExplorer(path)`        | 资源管理器定位；仅桌面宿主可用，其他宿主返回 `false`                                                                                               |
|          | `openPlugin(id, view?)`       | 打开另一插件的挂载面；`view` 一次性                                                                                                                |
|          | `getInitialView()`            | 取走本次 `openPlugin` 传的 view；**读后即焚、按插件隔离**                                                                                          |

**双向事件流（D-042 修订 D-028 单向阀）**：

- UI 模块 → 中柱仍只有 `sendPrompt` 一条路（发起单口，避免双写）；
- AI → UI 模块开放**订阅**：`host.subscribe(filter, cb)` 收**本会话**引擎事件（含流式增量）；过滤 = 事件类型白名单 + 可选 turnId；**不订阅不收**（默认行为同原单向阀，订阅是显式 opt-in）；
- **背压**：每订阅者一条有界队列；队满时增量类可丢可并（16ms 攒批，P6 同款），终局类（tool-call 终态 / approval / turn-end）必达；
- `onTurnFinished` 保留为自己发起回合的便捷终局回执；
- **模型不知道 UI 模块存在**不变——订阅是宿主推给呈现层，事件不回注模型上下文；"UI 不是第二个对话窗口"的边界由**输入单口**守住。

**`useResource` 数据泵（D-028）**：

- 地址格式 `henira-data://<pluginId>/<mcpServer>/<tool>?args=<URL 编码 JSON>`；`pluginId` 必须是当前插件目录名；
- 只允许调用**同一插件 `mcp/` 里声明过的 server**（所有权闸，越权 403）；
- 宿主 2 秒共享轮询：同地址多 UI 共用一份泵、引用计数、末订阅者退订；
- 单次 30 秒超时、结果 200 KB 截断；失败保留上次数据（`status:'failed'` 但 `data` 还在）；
- `data` = 工具返回文本的 JSON 解析结果；解析失败时 `text` 保留原文。

**终局映射（D-028）**：

| 回合结束                   | `onTurnFinished` 投递                    |
| -------------------------- | ---------------------------------------- |
| 正常完成                   | `{ ok: true, text }`                     |
| 用户中断                   | `{ ok: false, reason: 'interrupted' }`   |
| 错误（模型 / 工具 / 网络） | `{ ok: false, reason: 'error' }`         |
| 提交失败 / 未进入回合      | `{ ok: false, reason: 'submit_failed' }` |

**更新生效（D-024 / D-028，2026-11-19 升级）**：UI 模块按**版本化 URL**（`ui/main.js?v=<version>`）装载——版本目录不可变（D-024），URL 即版本。停用 / 启用 / 切版本 = dispose 旧件 + `import` 新 URL + 重渲，**页面内生效、无需整页刷新**；宿主对插件清单做**指纹轮询**（2s 级，`GET /api/plugins` 的 `fingerprint`），目录出现新版本目录即自动重装。运行中会话的引擎件不变（新会话生效，§5）；不做文件级 HMR（同版本目录内容不可变）。`settings.json plugins.<id>.version` 钉版本（D-024）。

**生态兼容（D-019，定稿）**：格式采用行业标准，市面上现成的东西放进目录即可用——

- SKILL.md 对齐 Agent Skills 规范（agentskills.io）；
- MCP 走标准协议（stdio / HTTP / SSE）：npm 上现成的 server，在 `mcp/` 里填一行定义即接；
- 钩子读者兼认生态聚合 `hooks.json` 写法（一文件装多个钩子）；
- 模板变量兼认 `${CLAUDE_PLUGIN_ROOT}` / `${ZCODE_PLUGIN_ROOT}`（等同 `${HENIRA_PLUGIN_ROOT}`）与 `${CLAUDE_PROJECT_DIR}` 等（等同 `${HENIRA_PROJECT_DIR}`）；其余品牌前缀变量不做兼容（2026-11-12 明确）；
- **不做**：界面导入入口、后台扫描别家目录规整进插件体系；市场货架与 zip 暂存安装机器不建（D-019）。

## 5. 启停与生效粒度（D-016）

- 开关存 `~/.henira/config/settings.json` 的 `plugins.<id>.enabled`：**缺 key = 启用**，显式 `false` 才停用（形状见 [data-directory.md](./data-directory.md) §2.3）；
- **装配三步**（每个新会话）：① 基础清单（项目 `henira.config.ts` 写了 `plugins` 听它的，否则出厂清单）② 加已装目录的插件（同 id 不重复算，同名项目盖用户级；**v1 只扫用户级 `~/.henira/plugins/`，项目级随装配②**）③ 去掉 `enabled: false` 的；
- **对新会话立即生效**，不重启服务；运行中的会话不变，关掉重开才变；
- **MCP 槽是唯一例外**：插件启用 ≠ MCP 自动连接；首次连接或 `mcp/*.json` 变更需在管理面确认（D-030），确认前该 server 的工具不进注册表；
- 内圈 5 槽位（session / llm / tools / approval / loop）不提供开关——关了跑不起来；官方界面件（`plugin-web-ui`）同款：**不给关、不提供版本钉**（D-043，界面永不缺席）；
- 开关只能**关**，不能**换**：换官方插件 = `henira.config.ts` 显式写清单。
- **替换粒度 = 整份清单**（D-022）：想改默认清单用 TS 表达式（`defaultPreset.filter / map / [...spread]`，范例见 [interfaces.md](./interfaces.md) §config-loader）；不设按 id 的补丁语法；同一槽位两个插件 = 内核报错，不静默后者赢。
- **用户包替换官方插件（D-048）**：**确认卡范围 = 任何带 `engine/` 的包首次生效（及版本升级）都弹卡**（2026-11-19 统一，见 §4 安全规则）；本段描述同 id 替换官方的**额外**语义——包 id 与官方插件相同且带 `engine/` → 卡上写明替换谁（**版本升级重弹**、同版本只一次，确认记录存 `settings.json plugins.<id>.confirmedVersion`）；确认才装载，拒绝则官方照常；生效后管理面显示"已被用户插件替换（来源 + 版本）"。优先级 = 项目插件 > 用户插件 > 官方 npm。装载失败 / 运行崩溃 → 标损坏 + 告警 + **自动回落官方实现**；关掉 / 删掉用户包，官方自动回来。22 个官方件（含内圈 5）同一套规则，无特例——一般情况下没人去换，但要能换。同 id 纯内容包（无 `engine/`）不构成替换（D-032 照旧）；不同 id 注册与已启用插件同名工具 → 报错不装载、提示先关官方。**替换粒度两级（D-049）**：换工具件（只换一盒工具）或换服务件（整个换能力实现、注入它的工具件全体跟着换），同一套确认卡与回落；
- **服务件的开关与失效（D-049）**：关掉 / 换掉一个服务件，注入它的工具件自动不装载并告警（如关掉 fs 服务 → fs-tools / fs-search 全体缺席，模型少一组工具，系统照跑）；同 id 服务件替换走 D-048 确认卡，实现全体跟着换；
- **引擎代码依赖（D-048）**：`engine/` = 标准 Node 包目录，零依赖单文件，或有依赖 `package.json` + `node_modules` 皆合法；安装 = AI 经 shell 工具跑 `pnpm install`（走既有审批链，用户看得见命令），装载器零安装机器；`pnpm-lock.yaml` 随 `engine/` 走。**分发 / 备份不带 node_modules**——它是可再生的运行件而非数据（package.json + lockfile 照单重建），且原生二进制跨平台拷贝会坏；到场由 AI 照 lockfile 重装一次即复原，缺依赖装载失败 = 标损坏 + 告警 + 同 id 替换场景自动回落官方（四闸既有规则），AI 即安装器。**硬规矩：`@henira/kernel` / `@henira/protocol` 不进依赖表**——一个 harness 只能有一个内核实例，自带副本必炸；宿主经 import map 注入唯一实例（与 `ui/` 的 react、D-043 官方界面件出口同一口子）。

**插件状态模型（2026-11-19 定稿，管理面与 `GET /api/plugins` 同一口径）**：

| 状态               | 含义           | 进入条件 / 转移                                                                                                       |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `installed`        | 版本目录在盘上 | 目录存在（清单合法才继续）                                                                                            |
| `enabled`          | 用户选择启用   | `settings.plugins.<id>.enabled` 缺 key 或 true；**只是保存的选择，不表示加载成功**                                    |
| `awaiting-confirm` | 引擎件等确认卡 | 带 `engine/` 且 `confirmedVersion` ≠ 当前版本                                                                         |
| `loaded`           | 本会话装配成功 | harness `.use()` 成功（引擎件）/ UI 模块 `apply()` 成功（界面件）                                                     |
| `failed`           | 装载失败       | `reason` ∈ 清单坏 / 入口坏 / 依赖缺 / inject 无提供者 / 版本不符 / 同槽冲突 / 运行崩溃——**跳过该件 + 告警，其余照常** |
| `replaced`         | 用户包替换官方 | 同 id + `engine/` 经确认卡生效；官方案显示"已被用户插件替换（来源 + 版本）"                                           |

**enabled ≠ loaded**：开关只记"想不想用"，管理面另列装载状态与失败原因；停用不影响已装文件（卸载才是删目录）。

## 6. AI 创建、更新与管理

### 6.1 创建

- **唯一用户侧来源 = AI 创建**：AI 照本规范用文件工具写 `~/.henira/plugins/<id>/<版本>/`，落盘后**新会话生效**（技能文件另可从 `.agents/skills` 只读发现，D-020，不算插件来源）；
- 内容包 = 素材槽位 + 可选代码槽（`ui/` 界面模块、`engine/` 引擎模块，见 §4）；带 `engine/` 时首次生效前管理面弹确认卡（D-048）；
- 创建载体 = 本文档（规范）+ 官方创建技能（随 `plugin-skills` 包以随包技能发布，D-026）；
- 设置页不提供市场 / zip / 外部目录导入入口（D-019）；"安装"就是 AI 创建版本目录（D-029）。

### 6.2 更新

- 写**新版本目录**（版本级不可变，D-024）；旧版本保留可回滚；
- `settings.json plugins.<id>.version` 可钉版本，缺省取最高版本；
- 运行中的会话不变，新会话生效；UI 模块需新会话或整页刷新（见 §4"更新生效"）。

### 6.3 创建技能的内容要求

创建技能不是字段表，至少包含：

- **五步流程**：认输入 → 规划槽位 + 形态确认 → 直接创建 → 自检 → 自测；
- **三档澄清**：强信号直接映射（零提问）；偏好型歧义合成一问问全（禁止拆成多轮、禁止甩完整矩阵）；私有参数（服务器地址 / token / 测点）必问，不许编占位；
- **自测**：必须实际看到 UI（浏览器打开 / 截图），静态检查不算交付；没验证过就宣称"已可用" = 没交付；
- **交付话术**：给 3~5 句"你可以直接对我说……"，不贴目录结构；
- **源码随包（UI 件）**：界面件源码放 `ui/src/`，构建产物进 `ui/` 根；需要第三方库时 AI 自己 `pnpm add` + 构建打包（一条命令，走审批链）；更新插件时源码随版本目录一起拷走——源码永远在手边、与产物同版本；
- **安全告知**：创建 hooks / mcp 时说明事件、命令、连接目标与权限（D-030）。
- **引擎件交代（D-048）**：创建带 `engine/` 的包必须说明——它注册了什么（工具 / 槽位 / 事件）、是否替换官方插件（替换谁）、依赖了哪些第三方包；确认卡出现之前，用户应已从对话里知道这些。
- **引擎件用服务（D-049）**：需要文件 / shell / 任务等能力时优先 `inject` 官方服务（路径围栏、目录规矩、读窗口全部白得），别裸写 Node 实现重复造轮；官方没有的能力自己写合法——写成服务还能给别人注入（ServiceDefinition 同权）。

### 6.4 插件管理面（D-029）

- **没有"安装"按钮**：安装 = AI 创建版本目录（D-017 / D-029）；管理面只做已存在插件的列表 / 详情 / 版本 / 启停 / 卸载 / 数据区，不提供市场 / zip / 外部目录导入；
- **列表 / 详情**：id、名称、版本、启用状态、**装载状态（`loaded` / `failed{原因}` / `awaiting-confirm` / `replaced`，见 §5 状态模型）**、槽位清单、失败原因；hooks 的 `event` / 命令、mcp 的连接目标必须在详情可见；坏插件不挡启动，但列表可见告警；
- **启用 / 停用**：`settings.json plugins.<id>.enabled`（缺 key = 启用）；
- **版本**：列出已装版本与当前生效版本，可切换（只影响新会话）；
- **卸载**：删除 `plugins/<id>/`；默认保留 `plugins-data/<id>/`，显式勾选才删；
- **数据区**：显示占用，可单独删除；删除需二次确认；
- **边界**：只操作 `~/.henira/plugins/` 与 `~/.henira/plugins-data/`（项目级同理），拒绝路径穿越；不做市场 / 导入（D-019）。
- **引擎件确认卡与"被替换"显示（D-048）**：带 `engine/` 的包首次生效（及版本升级）前，管理面弹确认卡——写明替换谁、代码路径、依赖数，确认才装载、拒绝则官方照常；官方插件行被用户件顶替后显示"**已被用户插件替换（来源 + 版本）**"，与坏插件告警同栏可见。

## 7. 同名覆盖与宿主槽位（定稿）

### 7.1 同名覆盖（D-032）

统一链（所有具名内容）：

1. **项目独立定义**（项目 `.agents/skills`、项目 `.henira/agents`）
2. **项目插件槽位**（项目 `.henira/plugins/*`）
3. **用户独立定义**（`~/.agents/skills`、`~/.henira/agents`）
4. **用户插件槽位**（`~/.henira/plugins/*`）
5. **官方随包**（官方 npm 包内的 skills / commands / agents）

| 类别     | 顺序                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 技能     | 项目 `.agents` > 项目插件 > 用户 `.agents` > 用户插件 > 官方随包                                                                                                                     |
| 命令     | 项目插件 > 用户插件 > 官方随包（没有独立命令根）                                                                                                                                     |
| 子代理   | 项目 `.henira/agents` > 项目插件 > 用户 `~/.henira/agents` > 用户插件 > 官方随包                                                                                                     |
| 同名插件 | 项目内容包 > 用户内容包；内容包 id 撞官方插件 id：纯内容包 → 跳过 + 告警（官方 id 保留），**带 `engine/` → 经确认卡替换官方**（D-048，项目 > 用户 > 官方 npm）；同 id 多版本按 D-024 |

- **同层多插件同名**：按插件 id 字典序，靠前者赢，并告警；要覆盖就改 id / 名字；
- 同名比较**不区分大小写**（与 Windows 文件系统一致）。

### 7.2 宿主槽位词表（D-033）

- **v1 十个（D-057 行级四缝 ＋ D-062 结构性 / 右栏 tab / 词表正名，2026-11-18）**：结构性一个 `layout`（整页框架槽——官方框架件默认占用并在同一注册里声明子槽，`replaceSlot` = 整页重排，风险标注见 §4）＋ 区域级四个 `sidebar`（左栏）/ `conversation`（中柱）/ `composer`（输入区）/ `sidebar.right`（右栏，官方默认件 = tab 框架）＋ 行级五个 `tool.call.view.<工具名>` / `conversation.images` / `turn.tail` / `sidebar.right.tab`（右栏 tab 追加位）/ `sidebar.right.preview.<扩展名>`（语义见 §4 挂载点词表）；
- **共享核心三条**：`turn.tail`、`conversation.images`、`tool.call.view.*` 在所有 web 系宿主（桌面 / 手机网页 / 云网页）语义一致；
- **桌面 web 宿主词表七个**：`layout`、四个区域级、两个 `sidebar.right.*`（tab / preview）仅桌面 Web；移动端单栏没有多栏框架与右侧栏，不得硬造等价物；
- **移动端词表等移动 UI 设计时再定**：可复用共享核心，具体名字（如 `mobile.sheet` / `mobile.drawer`）按真实布局定；
- **桌面扩展按需加**：`titlebar` / `session.bottom` 等只在真实插件需要时逐个加；每次都是 Web 宿主的 UI 改动，不动内核；结构性槽逐个拍板入表、不预造矩阵（D-033 第 1 条修订随 D-062）；
- **未知槽位**：属于别的宿主词表的槽位 → 静默忽略；完全未知 → 告警并忽略；插件继续加载。
- **官方界面件槽名 = 词表名（D-062 收敛）**：M3 落码即以宿主三名（`sidebar` / `conversation` / `composer`）为官方件槽名，D-062 起文档词表与宿主接受集同源——D-043 原"槽名随 M3 定、两套并存"条款就此收敛为一套。

## 8. 与官方插件的关系

- 官方 22 个是 npm 包（按族分包：服务件 + 工具件，D-049 / D-058；清单见 [packages.md](./packages.md)），不经版本目录分发，不进 `plugins/` 目录；官方包内的 `skills/` / `commands/` / `agents/` 作为**随包内容**被对应读者扫到（最低优先级，D-026 / D-032）；
- 读者插件（skills / mcp / hooks / commands）按本规范认领槽位目录；将来替换某个读者，也按同一规范认领——**格式稳定，读者可换**（P8）；
- 读者互相独立：一个包可以同时带四类槽位，也可以只带一类（"有啥放啥、各放任意多个"）。
