# 决策记录（ADR）

> **只追加，不改写。** 推翻旧决策时新增一条，并在新条目里链接被推翻的条号。
> 每条含：状态、日期、决定、理由。日期格式 YYYY-MM-DD。

---

## D-001 项目名：Reins

- **状态**：已定 · 2026-11-11
- **决定**：项目名 **Reins**（缰绳）；npm scope `@reins/*`；CLI 命令 `reins`。
- **理由**：缰绳是"驾驭"的本义词，贴合"内核驾驭语义 + 治理"定位；短、易读、重名少。

## D-002 代码仓库位置

- **状态**：已定 · 2026-11-11
- **决定**：仓库 = 本仓库（当前工作区）。目录名与项目名**无需同步**，不影响任何设计；公开发布时仓库名用项目名 Reins。
- **理由**：讨论与实施在同一目录进行，避免反复切换；目录名是本地习惯，不进任何公开制品。

## D-003 技术栈

- **状态**：已定 · 2026-11-11
- **决定**：TypeScript + **Node.js ≥ 20**，ESM；包管理 **pnpm workspaces**。
- **理由**：作者最熟悉的技术路线；Node 优先、兼容 Bun；开源用户基数最大、部署最广。

## D-004 实现独立：零代码复用，借鉴仅限公开来源

- **状态**：已定 · 2026-11-11（2026-11-14 表述修订，见 D-047）
- **决定**：**所有实现从零写，不复用任何现成代码与资产**；借鉴仅限**公开仓库与公开资料**（dsh / ZCode / OpenCode 等公开仓库，file:line 均可公开对证；闭源产品如 Claude Code 仅行为层参考）。工程教训以无主语的设计理由落笔——公开文档中的一切引用均可公开对证。
- **理由**：避免知识产权与品牌纠缠；公开来源可审计、可引用，项目身份干净。这是本项目的硬约束。

## D-005 架构哲学：内核最小化，插件即一切

- **状态**：已定 · 2026-11-11
- **决定**："必须做的"进内核——kernel / protocol / session / llm / tools / approval / loop 七个核心包；其余能力一律插件化（官方插件与社区插件同权）。细则见 [20-architecture/principles.md](./20-architecture/principles.md) P7/P8。
- **理由**：项目所有者的明确表述："需要我们必须要做的我们做，能插件实现的，我们或者其他人可以使用插件去处理。目的不是占生态位，而是做自己的。"
- **后续修订**：D-010 将其中五个语义包（session / llm / tools / approval / loop）改列官方语义插件（进 `plugins/`），内核只留 kernel / protocol；目录布局见 D-012③。

## D-006 v1 首发范围

- **状态**：已定 · 2026-11-11
- **决定**：**SDK + CLI + Web UI** 一次性首发；TUI 不在 v1。
- **理由**：框架需要真实宿主自证可用；Web UI 同时演示审批（挂起/重放）等交互语义。
- **后续修订**：D-018 将 CLI 移出 v1（SDK + Web 不变，黑窗口聊天发布后启做）。

## D-007 LLM 层策略：自定契约 + AI SDK 默认适配

- **状态**：已定 · 2026-11-11
- **决定**：自定义 `StreamEvent` 契约（封闭判别联合 + 不变量写进接口注释）；默认适配器基于 **Vercel AI SDK 的 provider 层**（`streamText` + `stopWhen: stepCountIs(1)`，循环归我们自己的 loop 管）；接口缝保留，可随时换自写适配器。
- **理由**：40+ provider 免费获得；契约自持，不被 AI SDK 的上层抽象绑架。风险对策：只依赖其 provider 层并锁 minor 版本。
- **后续修订**：D-040 钉死不自研、不自建厂商表，并定模型参数字典 = models.dev（配置层同步）。

## D-008 许可证：MIT

- **状态**：已定 · 2026-11-11 · 2026-11-15 项目所有者改定 MIT
- **决定**：MIT。
- **理由**：个人开源项目主流默认、单文件零仪式；Apache-2.0 的专利条款与 NOTICE 仪式对公司背景项目才有分量。依赖不受影响（AI SDK 为 Apache-2.0，MIT 项目装载合规，第三方声明带对方许可文本即可）。

## D-009 文档体系

- **状态**：已定 · 2026-11-11
- **决定**：`docs/` 目录 + `INDEX.md` 总索引；文件名英文 slug、**内容中文先行**（开源发布时补英文版）；架构文件分 principles / packages / session / tools-approval / loop / interfaces 六份。
- **理由**：讨论与实施同目录进行，文档先行；总索引保证任何文件都可从入口两跳到达。

## D-010 架构形态：机制内核 + 一切皆插件（含官方语义包）

- **状态**：已定 · 2026-11-11
- **决定**：内核只保留**机制层**——kernel（服务槽位、依赖装配、事件总线、可逆卸载）与 protocol（槽位接口、事件词表、DTO）。会话 / 模型适配 / 工具管线 / 审批 / agent 循环全部是**官方语义插件**，与社区插件走同一条注册路径、同权、无特权 API；**任何官方插件（包括 loop 与 approval）都可以被第三方实现整包替换**。
- **理由**：项目所有者明确选择 dsh 式"一切可换"——与 D-005 哲学（"能插件实现的就插件处理"）完全自洽，字面上无例外；生态上限高（社区可换 loop / 审批 / 存储后端），框架从"产品"升格为"平台"。
- **被放弃的方案**（防止重议）：**"语义内核 + 只增不改"**——五件语义锁进内核，插件只能增不能换。放弃理由：① 换语义的自由是平台价值的核心，锁死即失去；② 治理关切不需要宪法级锁死也可达成——官方默认实现 + 预设默认装载 + 文档责任声明；③ dsh 生态证明"配置级替换"形态可行。
- **配套取舍**：**不做 conformance 守护套件**（YAGNI——开源软件用户自主下载自主组装，责任本属组装者；dsh 亦不做；"劣质插件砸牌子"是为不存在的生态预支焦虑）。守护降为三件轻的事：官方默认实现安全且为预设默认；文档声明"预设是安全默认，换件自担"；Decision 词表留在 protocol（契约类型仍在，无强制测试）。第三方语义插件生态真正出现后再评估是否补套件。

## D-011 装配机制：TS API（开发者）+ reins.config.ts（最终用户），无 YAML patch

- **状态**：已定 · 2026-11-11
- **决定**：
  1. 开发者装配面 = TS API：`createHarness().use(sessionPlugin).use(loopPlugin)…`；
  2. 最终用户装配面 = 项目根目录 `reins.config.ts`（`defineConfig` 声明插件清单与模型配置），官方 CLI / Web 启动时读取并翻译成 TS API 调用；读取器为独立小包 `@reins/config-loader`（宿主层共享，不进 kernel）；
  3. **不造 YAML patch 机器**（解析器 / row-id 寻址 / 分层合并 / 表达式 loader / 校验器）。
- **理由**：YAML 各短板的解法（校验器、表达式语言、schema 报错）全部是**必须前置购置**的机器零件，dsh 由 350 包生态与 4 profile 产品矩阵分摊成本，Reins v1 无此分摊——零件全造、产品不多一个功能；TS 的短板（跨语言、热改、多 profile）的解法全部**可以后置分期**。判断标准：**为已存在的需求造机器，不为想象中的需求造机器**。AI 时代附加理由：TS 装配有 tsc 机械反馈闭环，AI 改配置可验证；YAML 只能运行时炸了才知道。
- **重开条件（后门）**：当且仅当出现 ① 跨语言 SDK 共享装配、② 多 profile 产品线、③ 运行中热改配置 三者之一时，在 TS API **之上**加 patch 翻译层（读配置 → 调 TS API），不推翻任何既有物。

## D-012 落地细节四条

- **状态**：已定 · 2026-11-11
- ① **事件模式定为 4 种**：`emit` / `serial` / `waterfall` / **`bail`**（顺序执行，listener 返回反对即停，总线返回反对者与理由——供"回合将结束"等否决场景：熔断续跑、排队消费）。不用"serial 约定返回值"方案：隐式契约易静默失效。
- ② **槽位接口归 protocol**（LoopService / ApprovalService / SessionService 等接口定义与事件词表同层）；kernel 保持纯机制，不知道任何具体业务接口。
- ③ **目录布局**：`packages/` 只放 kernel、protocol 与宿主（config-loader / server / sdk / cli / web）；**全部官方插件进 `plugins/`**（语义 5：session / llm / tools / approval / loop；能力 5：fs / shell / fetch / compaction / subagent）——位置即文档，宣告"无特权路径"。
- ④ **凭据硬拒等安全默认清单由官方 approval 插件承担**（kernel 纯机制不承载业务策略），官方预设默认装载之。
- **后续修订**：D-035 在第 ③ 条宿主层清单中增补 `desktop`（Electron 薄壳宿主，中远期）。

## D-013 可替换性自检：补两个槽位、立两条规则、处置 bail

- **状态**：已定 · 2026-11-11
- **背景**：三路实证（dsh 等公开仓库源码 + 成熟实现的运行形态）后，对 D-010/D-012 做一次"可替换性自检"。自检方法只有一句：**对每个官方插件问"第三方只用 kernel + protocol，能不能重写它？"**
- **自检结论**：
  - 理念成立——dsh 源码里 session / agent-loop / tools / approval 全是普通 package，内核只有机制，无特权 core；"一切可换"是能跑的结构，不是口号。
  - 当前设计有三处使"同权"名不副实：审批没有把问题送到用户面前的公共通道；模型/审批没有公共配置面；protocol 缺最小化约束。另外 `bail` 当时的理由抄自对 dsh 的误读（dsh 实际用 serial + inbox 注入），需要重新给理由或删除。
- **决定**：
  1. **新增 `InteractionService` 槽位**（protocol）：把"把审批/提问送到用户面前并等待答复"从 approval 插件剥离为宿主能力。approval 只做判定链与 fail-closed；弹卡、收答、断线重放由 `InteractionService` 承担，CLI / Web / 测试各自实现。缺失实现 = 无回答者 = `unavailable`（fail-closed 不变）。
  2. **新增 `ConfigService` 槽位**（protocol）：模型能力字段、凭据、插件自有配置段的只读访问面，由宿主（config-loader / CLI / Web）实现。llm 与 approval **不得直接读环境变量或文件**；凭据值不得进入事件、日志、模型上下文。
  3. **protocol 最小化规则**：protocol 只放"两个插件必须达成一致的东西"——槽位接口、事件信封与词表、跨插件 DTO；不放便利类型、不放单插件内部类型、不放产品概念。新增 protocol 类型先回答"谁和谁必须一致？"，答不出就不进。防止"唯一不可换层"膨胀成新巨石。
  4. **替换者责任清单 6 条**写入 principles.md **P8**：替换官方语义插件者必须自行保证这些语义。清单是"安全默认"的实质内容，不是建议；仍不做 conformance 套件（D-010 配套取舍不变）。
  5. **`bail` 保留，但换理由**：真实用户是**官方熔断插件**——在 `loop/turn-stopping` 否决回合结束并注入续跑提示。这是我们自己的需求（P6），不是对齐 dsh；dsh 的 serial + 持久化 inbox 注入实现我们不采用（不引入持久化 inbox 投影）。
- **理由**：可替换性不是文档声明，而是"第三方能只靠公开契约重写"这一可检验属性。缺 Interaction / Config 两个槽位时，第三方换 approval 或 llm 只能走宿主私有通道，"同权"当场破功；没有 protocol 最小化规则时，唯一不可换层会随每个插件需求膨胀，最终无人能换。
- **被放弃的方案**：**删除 bail 降为 3 模式**——放弃理由：熔断是 v1 官方插件的真实需求，删除后只能把熔断硬编码进 loop，直接违反 D-010（语义责任应在插件）。
- **备注**：本次只补可替换性缺口，不改数据模型与事件词表；实证结论另议。

## D-014 运行数据目录：两层结构 + 项目 key + 检查点平行树

- **状态**：已定 · 2026-11-11
- **决定**：
  1. **两层结构**：全局 `~/.reins/`（`REINS_HOME` 可覆盖）放配置、工作区注册表、**所有项目的运行数据**、插件、全局记忆/代理、状态、日志、缓存；项目内 `<repo>/.reins/` **只放本项目的定义**（项目级 agents / plugins / plugins-data），随仓库走、可提交 git。**会话数据不放项目内**。
  2. **项目目录 key = `--<slug60>-<hash8>--`**：slug 可读、截断 60 字符；hash8 平台感知（Windows 先转小写，POSIX 保留大小写）；唯一性由 `projects.json` 的 `id`（`sha256(canonical cwd)` 前 16 位）保证，目录名只给人看、查找不靠它。解决分隔符/连字符碰撞、大小写碰撞、超长路径三个问题。
  3. **`projects.json` 常驻全局根**，是权威工作区列表，并能从 `projects/<key>/sessions/*` 的 `cwd` 自愈；项目目录内不再放 `project.json`（与注册表和会话头重复）。
  4. **检查点保持平行树** `checkpoints/<key>/`：内容寻址、跨会话去重、可单独 GC / 备份；删除项目时用一条命令同时删 `projects/<key>` 与 `checkpoints/<key>`。
  5. **可变性分层**：会话日志只追加；`meta.json` 可改（原子重写）；`state/` 常变；`cache/` 可随时删；凭据独立 `config/credentials.json`（0600），不进事件 / meta / 日志 / 模型上下文。
- **理由**：公开实现的存储层对照（Claude Code 的 per-cwd 项目目录、OpenCode 全局 + 项目分家、dsh 会话存储）+ 命名碰撞与长度分析。核心判断：运行数据与项目定义生命周期不同，必须分家；能改的东西不进只追加的文件。
- **被放弃的方案**：① **纯 slug**——分隔符/连字符与大小写会静默撞目录，两个项目的会话混在一起；② **slug + hash 不截断**——碰撞解决了，超长路径仍在；③ **检查点合并进项目目录**——失去独立 GC 与单独备份能力；④ **项目内 `project.json`**——与 `projects.json` 和会话头重复，只会漂移。
- **备注**：完整目录树、写者/生命周期表、删除语义见 [20-architecture/data-directory.md](./20-architecture/data-directory.md)。

## D-015 配置面：两文件 + 默认预设归 config-loader

- **状态**：已定 · 2026-11-12
- **决定**：
  1. **官方默认预设从 `@reins/config-loader` 导出**（`defaultPreset`）：无 `reins.config.ts` 时即用它；想基于默认改 = TS 里 import 后 spread，**不设 add/remove 补丁语法**（与 D-011"无 YAML patch"同源：TS 代码本身就是补丁机制）。
  2. **配置两文件、各司其职**：
     - 全局 `~/.reins/config/settings.json`——**界面上点出来的**，程序写、不进 git：`model`（默认模型）、`plugins`（`<id>: { enabled?, version?, options? }`，缺 key = 启用 + 最高版本 + 默认参数）、`ui`（主题等界面偏好）；
     - 项目 `reins.config.ts`——**开发者手写**，进 git，普通用户不碰：`model` / `plugins`（基础清单）/ `options`（本项目插件参数）。
  3. `ReinsConfig` 三字段定稿（model / plugins / options），同一项两边都写时**听项目的**（与"项目级覆盖用户级"同规）。
- **理由**：界面上点出来的设置必须程序原子写，手写代码文件程序改不了——所以"界面面"必须落 JSON；而"官方与社区同权"的清单必须有单一出口，放 config-loader 使宿主永不抄错。权限、密钥继续留在各自文件（permissions.json / credentials.json），`reins.config.ts` 进 git 故不得含机器私有数据。
- **修订**：D-011 中"最终用户装配面 = reins.config.ts"的表述收窄为"开发者装配面"；最终用户面 = 界面 + settings.json（本条 D-015）。

## D-016 插件启用与装配：装了就生效 + settings.json 开关

- **状态**：已定 · 2026-11-12
- **决定**：
  1. 插件放进已装目录（`~/.reins/plugins/` 或项目 `.reins/plugins/`）即生效，不要求写进任何清单；
  2. **装配三步**（每个新会话执行）：①基础清单 = 项目 `reins.config.ts` 写了 `plugins` 听它的，否则官方默认预设；②加上已装目录里的插件（同 id 不重复算，同名项目盖用户级）；③去掉 settings.json 里 `enabled: false` 的；
  3. 开关**对新会话立即生效**（不重启服务）；运行中的会话不变，关掉重开才变——内核规则"start 后不可加减插件"决定的最小粒度；
  4. **官方替换 = 显式写清单**（reins.config.ts 不列官方、列自己的）；不做"扔目录自动顶替"；settings.json 开关只能关、不能换；
  5. 内圈 5 槽位（session / llm / tools / approval / loop）不提供开关。
- **理由**："装了即用 + 界面开关"是经过大规模插件量验证的用户模型；有市场（AI 创建入口）却要求装完手改代码文件，入口等于白设。"自动顶替"被否：装载器隐规则使引擎部件可被静默换掉，排查多一层魔法；内核同槽位报错 + 开关过滤已足够。
- **理由（生效粒度）**：装配一次性发生、服务对象被他人持有，半路拔插件等于悬空引用；"请求级生效"依赖"插件从不进引擎"的架构（读者类焊死在宿主侧），Reins 的插件真装进引擎，粒度天然是"会话"。
- **后续修订**：D-030 为 MCP 槽增加"首次连接 / 定义变更需管理面确认"的例外——插件启用状态不变，但 MCP server 不自动连接、工具不自动进注册表；**D-043** 将"不给关"装配机制延伸到官方界面件 `plugin-web-ui`（不给关、不提供版本钉）；**D-048** 将第 4 条"不做目录自动顶替"收窄为"不做**静默**顶替"——同 id 且带 `engine/` 引擎槽的用户包，经确认卡显式确认后可替换官方插件。

## D-017 插件格式与来源：开放目录 + 无第三方 + AI 创建

- **状态**：已定 · 2026-11-12
- **决定**：
  1. **版本目录 = 清单 + `index.js` + 开放内容目录**：`plugin.json`（name 必填 = 目录名；缺省救缺失、写错丢整段；坏清单跳过并告警）；`index.js` 为约定代码入口（纯内容包可无）；内容目录开放集合——skills / commands / hooks / mcp / agents / ui 存在即生效，各读者插件认领自己那类，**没人认领的目录装载器永远不碰**；自由区（assets / docs / 构建产物）归插件自用。
  2. **依赖 = 发布时单文件打包**（esbuild 套路）；不做 node_modules 随目录、不禁第三方库。
  3. **不做第三方分发、不做生态兼容**：无市场（marketplaces / markets.json 不建）、无外部工具同步、不认别家格式（`.mcp.json` / 聚合 hooks.json / `${CLAUDE_PLUGIN_ROOT}` 类变量 / agentskills.io 字段对齐 / codex-toml）。安装/暂存/zip 管线不做。
  4. **唯一用户侧来源 = AI 自己创建**：AI 照《插件规范》（plugins.md）用文件工具写 `~/.reins/plugins/<id>/<版本>/`，纯内容包（槽位 + ui，无 index.js），**新会话生效**；产品自带能力走 npm（官方 15 个）。
  5. 术语定名**"界面 UI"**（不用"面板/panel"）：插件可携带网页宿主渲染的界面，挂载点由网页界面边界（M4 前置）定。
- **理由**：目标用户的插件只有两个来源——产品自带与 AI 现场创建；市场、同步、兼容层的全部复杂度服务的是不存在的第三方生态。"开放目录 + 读者认领"使新增机制零改格式；单文件打包把审查面收敛到一个文件（esbuild 打包工具链的通行做法）。
- **备注**：插件机制全文见 [20-architecture/plugins.md](./20-architecture/plugins.md)；同名覆盖统一口径与 AI 更新语义在该文档待定项中收口。
- **修订**：第 3 点"不做生态兼容"被 **D-019** 收窄；第 4 点"纯内容包"被 **D-021** 补充（`ui/` 可带界面模块）；"唯一用户侧来源"被 **D-020** 收窄为"**插件**的唯一用户侧来源"；官方插件总数 15 → 16 见 **D-043**（增官方界面包 `plugin-web-ui`）；第 2 点"依赖单文件打包、不做 node_modules 随目录"与第 4 点"`ui/` 是唯一代码口子"被 **D-048** 修订——新增 `engine/` 引擎代码槽位（标准 Node 包目录，可带 package.json + node_modules，AI 自己 `pnpm install` 走审批链）。

## D-018 排期甲：官方插件 15 个全进 M4；里程碑调整

- **状态**：已定 · 2026-11-12
- **决定**：
  1. 官方插件 **11 → 15**：+ `plugin-skills`（技能读者）/ `plugin-mcp`（MCP 读者）/ `plugin-hooks`（钩子读者）/ `plugin-commands`（命令收集），全部排进 **M4（v0.1 首发）**；界面 UI 是网页宿主扩展点，不占插件名额；
  2. **"网页界面 v1 边界"升级为 M4 前置**（界面 UI 挂载点、命令进输入框、设置页范围）；定稿前 M4 的 UI 与命令部分不动工；
  3. **黑窗口聊天（cli 包）移出当前里程碑，推迟到发布后**（启动服务的命令保留）；M3 多客户端演示改用两个网页。
- **理由**：技能 / MCP / 钩子 / 命令是目标用户（AI 创建插件、日常使用）的 day-1 价值，v0.1 缺它们等于缺"可用"；无生态兼容负担后四个读者实现量可控。
- **修订**：D-006"SDK + CLI + Web UI 一次性首发"中 **CLI 移出 v1**（SDK + Web 不变，黑窗口发布后启做）；D-012③ 宿主列表中 cli 相应标注发布后。
- **备注**：里程碑判据更新见 [40-roadmap.md](./40-roadmap.md) M3/M4。
- **后续修订**：D-035 / D-036 在发布后 backlog 增补两项——桌面 Electron 宿主（A1）与 `examples/cloud` 云端部署样例；`reins serve` 保留不变。
- **后续修订**：**D-041** 将第 1 条改为分三批随版本发布——M4 首发批（引擎 5＋fs＋shell）/ M5（fetch / compaction / subagent / tasks）/ M6（读者 4）；第 2、3 条不变。

## D-019 生态兼容澄清：不做导入管线，格式采用行业标准（修订 D-017）

- **状态**：已定 · 2026-11-12
- **背景**：D-017 里"不做第三方、不做生态兼容"收得过紧，不是项目所有者的本意。澄清（经复述确认）：**界面不提供导入入口、后台也不扫描别家目录规整成我们的插件；但我们的格式采用市面上的通用标准，市面上现成的 MCP server、标准 skill、生态常见写法拿来就能用。**类比：不做搬运工，插座是标准插座。
- **决定**：
  1. **仍然不做**：外部工具同步管线（多来源导入）、UI 导入入口、市场货架机器（github / git / 本地货架 + zip 暂存安装）——"用市面上的东西" = 把标准格式的东西放进插件目录，不需要上架/搬运机器。
  2. **格式兼容（要）**：SKILL.md 对齐 Agent Skills 规范（agentskills.io）；MCP 走标准协议（stdio / HTTP / SSE，plugin-mcp 本来如此）；钩子读者兼认生态聚合 `hooks.json` 写法；模板变量兼认 `${CLAUDE_PLUGIN_ROOT}` / `${ZCODE_PLUGIN_ROOT}`（= REINS_PLUGIN_ROOT）与 `${CLAUDE_PROJECT_DIR}` 等（= REINS_PROJECT_DIR）。
  3. MCP 基础已在 M4（plugin-mcp）；ACP 等其余协议接入放发布后 backlog。
- **理由**："市面上现成的东西拿来就能用"靠**格式即标准**达成，不靠搬运管线；搬运 / 上架机器的全部复杂度服务的是我们不提供的第三方分发与导入。
- **修订**：D-017 第 3 点"不做生态兼容"收窄为"不做导入 / 同步管线与市场机器"；其余（版本目录格式、单文件打包、AI 创建）不变。

## D-020 技能来源补口：只读扫描 `.agents/skills`（修订 D-017 第 4 点边界）

- **状态**：已定 · 2026-11-12
- **决定**：
  1. 技能读者除已装插件包的 `skills/` 外，**只读**扫描两个外部目录：项目 `<repo>/.agents/skills/` 与用户 `~/.agents/skills/`；形态限 agentskills.io 标准目录包 `<name>/SKILL.md`（不递归任意层级）；
  2. **优先级四级**：项目插件 `skills/` > 项目 `.agents/skills` > 用户插件 `skills/` > 用户 `~/.agents/skills`；同名时高层级赢；
  3. **只读三不**：不创建目录、不复制 / 迁移文件、不登记为插件（不进 `~/.reins/plugins/`、无 `plugin.json`、无开关）；目录不存在 = 没有；外部技能的"开关"就是文件本身；
  4. **不新造** `~/.reins/skills/` 与项目 `.reins/skills/` 根。
- **理由**：D-019 承诺"市面现成 skill 直接可用"，而市面 skill 的标准落点就是 `.agents/skills`（dsh 按 rank 200 / 500 读它，ZCode 亦用同一目录）；只读扫描是兑现承诺的最小改动。不新造自家根：多一套根 = 多一套冲突裁决与启停语义（无消费者的目录只会制造歧义）。
- **修订**：D-017 第 4 点"唯一用户侧来源 = AI 创建"收窄为"**插件**的唯一用户侧来源"；技能文件可来自标准外部目录（只读）。D-019"格式即标准"因此落到技能这一类上。
- **后续修订**：D-032 将技能优先级调整为 **项目 `.agents` > 项目插件 > 用户 `.agents` > 用户插件 > 官方随包**（同层显式文件优先）；本 ADR 的其余内容不变。
- **备注**：格式与优先级全文见 [plugins.md](./20-architecture/plugins.md) §4；数据目录视角见 [data-directory.md](./20-architecture/data-directory.md) §1 外部只读说明。

## D-021 界面 UI 形态：ESM 模块 + 类型化挂载点（不 eval）

- **状态**：已定 · 2026-11-12
- **决定**：
  1. 插件界面 = `<version>/ui/` 下的 **ESM 模块**（清单 `ui.entry` 指定，缺省 `ui/main.js`），导出 `apply(ctx)`；宿主以只读静态路由伺服**该插件的版本目录**（禁路径穿越），网页用 `import()` 加载；
  2. 模块只依赖两类东西：`react`（import map 指到宿主同一份）与同目录相对路径文件；第三方实现库必须自带（随模块打包），宿主不解析 `node_modules`；**禁止** Node API、自带 React、改写应用根节点 / `document.body`、读别的插件的 DOM / 样式；
  3. 宿主门面 v1 只有一个方法：`ctx.registerSlot(name, component, { order? }) → disposer`；插件的样式、监听、定时器全部在 `apply` 内注册、随页面卸载撤销；
  4. v1 挂载点三个：`session.top`（会话页顶部）、`composer.above`（输入框上方）、`sidebar.right`（右侧栏）；名字以 web 实现为准，数量与位置不变；
  5. **不求值源码**：不用 `new Function` / eval / 字符串执行；模块是普通 ESM，加载或渲染失败 = 该插件标损坏并告警，不影响其他插件与宿主；
  6. 安全口径：**同源同权限，不是安全边界**；门面不提供凭据、文件、进程能力；插件来源仍限"用户自己装的 / AI 创建的"。
- **理由**：祖宗（dsh）的 UI 扩展就是"模块 + 类型化 slot"——`dsh.client` 声明 + `lib/client.js` / AI 模板的 `client.js`，经模块装载器物化、`ctx.slots.register` 注册，源码即产物、无构建、无 eval；`new Function` 求值路线则被实践验证为"明确非安全边界"且表达力受限。模块路线保留"AI 直接写、无构建"，同时去掉求值面与门面方法集的维护账。纯声明式表达力不够（倒计时这类有行为的小件做不出来），不取。
- **修订**：D-017 第 4 点"纯内容包（槽位 + ui，无 index.js）"补充边界：**`ui/` 是唯一可带代码的口子**（界面模块，非引擎代码）；其余槽位仍为纯内容。
- **备注**：网页界面 v1 边界余项（命令进输入框、设置页范围）仍在 [50-open.md](./50-open.md) 🟡；契约全文见 [plugins.md](./20-architecture/plugins.md) §4。
- **后续修订**：D-028 把宿主门面从 1 个方法扩为 12 个（`ctx.host`）；D-030 补插件安全基线；D-031 增加可选 `ui.slots` 静态声明（运行时仍为准）。ESM / 不 eval / 三挂载点不变；**D-043** 延伸为槽位模型（增 `replaceSlot` 替换官方默认件）并立宿主标准件出口（import map 与 react 同口子）；**D-048** 新增 `engine/` 引擎代码槽位——"`ui/` 是唯一可带代码的口子"自此不再成立，模块加载 / 不 eval 的规矩对 `engine/` 同样适用。

## D-022 替换粒度：整份清单 + TS 表达式，不设补丁层

- **状态**：已定 · 2026-11-12
- **决定**：
  1. 插件清单只有"整份"一种形态（`cfg.plugins ?? defaultPreset`）；**不加**按 id 覆盖 / 新增行的 patch 语法，也不引入分层 patch 文件；
  2. 常见改法用 TS 表达式：`defaultPreset.filter(...)`（换 / 删）、`[...defaultPreset, mine]`（加）、`defaultPreset.map(...)`（整只替换）；三种写法进 [interfaces.md](./20-architecture/interfaces.md) §config-loader 作范例；
  3. 同一槽位两个插件 = 内核 `use()` 立即报错（D-016 已有），不做"后者静默赢"。
- **理由**：祖宗的 patch 层（bundle → profile → home → `--patch`，按 id 整段替换 + insert）是给 **YAML** 用的——YAML 表达不了 `filter` / `map`，才需要补丁小语言；我们的配置是 TS，补丁能力本来就有。再加 DSL = 两套语义漂移 + 维护税（dsh 为"insert 的行也要能被后续 patch 改"专门修过一次，见其 `vendor/README.md` 本地修改第 11 条）。
- **重开条件**：出现非 TS 配置宿主（桌面端 JSON、跨语言 SDK 共享装配）时，在 TS API 之上加翻译层（同 D-011 后门），不推翻既有物。

## D-023 内核：继续自研微内核，不 vendor cordis

- **状态**：已定 · 2026-11-12
- **决定**：
  1. `kernel` 维持自研（四模式 + 槽位 + `inject` + `effect`，P7 体量目标 < 1000 行），**不 vendor cordis**；
  2. M1 增加"**语义钉子**"测试清单——照 dsh 对 cordis 的 22 条本地补丁中与内核相关的边界写：重入卸载、setup 内注册、pending 时新增 `inject`、waterfall 否决、unloading 时拒绝注册；
  3. **M2 收尾设决策闸门**：若 ① 内核 bug 拖慢引擎闭环，或 ② 出现"会话内热加插件 / 配置热重载"的真实需求，再评估 vendor cordis core（MIT，可换）；否则维持自研。
- **理由**：cordis 的价值大半在 loader / HMR / YAML 配置树——我们 D-011 / D-015 明确不要，vendoring 后要替换掉 loader，剩下的 core 不大；dsh 为这套 vendor 维护 22 条补丁，说明"用别人的也要跟着踩"，而我们的四模式语义已按 cordis 对齐（D-012），换不来产品能力，只换来与 dsh 同形。M1 把上游踩过的坑当测试清单，是零成本拿走它的经验。
- **备注**：研究存档 [30-research/deepseek-harness.md](./30-research/deepseek-harness.md) 增补"插件机制谱系"一节（dsh 2026-09-16 已退役模型侧动态 `define/run`）。

## D-024 插件更新语义：写新版本目录（结掉 plugins §6 待定）

- **状态**：已定 · 2026-11-12
- **决定**：已装插件更新 = **写新的版本目录**（版本号自增），不覆盖旧版本；`settings.json` 的 `plugins.<id>.version` 可钉版本，缺省取最高版本；旧版本保留、可回滚。AI 创建与更新走同一套规则。
- **理由**：与 D-017"版本级不可变"自洽；覆盖同一版本会让钉版本、回滚、内容缓存全部失真。"单版本目录覆盖写"的实践是不够好的妥协，不搬。
- **备注**：plugins.md §2 / §6；data-directory.md §2 / §5。

## D-025 新增 `commands` 槽位（protocol）

- **状态**：已定 · 2026-11-12
- **背景**：D-018 把 `plugin-commands` 排进 M4，但 protocol 里没有命令投递通道——"经宿主喂给输入框"没有接口，该插件无法按 P8 同权实现。
- **决定**：protocol 新增 `CommandService` 槽位，由官方 `plugin-commands` 实现并占用：
  - `list(): Promise<CommandInfo[]>`（`name` / `description` / `argumentHint?` / `source`）；
  - `expand(name, args): Promise<string>`（替换 `$ARGUMENTS`，返回待发送文本）。
    宿主（web / server）消费：把展开后的文本放进输入框（是否直接发送由宿主决定）；命令收集范围 = 本会话可见的已装插件 `commands/`。
- **理由**：命令是"人发起、不经模型轮次"的能力（dsh 的 `CommandDefinition` 同理），不是工具；放进一个槽位保持"官方插件同权"，避免宿主直接扫目录绕过 P8。新增槽位按 packages.md 规则 6 立 ADR。
- **备注**：interfaces.md `SlotMap` / `CommandService`；packages.md `plugin-commands` 与"槽位实现归属"；plugins.md §4。

## D-026 官方随包技能：创建技能有家（修订 D-020）

- **状态**：已定 · 2026-11-12
- **背景**：D-017 说创建载体 = 《插件规范》+ 官方创建技能，但 15 个官方包里没有承载它的包；技能读者只扫已装版本目录与 `.agents/skills`，官方 npm 包不在扫描范围。
- **决定**：技能来源增加第五级 **官方随包技能**——官方 npm 包内的 `skills/` 目录（**最低优先级**；由 config-loader 导出随包技能目录清单，plugin-skills 按清单扫）；创建技能随 `plugin-skills` 包发布。
- **理由**：创建技能是产品自带内容，既不该进用户版本目录，也不该让用户手放到 `.agents`；dsh 的 bundled skill 也是这个位置与优先级。最低优先级保证项目 / 用户内容永远能覆盖它。
- **修订**：D-020 的四级优先级扩为五级：项目插件 > 项目 `.agents/skills` > 用户插件 > 用户 `~/.agents/skills` > 官方随包。
- **后续修订**：D-032 对调前两级与中间两级，最终顺序为 **项目 `.agents` > 项目插件 > 用户 `.agents` > 用户插件 > 官方随包**；"官方最低"不变。
- **备注**：plugins.md §4 / §6 / §7；packages.md `plugin-skills`。

## D-027 事件缝命名统一：`tools/*` + `approval/request`

- **状态**：已定 · 2026-11-12
- **背景**：同一组缝在 loop.md（`loop/pre-execute`）、tools-approval.md（裸 `pre-execute`）、plugins.md（`tools/pre-execute`）三处三个名字，钩子映射无法写清。
- **决定**：
  1. 工具管线缝归 plugin-tools：`tools/pre-execute`（waterfall，allow / deny / ask）、`tools/post-execute`（waterfall）；
  2. loop 自己的缝：`loop/pre-step`、`loop/request`、`loop/turn-stopping`；
  3. 审批钩子缝：`approval/request`（waterfall）——规则链全未命中、交给宿主 answerer **之前**；监听者可返回 allow / deny / ask / undefined（ask = 照常弹卡）。凭据硬拒与 deny 规则仍在它之前，**钩子不能放行凭据**；
  4. 钩子读者把生态事件映射到这些缝（plugins.md §4 表）：`PreToolUse` → `tools/pre-execute`，`PermissionRequest` → `approval/request`，`PostToolUse` / `PostToolUseFailure` → `tools/post-execute`（失败分支）。
- **理由**：缝的归属跟实现走（管线是 tools 插件），名字才能稳定；loop.md 原表把工具缝记在 loop 名下只是叙述视角，改掉不影响语义。
- **备注**：loop.md §4、tools-approval.md §2 / §3、plugins.md §4、principles.md P4。

## D-028 插件 UI 宿主门面：12 方法（C 档）

- **状态**：已定 · 2026-11-12
- **背景**：D-021 只定了「ESM 模块 + `ctx.registerSlot` + v1 三个挂载点」，插件 UI 只能展示。对照已实现的大规模插件平台形态（多挂载点 × 多形态、host 门面 12 方法），确认「能看不能动」的界面做不了带界面的工具小件。用户选择 C 档：全套 12 方法。
- **决定**：
  1. UI 模块 `apply(ctx)` 的 `ctx` 增加 **`host: PluginUiHost`**，12 个方法分三组：
     - **对话**：`sendPrompt(text)` → 回执 `{ messageId, sessionId }`（`messageId` 为 null = 发送失败）；`onTurnFinished(receipt, cb)` → 恰一次，四终局 `ok / interrupted / error / submit_failed`；`prefill({ chip?, text })`；`renderMarkdown(text, opts?)`；
     - **数据**：`useResource(address)` → 三态快照（loading / live / failed；失败保留上次数据）；`listPlugins({ category? })`；`listDir(path)`（只限会话工作区）；`listSessionsByCwd(cwd)`；
     - **宿主**：`getSession()`；`openInExplorer(path)`（仅桌面宿主，其他宿主返回 false）；`openPlugin(id, view?)`；`getInitialView()`（本次 view 读后即焚、按插件隔离）。
  2. **单向阀**：UI 模块 → 中柱只有 `sendPrompt` 一条路；AI → UI 模块没有事件流；模型不知道 UI 模块存在。`onTurnFinished` 只收该模块自己发起那一轮的终稿，不订阅全局回合事件。
  3. `useResource` 地址格式 `reins-data://<pluginId>/<mcpServer>/<tool>?args=<URL 编码 JSON>`；宿主 2 秒共享轮询（同地址共用、引用计数、末订阅者退订）；30 秒超时、结果 200 KB 截断；只允许调用**同一插件 `mcp/` 里声明过的 server**（越权 403）；失败保留旧数据。
  4. `onTurnFinished` 的四终局与 loop 的 `turn/end.reason` 映射：正常完成 → `ok`；用户中断 → `interrupted`；错误 → `error`；提交失败 / 未进入回合 → `submit_failed`（映射表写在 plugins.md §4）。
  5. 门面只存在于 **web 系宿主**（web / Electron / 云端网页 / 手机网页）；TUI 与 headless 没有插件 UI，不实现该门面。
  6. **不求值**：UI 模块仍是 ESM 模块加载（D-021），不引入 `new Function`。
- **理由**：没有门面的 UI 只能做展示件；带界面插件的实际需求是「发问 + 落定 + 取数 + 插件互开」。单向阀保留「UI 不是第二个对话窗口」的边界（dsh 的 receipt ≠ result 教训）。
- **不采用**：`new Function` 求值、7×5 矩阵作为 v1 契约（v1 仍三个挂载点，扩展另议）、多家生态导入（D-019）。
- **备注**：interfaces.md `PluginUiHost`；plugins.md §4；packages.md `web`；40-roadmap.md M4。
- **后续修订**：**D-042** 将第 2 条单向阀改为双向事件流（订阅 opt-in、增量可并、终局必达、输入仍单口）；**D-043** 延伸槽位模型（界面全插件化），12 方法门面结构不变。

## D-029 插件管理面：列表 / 详情 / 版本 / 卸载 / 数据区

- **状态**：已定 · 2026-11-12
- **背景**：AI 创建插件后，用户需要「看见装了什么、坏在哪、怎么切版本、怎么删」。用户选择管理面含安装 / 卸载 / 数据区；但 D-019 已定不做导入 / 同步管线与市场 / zip 暂存安装，必须先把「安装」的口径定死。
- **决定**：
  1. **安装 = AI 创建版本目录**（D-017）；设置页**不提供**从市场 / zip / 外部目录导入的入口，也不建后台扫描同步管线（D-019 不变）；
  2. **列表 / 详情**：插件 id、名称、版本、启用状态、槽位清单（skills / commands / hooks / mcp / agents / ui）、损坏原因；坏插件不挡启动，但列表必须可见告警；
  3. **版本**：列出已装版本、当前生效版本；`settings.json plugins.<id>.version` 钉版本（D-024）；切版本只影响新会话；
  4. **卸载**：删除 `~/.reins/plugins/<id>/`；默认**保留** `plugins-data/<id>/`，显式勾选才删除；删除前列出影响面，只影响新会话；
  5. **数据区**：显示 `plugins-data/<id>/` 占用，可单独删除；删除需二次确认；
  6. **边界**：只操作 `~/.reins/plugins/` 与 `~/.reins/plugins-data/`（项目级同理），拒绝路径穿越；不做注册表安装、不做市场。
- **理由**：管理面是「AI 能造」的必要配套——造出来看不见、坏了不知道为什么、删不干净，用户不敢用。安装口径必须与 D-017 / D-019 自洽，不能借「管理面」把导入管线放回来。
- **备注**：plugins.md §6；data-directory.md §2 / §5 / §7；packages.md `web` / `server`；40-roadmap.md M4。用户确认（2026-11-12）：管理面不设"安装"按钮，安装 = AI 创建版本目录。
- **后续修订**：**D-048** 管理面补两件事：带 `engine/` 的包首次生效前弹确认卡（写明替换谁、代码路径、依赖数；版本升级重弹，同版本只一次）；插件行显示"已被用户插件替换（来源 + 版本）"。

## D-030 插件安全基线：凭据不进插件文件、静态资源 sandbox、MCP / hook 明示

- **状态**：已定 · 2026-11-12
- **背景**：同类平台的真实缺口：若插件 MCP 配置落在「只读放行」范围里，模型可以直接读、不弹窗；API key 若写进 `env` / `headers` 就泄进模型上下文。Reins 的凭据铁律是「只在 `config/credentials.json`」，但插件文件没有写死禁令。
- **决定**：
  1. **凭据不进插件目录**：`plugins/<id>/<version>/` 与 `plugins-data/<id>/` 的任何文件都不得写 API key / token / 密码；`mcp/*.json` 的 `env` / `headers` 只放非敏感配置。加载器对敏感键名（key / token / secret / password 等）做检查，命中则拒绝该 MCP server 并告警；
  2. **MCP 需要的密钥由宿主注入**：来源 `config/credentials.json`，不进插件文件、不进事件 / 日志 / 模型上下文。插件文件只写引用名，具体引用语法随 plugin-mcp 实现定；规范先禁止明文；
  3. **静态资源隔离**：插件自带的 html / svg / js 等以文档形式伺服时，必须带 `CSP: sandbox`（opaque origin）；ESM UI 模块与宿主同源，**不是安全边界**（D-021），不得写入凭据；
  4. **MCP 定义变更要确认**：新增 / 修改 `mcp/*.json` 会导致自动 spawn，宿主在插件管理面首次连接或变更后必须让用户确认（安装动作本身即确认）；
  5. **hooks 要明示**：创建 / 启用 hook 时，宿主必须展示 event 与将执行的命令；拦截类（退出码 2）要说明影响面。
- **理由**：这四条都是同类平台实际暴露过的缺口；插件越强，越要把「作者可信」与「凭据不可见」写死。UI 不是沙箱这一点 D-021 已定，本 ADR 补的是「插件文件不是保险箱」。
- **备注**：plugins.md §4 安全规则 / §6.4 管理面；data-directory.md §8。

## D-031 UI 位置静态申报：可选 `ui.slots` + 运行时权威

- **状态**：已定 · 2026-11-12
- **背景**：D-021 定的是"清单不带 slot，挂载点由模块运行时注册"——不申报位置，插件页无法提前展示，AI 自测也没有静态目标。用户选择按建议实施。
- **决定**：
  1. `plugin.json` 的 `ui` 段增加**可选** `slots?: string[]`：声明该 UI 模块计划挂载的位置（v1 取值 `session.top` / `composer.above` / `sidebar.right`；宿主扩展后按各宿主自己的词表校验）；
  2. **运行时 `ctx.registerSlot` 仍是唯一权威**：实际挂哪由模块运行结果决定；`ui.slots` 只作插件页展示、加载前校验、AI 自测提示；
  3. **只在 `ui.slots` 存在时校验**：声明了但没注册 → 告警（死声明）；注册了但没声明 → 告警（漏声明）；声明了未知挂载点 → 丢弃该条并告警；`ui.slots` 不是数组 / 类型错 → 忽略该字段（保留 `entry` / `title`）并告警；插件照常加载，不阻断；
  4. 不写 `ui.slots` 完全合法，行为与 D-021 相同；
  5. 字段名是 `ui.slots`（不是 `slot`）；一个 UI 模块可声明多个挂载点，同一组件可挂多处，由 `registerSlot` 决定。
- **理由**：可选声明 + 运行时权威，兼顾可发现性与单一真源；强制静态（C）会让 AI 先猜位置并制造两套真源，纯运行时（A）则插件页 / AI 自测没有静态目标。
- **备注**：plugins.md §3 / §4；50-open 勾掉 UI 位置项；D-021 加后续修订指针。
- **后续修订**：D-033 区分"属于别的宿主词表"（静默忽略）与"完全未知"（告警并忽略）。

## D-032 同名覆盖统一口径：作用域优先 + 显式文件优先

- **状态**：已定 · 2026-11-12
- **背景**：同名覆盖各家口径不一（有的按项目赢、有的按作者赢）；Reins 一直挂着"同名覆盖统一口径"待定。用户同意按"用户自己写的文件应该盖过插件打包内容"收口。
- **决定**：所有具名内容一条链——
  1. **项目独立定义**（项目 `.agents/skills`、项目 `.reins/agents`）
  2. **项目插件槽位**（项目 `.reins/plugins/*` 的 skills / commands / agents）
  3. **用户独立定义**（`~/.agents/skills`、`~/.reins/agents`）
  4. **用户插件槽位**（`~/.reins/plugins/*`）
  5. **官方随包**（官方 npm 包内的 skills / commands / agents）

  落到各类：
  - **技能**：项目 `.agents` > 项目插件 > 用户 `.agents` > 用户插件 > 官方随包；
  - **命令**：项目插件 > 用户插件 > 官方随包（没有独立命令根）；
  - **子代理**：项目 `.reins/agents` > 项目插件 > 用户 `~/.reins/agents` > 用户插件 > 官方随包；
  - **同名插件**：项目内容包 > 用户内容包；内容包 id 与官方插件 id 相同 → **跳过内容包并告警**（官方 id 保留）；同 id 多版本仍按 D-024（钉版本 / 最高版本）。

  **同层多插件同名**：按插件 id 字典序，靠前者赢，并告警；要覆盖就改 id / 名字。同名比较不区分大小写（Windows 文件系统一致）。
- **理由**：作用域优先保证项目盖用户；同层显式文件优先保证"我写的文件不被插件静默盖掉"；插件 id 字典序给出确定性，避免目录扫描顺序造成跨平台差异。
- **修订**：D-020 / D-026 的技能五级顺序对调为 **项目 `.agents` > 项目插件 > 用户 `.agents` > 用户插件 > 官方随包**（前两级、中间两级互换）；D-026 的"官方最低"不变。
- **后续修订**：**D-048** 补同名插件的引擎层语义——同 id 且带 `engine/` 的用户包经确认卡显式确认后**替换官方插件**（优先级：项目 > 用户 > 官方 npm）；本条"跳过内容包并告警"仅适用纯内容包（无 `engine/`）。
- **备注**：plugins.md §4 技能来源 / §7.1；50-open 勾掉同名覆盖项。

## D-033 宿主槽位词表：按宿主定义、按需扩展，不做 7×5

- **状态**：已定 · 2026-11-12
- **背景**：v1 只有三个挂载点；移动端单栏没有 `sidebar.right`，不能照搬桌面；7×5 那类大矩阵是产品级界面的产物，不是框架必须先造的。
- **决定**：
  1. **v1 桌面 Web 保持三个**：`session.top` / `composer.above` / `sidebar.right`；不做大矩阵承诺；
  2. **槽位词表按宿主定义**：每个宿主声明自己认识的槽位；`ui.slots` 与 `ctx.registerSlot` 都按**当前宿主**的词表校验；
  3. **共享核心两个**：`session.top`、`composer.above` 在所有 web 系宿主（桌面 / 手机网页 / Electron / 云网页）语义一致；`sidebar.right` 仅桌面 Web；
  4. **移动端词表等移动 UI 设计时再定**：可复用共享核心；不得复用 `sidebar.right`；具体名字（如 `mobile.sheet` / `mobile.drawer`）到那时按真实布局定；
  5. **桌面扩展按需加**：`sidebar.left` / `session.bottom` / `titlebar` 等只在真实插件需要时逐个加；每次都是 Web 宿主的 UI 改动，不动内核；
  6. **未知槽位处理**：属于别的宿主词表的槽位 → 静默忽略；完全未知的槽位 → 告警并忽略；插件继续加载，不阻断。
- **理由**：槽位是宿主 UI 的产物，不是内核概念；宿主不同，词表就该不同。按需扩展避免为不存在的插件造 35 个位置，也避免移动端硬套桌面。
- **备注**：plugins.md §4 挂载点 / §7.2；D-031（`ui.slots` 按宿主词表校验）；D-028（门面只 web 系宿主）。

## D-034 宿主形态总口径：一引擎多宿主，三拓扑

- **状态**：已定 · 2026-11-13
- **背景**：对照 dsh（多 profile：web 有服务、headless 无服务）与同类"一切形态皆客户端、headless 也起服务"的单一拓扑实现，确认 Reins 归属。项目所有者确认理解后拍板：Reins ①③并存。
- **决定**：
  1. **引擎（kernel + 插件）是库**：不知道 HTTP、不画界面、不占端口；宿主装配引擎并决定其位置；**server 是宿主之一，不是必经层**；
  2. **三拓扑**：①一对多（多客户端连一个 server）、②一对一（私有 server，①的退化用法，不单列）、③零服务（进程内嵌：无 server、无端口、无 HTTP）；
  3. **归属**：Web ①、桌面 ①（D-035）、headless 与 sdk 进程内嵌 ③、云端 ①远程（D-036）；TUI / npm / 移动端待定（50-open 🟢）；
  4. **CLI 是命令入口不是界面**（黑窗口聊天发布后，D-018）；`reins serve` 是①的服务端半边；
  5. **宿主契约四条**：配置注入（ConfigService）/ InteractionService 实现 / 事件消费 / 输入投递（hosts.md §3）。
- **理由**：库优先使 headless / SDK / 脚本零成本（不用先起服务）；①③用同一份引擎代码，只是住处不同。"一份协议多形态"保留（①系全说 server 协议），去掉的是"必须起服务"的强制。
- **备注**：[hosts.md](./20-architecture/hosts.md)；与 D-010 / D-012③ 互补（那两条定引擎形态，本条定宿主形态）。

## D-035 桌面宿主＝A1；server 升正式宿主；回环三件套

- **状态**：已定 · 2026-11-13
- **背景**：桌面三路——A1（utilityProcess 起 server 子进程 + 窗口加载回环地址）、A2（引擎进主进程 + IPC）、A3（主进程内嵌 + 进程内回环 server）。三路的界面适配相同，差别在进程摆放与通信层。
- **决定**：
  1. **A1**：Electron 主进程以 utilityProcess（受管子进程，退出自动回收）拉起 server 包——与 `reins serve` 同一份代码；窗口加载 `http://127.0.0.1:<随机端口>`，同源伺服 web 构建，**界面与 server 零改动**；server.json 握手、防双开（后启实例读到 server 已活 → 只开新窗口）；
  2. **server 由"示例级"升"正式宿主"**（packages.md 同步改）；`desktop` 包列入宿主层（中远期，薄壳：托盘 / 自动更新 / 防双开，不实现引擎 / 协议 / 界面）；
  3. **回环三件套**（server 诞生日起生效，M3）：默认只绑 `127.0.0.1`（公网 / 局域网开放 = 显式配置）；随机端口；Host / Origin 头校验 + 可选 token 位；
  4. **排期中远期，不阻塞 M1–M4**：`reins serve` + 浏览器 M3 即可用，桌面只是它的壳。
- **理由**：崩溃隔离（引擎死 = 子进程死，窗口活着可提示重启）；主进程保持轻（utilityProcess 的设计目的）；`reins serve` 反正保留，"server 作为独立进程"的代码路径已存在，A3 实际省不下东西。A2 被弃：web 界面永久双轨（HTTP+SSE 与 IPC 两套通信实现）。
- **重开条件**：禁止本机监听端口的部署硬约束 → A2；强制单进程 → A3。
- **修订**：D-012③ 宿主层清单增补 `desktop`；D-018 发布后 backlog 增补桌面宿主与 `examples/cloud`。
- **备注**：[hosts.md](./20-architecture/hosts.md) §4；packages.md `server` / `desktop`；40-roadmap.md M3 判据与 backlog。

## D-036 云端＝分层丙案：不立 cloud 宿主包

- **状态**：已定 · 2026-11-13
- **背景**：云端比本地差四样——验钥匙（鉴权）、归属（多用户）、容器生灭（编排）、HTTPS。三案：甲全进 server 包、乙独立 `@reins/cloud` 宿主包、丙分层各归其位。项目所有者选丙。
- **决定**：
  1. **丙（分层）**：token 验证与会话 user 字段进 server / protocol；容器编排 = `examples/cloud` 部署样例（docker-compose），**不进任何代码包**；HTTPS 靠前置代理（nginx / Caddy）；账号 / 计费等商业化机器在开源仓库外；
  2. **不立 `@reins/cloud` 宿主包**——一份协议本地云端通吃；重开条件：云端真出现与本地不同的协议需求（换流式通道 / 计费接口）再立包；
  3. **云容器本身即沙箱**：云端不需要沙箱插件；本地沙箱插件（packages.md 外圈）与云不共用机制，设计另议（50-open 🟢）；
  4. 默认仍只绑回环（D-035 三件套）；对公网开放是自托管 / 云端部署时的显式配置。
- **理由**：真正要写的只有 token 与 user 字段且都很小；容器生灭是运维不是功能代码；乙在"宿主互不依赖"规则下还得先抽公共 HTTP 库（预交税）；分层方案一个 `createClient({ baseUrl, token })` 通吃，一人一容器一进程，撑不起常驻包。
- **备注**：[hosts.md](./20-architecture/hosts.md) §5；packages.md `examples/cloud`；40-roadmap.md backlog。

## D-037 npm 形态：sdk 纯 TS + web 可嵌入；headless 为 cli 子命令

- **状态**：已定 · 2026-11-13
- **背景**：四个遗留形态项中，只有 npm 拆包"现在不定会返工"——它决定 M3 的 web 包怎么搭骨架。三案：a) `@reins/sdk` 单包全含（核心 + UI 混装）；b) `@reins/sdk` + `@reins/sdk/web` 子路径；c) 不造新形态——sdk 保持纯 TS，web 做成"可嵌入"（构造时注入 client），npm 用户两包组合。项目所有者选 c。
- **决定**：
  1. `@reins/sdk` **纯 TS**：进程内嵌 runtime + 远程 client 双形态不变，**零 React / 零界面依赖**——跑脚本、嵌后端的用户不被界面依赖纠缠；
  2. `@reins/web` 保持独立包，并**可嵌入**：界面组件以 `createWebApp(client)` 类形式暴露，client 从外部注入（本地 HTTP+SSE client 或 sdk 远程 client 皆可）；web 自身的宿主用法 = "注入默认 client"的特例；
  3. **不造 `@reins/sdk/web` 子路径、不把 UI 搬进 sdk**；想要界面的 npm 用户 = `@reins/sdk` + `@reins/web` 两包组合；
  4. **headless 用户入口 = cli 子命令 `reins run`**（进程内嵌③），不立独立 `@reins/headless` 包；M2 起由 examples/mock 直接覆盖验证，入口时点随 cli，不因本决定新增排期；
  5. **生效时点：建 web 包之前（M3）**——先做成纯应用宿主、回头改造成可嵌入是真实返工，这正是本条必须在现在定稿的原因。
- **理由**：不新增任何包或形态（packages.md 早已如此），只给 web 加一条设计约束；"核心 + UI 先混装、二期再拆"是同类实践里被验证为不舒服的终点，我们没有必要先混后拆；a 案让 SDK 用户被迫背 React；b 案把两份职责塞进一个包。
- **修订**：D-034 第 3 条归属中 npm 项由本条定稿（TUI / 移动端仍为待定）。
- **备注**：hosts.md §2 / §6；packages.md `sdk` / `web` / `cli` 行；40-roadmap.md M3 内容；50-open npm 项勾掉。

## D-038 web 升正式宿主（与 server 同级）

- **状态**：已定 · 2026-11-13
- **背景**：D-035 只把 server 从"示例级"升为正式宿主，web 的"宿主示例"标签保留。全文档通读发现张力：desktop 整只复用 web（界面零改动），云端 / 手机将来同用一套界面——载重墙标"示例"名不副实。项目所有者拍板：web 也升正式宿主。
- **决定**：`@reins/web` 升**正式宿主**（与 server 同级）；00-vision 与 packages.md 的"宿主示例"表述移除。负面清单原意不变——框架不做成最终用户产品，宿主是自举狗粮；"正式"指它是所有 web 系宿主（web / desktop / 云网页 / 手机网页）的界面本体，不是可随意改动的演示代码。
- **理由**：桌面（D-035）、云端（D-036）、移动端（hosts.md §6 倾向）全部复用这份界面；"示例"标签会误导贡献者低估它的地位与改动成本。
- **备注**：hosts.md §3 / §4；packages.md `web`；00-vision。

## D-039 审批判定链补默认放行层、灾难硬拒与子代理审批规则

- **状态**：已定 · 2026-11-13
- **背景**：判定链原止于"无规则命中 → 宿主 answerer"，缺"哪些工具不用问就能用"的默认层——照旧文档连读文件都要弹卡，headless 首跑什么都干不了。各家公开实现（ZCode / Claude Code / OpenCode）全部有此层。
- **决定**：
  1. **默认放行层**：无规则命中时 `isConcurrencySafe: true`（只读标记）自动放行、照常落 `approval/decided` 审计；web_fetch 类只读工具因此免问；`deny` 压倒一切（链首）；headless 开箱可跑只读任务，写类靠 `permissions.json` 规则；
  2. **灾难操作硬拒**：灾难性命令（`rm -rf /`、格式化、`dd`、shutdown 等）与凭据同列链外，任何规则、任何标记都放不了行；清单由官方 approval 插件承担，官方 shell 工具执行前内置检查；
  3. **路径围栏在工具内部**：默认层只看工具标记；工作区内直接执行、区外调 `requestPermission`、凭据与灾难仍硬拒；
  4. **子代理审批**：前台问（经父会话 UI、`origin` 标注来源）/ 后台永不问（fail-closed 拒、写进报告）/ 两种都继承父会话规则；不采用 dsh"钉死 never + 工具面收紧"案。
- **理由**：主流一致——读类免问 + deny 压倒一切 + 灾难硬拦（ZCode `service.ts:565-576`；Claude Code 同构）；子代理"前台问 / 后台拒"取 Claude Code 分法（后台子代理自动拒），各家多取前台问。
- **修订**：principles.md P5 补"灾难操作与凭据同列链外"；D-027 的 `approval/request` 缝表述更新为"规则链（含默认放行层）未命中后"。
- **备注**：[tools-approval.md](./20-architecture/tools-approval.md) §3 / §3.2；principles.md P5；40-roadmap.md M2 判据。
- **后续修订**：**D-049** 将第 3 条"路径围栏在工具内部"的归属改写为"**围栏跟着能力走**"——围栏住进 fs 能力服务，注入该服务的工具件皆受围栏；判定链、默认放行层与灾难硬拒语义不变。

## D-040 模型接入钉死 AI SDK；模型参数字典 = models.dev（配置层）

- **状态**：已定 · 2026-11-13
- **背景**：D-007 定了默认适配器基于 AI SDK，但"永不自研"与模型能力参数（contextWindow / 输出上限 / 价格）的来源没钉死——此前只说"配置解析的产物"。两家开源实证：ZCode 用 AI SDK 但已让 models.dev 退役、改打包自带 JSON（`models-dev-catalog-source.md:5` 禁止再引入）；OpenCode 自研 HTTP 直连为主、models.dev 字典活着（运行时拉镜像 + 缓存 + 快照兜底，`models-dev.ts:507-516`）。项目所有者拍板："直接 AI SDK 和 models.dev 这两个就好了……不自己去搞。"
- **决定**：
  1. **接模型 = Vercel AI SDK provider 层，不自研、不自建直连**（D-007 钉死）；plugin-llm 只做薄适配（P3 契约 + 边缘怪癖垫片）；
  2. **模型参数字典 = models.dev**，同步归**配置层**（config-loader）：运行时拉取 + 缓存 + 快照兜底（断网可用），机制照 OpenCode 双通道；**引擎零网络、零厂商表**（P9-4 不变，且连自维护表都省了）；
  3. **配置入口不动**：`models.json` 注册模型 + `settings.json` 选默认；字典只**预填**能力参数，用户手写**覆盖**字典（用户配置 > 字典）。
- **理由**：AI SDK 省协议自研税（40+ provider 现成）；models.dev 省厂商表维护税且让模型清单开箱可选；手写模型层"每接一家硬编码一处"的坑（P9-4 来源）由"字典 + 配置解析"双保险堵死。ZCode 退役 models.dev 是想要离线确定性与受控 revision——我们的快照兜底同样满足。
- **修订**：D-007 补"不自研"表述；principles.md P3 补字典来源；data-directory.md §2 / §8 补 models.json 字段来源。
- **备注**：packages.md `config-loader` 行；50-open 归档。

## D-041 官方插件分三批随版本发布（修订 D-018）

- **状态**：已定 · 2026-11-13
- **背景**：D-018 定"15 个全进 M4（v0.1 首发）"，设计评价已点名 M4 挤压风险；项目所有者重开："官方的也能慢慢补。"复查安全承诺："官方默认 = 安全默认"说的是**预装的保证安全**，没预装 = 暂时没这个能力 ≠ 不安全；真正不能延的只有内圈引擎 5（D-016，缺一系统不转）。
- **决定**：15 个官方插件分三批随版本发布，**清单不变**（P8"官方 15 个"仍是官方集合定义，批次只管发布时点）——
  1. **首发批（M4，v0.1.0）**：引擎 5（session / llm / tools / approval / loop）＋ fs ＋ shell ＋《插件规范》/ 插件管理面 / changesets——架子即能跑：对话落盘回放 fork、读写文件、跑命令、审批卡、插件启停；
  2. **二批（M5）**：fetch / compaction / subagent / tasks（三条设计文档 50-open 🟡 随批定稿）；compaction 缺口的过渡 = 长对话新开会话；
  3. **三批（M6）**：读者 4（skills / mcp / hooks / commands）；AI 创建插件 / 技能工作流随之发布（创建技能随 plugin-skills，D-026）。
- **理由**：外圈添加是纯加法（新增插件包 + 官方预设一行 `.use()`，packages.md 插件两圈）；M4 剪到 7 个插件后首发压力减半；黑窗口聊天发布后、网页界面边界 M4 前置两条（D-018 第 2、3 条）不变。
- **修订**：D-018 第 1 条被本条取代；roadmap M4 拆为 M4–M6；50-open 🟡 三条设计文档排期 M4→M5，"命令进输入框"挪 M6 前置。
- **备注**：40-roadmap.md M4 / M5 / M6；principles.md P8 不动；packages.md 无排期标注、不动。
- **后续修订**：**D-043** 增官方第 16 个插件 `plugin-web-ui`（界面 1，M3 随 web 诞生，不占三批名额）；本条三批名单与时点不变。**D-049** 能力服务化按族拆包——计数 16→21：首发批 7→10（引擎 5＋fs 族 3＋shell 族 2）、二批 4→6（＋任务族 3、－原 tasks 1），名单与时点仍不变。

## D-042 插件界面开放双向事件流（修订 D-028 单向阀）

- **状态**：已定 · 2026-11-13
- **背景**：D-028 定单向阀是防"UI 变成第二个对话窗口"；用户重开并拍板"必须要双向"——组合形态（插件承载对话面板、产品内嵌输入框、插件内直接对话）全靠流供血，没有流这些形态都是摆设。50-open 🟡"UI 门面交互方向"就此结案。
- **决定**：
  1. 门面新增**事件订阅** `subscribe(filter, cb) → Disposable`：UI 模块可收**本会话**引擎事件（含流式增量）；过滤三轴——当前会话（固定）、事件类型白名单、可选 turnId；**不订阅不收**（默认行为同原单向阀，订阅是显式 opt-in）；
  2. **背压**：每个订阅者一条**有界队列**（与 server SSE 同款语义）；队满时**增量类可丢可并**（text-delta 等按 16ms 攒批合并，P6 同款），**终局类必达**（tool-call 终态 / approval / turn-end——挤掉最老的增量也不挤终局）；
  3. **输入仍单口**：发起对话只有 `sendPrompt` 一条路（避免双写）；`onTurnFinished` 保留为自己发起回合的便捷终局回执；
  4. **模型不知道 UI 存在**不变：订阅是宿主推给呈现层，事件不回注模型上下文；
  5. 其余 12 个方法与门面结构不变。
- **理由**："增量可丢可并、终局必达"是"实时渲染不炸内存"与"审批 / 结束绝不丢"的最小组合；类型白名单让插件只收自己关心的；输入单口保住"UI 不是第二个对话窗口"的边界（dsh receipt ≠ result 教训仍在）。
- **修订**：D-028 第 2 条"单向阀"被本条取代；plugins.md §4 单向阀段改双向；roadmap M4 UI 门面判据随改。
- **备注**：interfaces.md `PluginUiHost.subscribe` 形状（M3 随门面定稿）；50-open 归档。

## D-043 界面全插件化：官方界面是真插件 + 槽位装法 + 标准件出口 + 三级后手

- **状态**：已定 · 2026-11-13
- **背景**：npm 嵌入要求界面可拆件（完全体 / 只中间 / 只输入框）；插件要能承载对话界面（件进插件、插件内组合、插件即产品）；项目所有者立"**界面一切皆插件**"原则并逐条确认成型。D-021 只定"插件挂进宿主三个槽位"，宿主界面本身不可换；官方默认界面曾拟住 web 包（保守方案），被项目所有者纠正为真插件。
- **决定**：
  1. **官方默认界面 = 真插件**：新增官方界面包 `plugin-web-ui`（**官方第 16 个插件**，M3 随 web 诞生，不占 D-041 三批名额）——布局与各件（会话列表 / 对话面板 / 输入框 / 审批卡……）各占各槽；与社区插件同一条注册路径，无特例（P8 狗粮）；
  2. **槽位模型**：宿主 = 框（左中右；词表按宿主，D-033）+ 默认装法；**无"布局槽"**；区域槽动词两个——append（现 `registerSlot`）与 replace（`replaceSlot` 显式替换该区默认件）；同区冲突 = 报错（D-022 同款）；**没装东西的框收起**（不渲染不占宽，不留空白）；装法可自定义（件挂哪个槽可配置）；
  3. **内圈 UI 槽位不给关、不提供版本钉**（D-016 机制照搬，装配层规则）：官方默认组合永不缺席；settings 手改 `enabled:false` / `version` 对官方界面件无效；
  4. **插件用件 = 宿主标准件出口**：官方界面件经 import map 暴露（与 react 同口子，D-021 第 2 条延伸）；插件 import 的是宿主出口的**同一份同版本件**；插件之间禁止私拉直连（与引擎侧"插件互不 import、经槽位互消费"对称，packages.md 依赖规则 2）；
  5. **上下文注入是承重缝**：件 + 会话上下文一起给（连着哪个会话、往哪发、流式增量从哪来）；插件装载通道与 npm 组件出口同约定，形状 M3 定稿；
  6. **三级后手**：①槽位级错误兜底（ErrorBoundary）——某槽插件崩仅该槽回退官方默认件 + 告警横幅；②双击 Alt 进安全模式（快捷键挂宿主最外层监听，插件压不住）；③URL `?ui=safe` 兜底。安全模式 = 只载官方默认组合、跳过一切非官方界面插件；临时态不改任何设置；
  7. **npm 嵌入 = 同一零件库的编译期出口**：`@reins/web` 暴露组件，`createWebApp(client, { layout })` 支持挑件（完全体 / 只中间 / 只输入框……）；零件与规矩全部引本条与 D-042，不另起设计；
  8. **M3 组织约束（首发生效）**：web 界面自第一行代码起按"可拆组件 + 槽位组合"组织，默认组合只是一种排列。
- **理由**：一个机制两用（嵌入挑件与插件重画同一台机器）；VS Code 全贡献点先例证明超大生态可行；P8 无特例、官方界面自己吃狗粮（无特权 API 被最重消费者验证）；宿主薄壳化与 D-035 / D-036 一条线。
- **修订**：P8 官方插件 15→16（语义 5 / 能力 6 / 读者 4 / **界面 1**）；D-021 三挂载点延伸为槽位模型（append + replace，挂载点词表 D-033 不变）；interfaces.md `defaultPreset` 注释 15 条 → 16 条（web-ui 为 id-only 条目）。
- **备注**：packages.md（plugins/ 增 `web-ui`、依赖方向 16、两圈补界面套件行、职责表 +1）；interfaces.md web 段（挑件参数概要）、`PluginUiHost`（`replaceSlot` / `subscribe` / 标准件出口）；plugins.md §4 / §5；roadmap M3（内容 + 判据 + 组织约束）、M4 前置；50-open 归档。

## D-044 工具参数声明单一格式：ToolDefinition 只收裸 JSON Schema

- **状态**：已定 · 2026-11-14
- **背景**：50-open 🟡"工具 schema 形态：zod vs 自有 JSON Schema"。多仓取证（2026-11-14）：**模型出口各家全部是 JSON Schema**（模型线协议决定的，没得选）；分歧只在书写层——OpenCode 用 Effect Schema（`read-filesystem.ts:25`），**dsh / ZCode 直写 JSON Schema**（dsh `tool-bash/src/index.ts:370`、ZCode 插件宿主原样透传 `viewServer.ts:9`）；Claude Code 对外来 MCP 工具收裸 JSON Schema（公开接口行为）。项目所有者否决双形状方案："怕 AI 写着写着造成混乱，乱用。"
- **决定**：
  1. **ToolDefinition 参数声明只收裸 JSON Schema 一种形状**——模型请求投影、MCP tools/list 转发（三批 plugin-mcp）、AI 创建内容包用同一格式，零转换；
  2. **zod 从协议退场**（原草案 `inputSchema: ZodSchema<A>` 作废）；官方 TS 插件**直写** JSON Schema（dsh 同款），**不建**官方内部转换糖（zod→JSON Schema 助手）——官方源码是 AI 创建插件的模仿素材，样板必须只有一种笔；
  3. 官方工具 `execute` 入参**不靠 schema 推导 TS 类型**：松散 args + 引擎校验 + 工具测试钉行为（"参数不合规拒执行"运行期兜底）；
  4. **装载期校验**工具 schema 合法性（可解析、object 形状）——非法 → 该插件**跳过 + 告警**（接 D-029 管理面"坏插件告警可见"）。
- **理由**："直写 = 两处手抄"只在工具函数要强 TS 类型时成立——放弃推导就只有一份手写、没有漂移面（P9-5 不破）；AI 创建插件是唯一用户侧来源（D-017 / D-029），协议里只有一种形状 = AI 没得选，纯内容包也不会多出 import zod 的装机风险；选 schema 库的两家共性是"自家 TS 工具 + 要类型推导"，与我们"样板纯度压倒 DX"的取向相反。
- **修订**：tools-approval.md §1 `ToolDefinition` 形状改 JSON Schema；interfaces.md `tools / approval` 段随改；50-open 🟡 本项结案。
- **备注**：MCP 工具天然裸 schema 直通；D-007 AI SDK `tool()` 经 `jsonSchema()` 包装吃裸 schema，零成本。**连带确认**：session.md §3 事件注册表（`SessionEventRegistry`）维持 ZodSchema——zod 本就是 kernel / protocol 唯一的运行时依赖（依赖规则 1），注册事件 schema 的全是进程内引擎插件（含 AI 的 `engine/` 件，经 import map 已带 zod），D-044 治的"外部生产者被迫 import zod"（MCP server、纯内容包）在这里不存在；M1 protocol 定稿照此执行，不另立待办。**后续修订（D-051，2026-11-16）**：事件注册表不维持 ZodSchema——改最小 duck 接口（protocol 零依赖，zod 退到 session 包实现侧），本段"连带确认"作废。

## D-045 回合队列与步数上限：忙时投递唯一化 + 条目"立即发送"插话 + 上限默认不设

- **状态**：已定 · 2026-11-14
- **背景**：50-open 🟡 两项——"steer（回合内插队）v1 是否开放"与"loop step / token 上限默认值"。多仓取证（2026-11-14）：插话 dsh 双通道（`mode:'queue'|'steer'` + Enter 可配，`contract/session.ts:34`）、OpenCode 默认插队（`session/command.ts:34`）、Claude Code（行为层）回合内 tool-result 边界把插话 drain 成附件、ZCode `turn.steerQueued / steerDrained` 事件对（`zcode-protocol/index.ts:1551-1552`）。步数上限：OpenCode（`config/agent.ts:34`）与 Claude Code（行为层）均**机制可选、默认不设**；dsh / ZCode 无；**各家均无回合 token 硬顶**（上下文规模全归压缩）。
- **决定**（项目所有者逐条拍板）：
  1. **忙时投递只有一条路：进队列**——无第二种投递语义、**无设置项**（dsh 双通道与 Enter 设置不采）；闲时发送直接开新回合；回合结束后队列头部依次自动开新回合；
  2. **队列条目"立即发送"按钮 = 插话**：该条在**下一个 step 边界**进场（工具结果落定后、下一次模型请求前），**不打断正在执行的工具**（dsh `runtime-types.ts:225-231`、ZCode 主流式，Claude Code 行为层同构；中断式不采——避免用户消息插进工具执行半途，账本时间线难看）；
  3. 插话照记日志：落 `user/message`、按同轮时间线显示；**不新增事件类型**——队列状态不进事件账本（P9-1）；
  4. **排队按会话持久化**：会话目录新增 `queue.json`，tmp+rename 原子重写；重启 / server 重连读回恢复；条目进场时落账并从文件移除；
  5. **步数上限：机制保留为可选配置、默认不设**——主循环默认不设、子代理默认也不设（dsh 干净路线；子代理规模由并发上限 8 / 嵌套深度 1 框住，取证见 50-open 归档）；**token 硬顶不做**，上下文规模归压缩预算（窗口 × 0.8，compaction 二批）；
  6. 兜底栈不变：死循环熔断（官方插件，`loop/turn-stopping` bail 缝）+ 压缩预算 + 用户随时打断。熔断存在"被穿插动作规避"的残余风险（步数上限是最后一道闸）——我们接受该残余风险（主流一致），真需要保险丝的用户经配置自开。
- **理由**：用户消息一个字都不能丢 → 持久化必须（dsh 持久化 inbox 同向，项目所有者拍板"必须落"）；"立即发送"把"要不要插话"的决策推迟到条目级点击，默认路径只剩排队一种，机制面最小；插话选 step 边界 = 主流式且与中断纪律五点（loop.md §2）天然咬合。
- **修订**：loop.md §1 inbox 语义改写、§4 待定框落笔；data-directory.md 会话目录增 `queue.json`；session.md 头部"仍未定"清单随改；roadmap M2 判据增队列 / 插话测试项；50-open 🟡 两项结案。
- **备注**："立即发送"按钮属界面 UI（M3 / M4），机制缝本条已定；插话按同轮时间线显示参考 ZCode 事件对（归属用 turn 内 seq 即可，无需新事件）。

## D-046 审批卡载荷：PermissionRequest 带 args 全文，显示折叠归界面 UI

- **状态**：已定 · 2026-11-14
- **背景**：50-open 🟡"PermissionRequest 形状：args 全文 vs 摘要 + 路径提取"。取证（2026-11-14）：Claude Code（行为层）权限回调收全 input、拒绝审计存原文；dsh 反例不带 args（`user-approval/types.ts:63-76`，只给 toolName + callId 指回调用记录）；OpenCode 由各工具自选 metadata（`permission.ts:219-223`）；**引擎层造摘要：没有一家做**——摘要是对原文的转述，写错 = 骗用户批准。
- **决定**（项目所有者拍板"args 全文"）：
  1. **PermissionRequest 载荷 = `{ tool, args（完整原样）, reason? }`**——引擎一字不加工；判定链、审计事件对、重连重放用同一份全文；
  2. **显示归界面 UI**：折叠 / 展开 / 高亮是**展示裁剪**，不是转述——卡上可以只露"写入 bar.ts（约 2000 行）+ 头部预览 + 展开按钮"，数据全文永远在载荷里；
  3. **挂起请求自足可渲染**（args 在载荷里）：断线重连、多窗口重放同一张卡（P5 既有设计）；
  4. `displayReason`（dsh `user-approval/types.ts:72`，仅展示不入审计）**不进 v1 载荷**——M2 落码时按卡片可读性再定是否补可选字段。
- **理由**：D-039 判定链在工具围栏内部执行，围栏本就持有完整 args，带全文零成本；"审计用全文 + 眼睛看裁剪"两不误；折叠错了顶多少看见几行，数据没丢。
- **修订**：tools-approval.md §3 待定框落笔（新增 §3.3）；session.md 头部"仍未定"清单随改；50-open 🟡 本项结案。
- **备注**：审计事件对（`approval/asked` / `approval/decided`）照记全文；D-013① 归属不变（挂起表归 InteractionService）。

## D-047 开源卫生：一切引用可公开对证

- **状态**：已定 · 2026-11-14
- **背景**：Reins 要开源。开源仓库的第一条卫生要求：引用必须可公开对证。为此对全文档做了一次出处规范化——出处统一为公开仓库实名 + file:line、实证数字无主语化——并把今后的落笔规则写死。
- **决定**：
  1. **来源标签封闭词表**：只用公开仓库实名（`[dsh]` / `[zcode]` / `[opencode]`）与 `[用户]`；闭源产品（如 Claude Code）仅行为层参考、不设标签；不引入其他任何来源标识。词表唯一出处为 [principles.md](./20-architecture/principles.md) 顶部「来源标注」，检查脚本直接引用该处，不另立副本；
  2. **教训三分类落笔**：有公开锚点的挂公开仓库 + file:line；属通用工程真理的写成无主语设计理由；公开仓查不到的降级为"我们的设计判断"，**不编造归属**；
  3. **一切 file:line 引用均指向公开仓库**；实证数字一律无主语化或删除；
  4. **借鉴主渠道 = 公开仓库**（dsh / ZCode / OpenCode）：每插件落码前翻公开源码抄结构；闭源产品（如 Claude Code）仅行为层参考、不引源码路径；
  5. **本次出处规范化为一次性机械替换**（仅限出处标识、行号引用、实证数字），**不改动任何决策语义**；今后同类调整按只追加规则新增 ADR 记录，不援引本条例外。
- **理由**：思想不受版权保护、教训可以无主语成立；公开仓库可审计、可引用——引用统一可公开对证，项目身份干净。
- **备注**：全文档出处已统一为公开锚点（00-vision / INDEX / principles / 全部 ADR / 架构文件）；调研存档见 30-research（公开仓库调研两份）。

## D-048 AI 创建插件开放引擎代码：engine/ 槽位、同 id 显式替换、放开依赖

- **状态**：已定 · 2026-11-15
- **背景**：D-010 承诺"任何官方插件（包括 loop 与 approval）可被整包替换"，但引擎级替换的既有路径只有"会写 TS 的开发者写独立包 + `reins.config.ts` 显式清单"（D-016④）——装好软件的终端用户让 AI 换掉内置 bash 无路可走（内容包无代码，D-017；MCP 转接是功能级替代，不是替换）。dsh 现役实证了更开的路线：AI 写真实代码组合包、`plugin_manager` 的 `install_bundle` 经 pnpm 装进 profile、patch 按 id 覆盖内置行，信任靠闸不靠进程隔离——每次操作审批升权（dsh `tools.ts:39-43`）、构建脚本单独批准（`README.zh.md:64`）、peer 兼容门 + `acceptRisk` 豁免（`:69-71`）、装前 `inspect` 预览（`:48`）、失败回滚（`:104`）。项目所有者拍板："AI 写的肯定要能进入引擎"；16 个官方插件（含内圈 5）全部可换——"一般情况下没人去换的，但是要能替换"。
- **决定**：
  1. **版本目录新增 `engine/` 槽位**（与 skills / commands / hooks / mcp / agents / ui 平级）：AI 创建的插件可带引擎代码——缺省入口 `engine/main.js`，清单可选 `engine.entry`（对称 `ui.entry`）；`engine/` 是标准 Node 包目录（可选 `package.json` + `node_modules`）；装载与 `ui/` 同构（宿主 `import()` 加载，不 eval，D-021 规矩照搬）；认领者 = 装配层（config-loader / kernel 装配）；**AI 写引擎代码用与官方同一套 API**（defineTool / ServiceDefinition / 挂事件 / 占槽位）——P8 同权字面成立。原"index.js 保留的代码入口"占位行作废；
  2. **依赖放开**：`engine/` 零依赖单文件，或有依赖 `package.json` + `node_modules` 皆合法；**安装 = AI 自己经 shell 工具跑 `pnpm install`**（走既有审批链，用户看得见命令），装载器零安装机器；`pnpm-lock.yaml` 留在 `engine/`（换机可复现重装）。**唯一硬规矩：`@reins/kernel` 与 `@reins/protocol` 不得进依赖表**——一个 harness 只能有一个内核实例，插件自带副本必炸；宿主经 import map 注入唯一实例（与 `ui/` 模块的 react、D-043 官方界面件出口同一口子）；
  3. **替换 = 同 id + `engine/` + 确认卡（显式，非静默）**：用户包 id 与官方插件相同且带 `engine/` → 新会话装配时弹确认卡（写明替换谁、代码路径、依赖数），确认才装载、拒绝则官方照常；**确认卡版本升级重弹**（代码变了重新确认），同版本只弹一次；生效后管理面显示"已被用户插件替换（来源 + 版本）"；优先级 = 项目插件 > 用户插件 > 官方 npm（D-032 精神从素材层延伸到引擎层）；
  4. **兜底永远在**：用户件装载失败 / 崩溃 → 标损坏 + 告警 + **自动回落官方实现**（D-043"官方默认组合永不缺席"同精神）；关掉 / 删掉用户包 → 官方自动回来；16 个官方插件（**含内圈 5**）适用同一套规则，无特例；
  5. **兼容门**：`plugin.json` 可选顶层 `engine` 字段（如 `"engine": "^0.1"`），装载时校验，不符 → 跳过 + 告警，不阻断其他插件；
  6. **边界**：同 id **纯内容包**（无 `engine/`）不构成引擎替换（没有可换之物，D-032 素材层照旧）；不同 id 的包注册与已启用插件同名工具 → 报错、该包不装载、提示先关官方。
- **理由**："一切可换"的承诺必须对全部用户成立，只对会写代码的人成立等于没承诺；dsh 用现役产品验证了"AI 写引擎代码 + 审批闸管信任"可行；D-016 当年否决的是"静默顶替"的魔法机制，不是"用户想换"的需求——显式确认把两者接通。信任靠闸（确认卡 + 审批链 + 兼容门 + 回落）不靠隔离。
- **修订**：D-016 第 4 条"不做目录自动顶替"收窄为"不做**静默**顶替"（同 id 且带 `engine/` 经确认卡可替换，本条）；D-017 第 2 点"不做 node_modules 随目录"与第 4 点"纯内容包 / `ui/` 唯一代码口子"由本条修订（`engine/` 为第二个代码口子、可带依赖）；D-032 同名插件条款补"带 `engine/` 经确认替换官方"；D-029 管理面补确认卡与"已被替换"显示。
- **备注**：[plugins.md](./20-architecture/plugins.md) §1 / §2 / §3 / §4 / §5 / §6 / §7.1；[data-directory.md](./20-architecture/data-directory.md) §2 / §5；50-open 归档。
- **后续修订**：**D-049** 能力服务化——"与官方同一套 API"落实为 defineTool + ServiceDefinition + **注入能力服务**（官方与第三方同权）；替换语义增**两级粒度**（换工具件 / 换服务件，同一套确认卡与回落官方）；官方件计数 16→21 见 D-049。

## D-049 能力服务化：能力一律服务、按族拆包

- **状态**：已定 · 2026-11-15
- **背景**：D-048 开放第三方引擎代码后，"AI 写的工具如何复用官方能力"成为真实需求；现行"路径围栏在工具内部"（D-039）让每个工具包自带实现，第三方只剩抄代码或裸写 Node 两条劣路。dsh 全库取证（2026-11-15）：约 **60 个服务**构成其骨架——`packages/fs/` 下契约（fs）/ 本地实现（fs-local）/ 只读策略（fs-observation-policy）/ 围栏（fs-sandbox）/ 三个工具包（tool-fs、tool-fs-search、tool-str-replace-editor）各居其位，工具包 `inject = ['tools', 'fs', …]`、头注释自陈 "never a concrete provider"（`tool-fs/src/index.ts:23`）；shell 同构（契约 + local / sandbox 实现 + 四个工具包，tool-bash 注入 `shell` / `shellEnv`）；连单消费者的 compaction 也是服务（消费者 command-compact 在另一个包）；todo 工具注入 `sessionProjections`（任务状态 = 会话日志投影，与我们"日志是事实源、对不上按日志重建"同构）。项目所有者拍板："直接搞成服务啊，为啥又要搞两种"——单消费者也直接服务化，不做两轨道。
- **决定**：
  1. **官方插件对外提供的能力一律为服务，只有一种写法**（单消费者亦然，不做"先包内私有、后升级"两轨道）；"包内私有"仅指包内部普通辅助代码，不构成第二种共享机制。**东西不是服务，拿东西的通道才是服务**——工具 = 注册表里的行、UI 组件 = 挂槽的件、内容 = 被读者读的素材，三者永远不是服务；
  2. **跨包共享必经服务**：消费者在引擎模块导出声明注入（`export const inject = [...]`，dsh 同姿势），manifest 不复写（单一事实源）；**装配层预检**——声明注入的服务在装配结果里无提供者 → 该引擎件不装载 + 告警（坏插件同款：不挡其他插件）；kernel `start()` 的 inject 静态检查仍是最后防线；
  3. **服务清单开放不封顶，第三方同权**：官方清单随各插件设计文档增长；AI 创建的插件同权消费与提供服务（D-048 API 集 ServiceDefinition 已含）；新增**能力服务槽位接口** = 该插件设计文档的一部分（本条授权，不逐个立 ADR），内核承重槽位 / 核心包照旧须 ADR；
  4. **首批 fs / shell / tasks**（契约小节 M4 / M5 落码前在 interfaces.md 定稿——活文件规矩）；排队：subagent（M5）、fetch（M5）、skills（M6）、commands（D-025 已是服务）、workingDirectory（升服务，随 fs 批议）；compaction / memory / checkpoint 依同一规矩在其设计文档批次落；mcp 管理器包内私有（工具走注册表即可）、hooks 的共享机制本就是事件缝（挂缝），不需服务化；
  5. **围栏跟着能力走**：路径围栏住进 fs 能力服务，注入者皆受围栏（修订 D-039 第 3 条的表述——当年争的是"围栏放哪"不是"能力归谁"，本条把围栏归入能力层）；只读 / 沙箱类策略将来包在服务外层即可全体生效；
  6. **替换两级粒度**：换工具件（只换一盒工具）或换服务件（整个换能力实现、注入它的工具件全体跟着换），同一套 D-048 确认卡与回落；**内圈 5 不变**——fs / shell / tasks 是普通可换可关官方件提供的服务，关掉服务件 = 注入它的工具件不装载 + 告警；
  7. **界面挂点 = 界面侧服务**：UI 门面方法是其调用形状（语义统一，不推翻 13 方法）；theme / shortcuts 等界面词表 M3 界面批对齐公开实现清单逐个定；
  8. **按族拆包**（包的自然边界 = 共享同一套配置与实现辅助的一家人，dsh 判据同款）：fs 留名瘦身为**服务件**，read / write / edit 拆为 `plugin-fs-tools`、glob / grep 拆为 `plugin-fs-search`；shell 拆服务件 + `plugin-shell-tools`；tasks 拆任务服务件 + `plugin-plan` + `plugin-todo`（对齐 dsh todo / plan 独立；当年"计划任务合一个插件"的理由——共用"一条主线"状态——由任务服务承接，顾虑消解）；**官方件 16 → 21**（语义 5 + 能力 11 + 读者 4 + 界面 1），全部计数复写点同步；
  9. **装配清单是配置不是插件**：出厂清单 / `reins.config.ts` / settings 开关是挑插件的表，不做 dsh"preset 亦为插件"的形状。
- **理由**：开放性是产品本身——能力不做服务，第三方复用只剩抄代码或裸写两条劣路；dsh 用约 60 个服务的现役结构证明"能力 = 服务、工具 = 消费者"成熟可行；服务化顺手解决四件旧事：**写者席位**（任务服务 = `plans/` `tasks/` 唯一写者）、**替换粒度**（两级）、**P8 同权**（官方工具件自己也只是服务消费者，"同一套 API"字面成立）、**策略一刀切**（只读 / 沙箱包服务外层全体生效）。
- **修订**：D-039 第 3 条围栏表述（围栏跟着能力走）；D-048"同一套 API"与替换两级粒度；D-041 批次计数（首发 7→10、二批 4→6，名单与时点不变）；50-open"计划与任务是一个插件"归档行补注记。
- **备注**：[plugins.md](./20-architecture/plugins.md) §1 / §3 / §4 / §5 / §6.3 / §8；[interfaces.md](./20-architecture/interfaces.md) 能力服务小节；[packages.md](./20-architecture/packages.md)（按族重组树 / 两圈 / 职责表 / 依赖方向 / 依赖规则）；[data-directory.md](./20-architecture/data-directory.md) §2.2 / §5；40-roadmap.md M3–M6；principles.md P8；50-open 归档。

## D-050 文案语言：界面多语言架子先行，引擎消息定英文

- **状态**：已定 · 2026-11-15
- **决定**：
  1. **界面文案多语言，架子先行**：用户可见文案从 M3 第一行界面代码起走 locale 词表（组件按键查字典取文案，不写死在组件里）；**首发唯一语言 = 中文**（字典只有 `zh` 一份）；追加语言 = **新增一份字典文件，不动机器**——架子是多语言的，内容是单语的。判据可机器验：界面代码里 grep 不到写死的裸文案。
  2. **引擎消息定英文、永不本地化**：引擎与插件吐出的错误消息、日志文本用**英文**书写——它们进日志、issue 报告、模型上下文，要求稳定、可搜、可比对；技术错误翻译易失真；现代模型的理解不依赖 locale。UI 只本地化"包装句"（"出错了""已拒绝"等界面框架字，在词表里），错误细节**原文展示**（VS Code 同款：中文的"出错了"＋英文的技术细节）。
- **理由**：分界线在受众。界面文案的受众是最终用户 → 多语言是产品承诺的一部分；引擎消息的受众是模型与开发者 → 稳定性压倒本地化。架子先行成本 ≈ 0（字符串抽取从第一天做），写死中文后补 = 全界面返工；翻译内容按需追加，不预付。
- **边界**：docs/ 正文仍中文先行（D-009），README 双语照 M0 / M4 排期（本 ADR 不管仓库文档翻译）；模型对话语言由用户输入决定，与 locale 无关，不在本条范围。
- **备注**：40-roadmap.md M3（内容 + 判据）；文案词表的具体形状（字典文件放哪、切换入口）随 M3 界面批定稿。

## D-051 事件注册表校验器：最小 duck 接口，zod 退到实现侧

- **状态**：已定 · 2026-11-16 · 修订 D-044 备注"连带确认"段（项目所有者在 M1 protocol 定稿时重拍）
- **决定**：`SessionEventRegistry` 的校验器用**最小 duck 接口**——protocol 只定义"会 safeParse 的校验器"结构，不认任何 schema 库：

  ```ts
  interface EventValidator {
    safeParse(data: unknown):
      | { success: true; data: unknown }
      | { success: false; error: unknown };
  }
  ```

  官方 15 个事件变体由 `session` 包用 zod 实现并注册（zod 是实现细节，不进协议词汇）；插件可用 zod / valibot / 手写校验器，结构满足即可。工具参数声明仍按 D-044 收裸 JSON Schema，不受本条影响。
- **理由**：事件注册表只做 append 校验与派生清单，不面向模型投影 / MCP——D-044 的"同形零转换"理由在事件层不成立，取证三家无一在事件载荷上用 JSON Schema；唯一在读写两边界做全量校验的 [opencode] 用的是 Effect Schema（zod 类库，`packages/core/src/bus.ts:328,619`）。protocol 是每个插件的公共依赖：零依赖 + "只认形状不认牌子"与 D-012② / D-013③ 最小化同向，schema 库升级不再牵动协议 API 面；原"连带确认"的论据（进程内引擎插件经 import map 已带 zod）在 duck 接口下不再必要——插件根本不必带 zod。
- **备注**：
  - [dsh] 明确拒绝过运行时事件名注册并记录理由（`packages/core/session/src/known-event-types.ts:15-20`：注册"不区分省略安全性、会让读取依赖插件组成"）——但其插件与内核同仓编译，TS 声明合并即可扩展；我们的插件运行时装载（D-048 `engine/`），运行时注册是架构等价物。读取依赖插件组成的担忧由读侧 fail-closed 规则堵死：未知类型 ignorable:true 恒跳过、否则恒拒（[dsh] `packages/session/session-persistence/src/storage-contract.ts:74-80`，与 [session.md](./20-architecture/session.md) §3 同构）——同一份日志的读出与插件组成无关。
  - 派生清单照旧全部从注册表派生（P9-5）。落点：interfaces.md protocol 段、principles P3 / P9-5、packages.md 依赖规则、session.md §3。

## D-052 文档粒度：包 README 随包诞生，提交自带文档

- **状态**：已定 · 2026-11-16 · 修订 AGENTS.md「文档粒度」表「包」行
- **背景**：M2 引擎闭环落了 10 个包与仓库最早出生的两个工具（examples 的 echo / list-cwd 演示工具），包 README 一个没有、工具 md 一个没有——AGENTS.md 粒度表「包」行的时点写的是"M4 起（npm 硬要求）"，把欠账合法化了；工具行规矩虽对（随包诞生）却没有机械闸，计划交付物漏排即漏写。对照：[dsh] 每包 README 是铁律（全部包无一缺席，包 README = 每包的事实卡）。项目所有者拍板：改规矩 + 当轮补齐欠账。
- **决定**：
  1. **包 README 时点 M4 → 随包诞生**：每个 workspace 包（packages / plugins / examples）自带 README.md，内容四件——职责一句话 / 槽位与契约出处（→ interfaces 小节）/ 文件 ↔ 设计映射 / 判据 ↔ 测试映射；npm 硬要求只是下限，不许欠账；
  2. **提交自带文档**：新包提交含 README，新工具提交含 `tools/<名字>.md`；修改先改 md 再改码——AGENTS.md 总纪律"四层贯穿"扩为五层（功能 / 包 / 工具 / 接口 / 决策）；
  3. **机械闸**：`pnpm check:docs`（CI 同跑）——每个包目录必须有 README.md；src 里声明的每个工具（inputSchema 邻域识别）必须有同名 `tools/<名字>.md`。条文靠自觉，闸门靠 CI——工具 md 欠账的根因就是"有规矩没闸门"。
- **理由**：文档是下一个写码 AI 的入口；欠账随里程碑只增不减，随包诞生是唯一不欠的时点。识别口径取邻域（工具对象的 name 与 inputSchema 相邻，ServiceDefinition 的槽位名远离 inputSchema）——闸门是兜底不是穷举，新形状照旧随包写 md。
- **备注**：AGENTS.md（总纪律 / 文档粒度表 / 命令表）；scripts/check-docs.mjs；M2 欠账当轮补齐（10 份包 README + echo / list-cwd 两个工具 md）。
- **后续修订**：决定 1 的根清单随 **test-support/ 根**加入扩为四根（packages / plugins / examples / test-support，2026-11-16 划位）——测试支撑件（llm-mock 起）住专属根、整根不进发布集；README 与工具 md 闸门（check:docs）与依赖闸门（check:deps）同扫四根。

## D-053 品牌更名：Reins → Henira，npm scope 定案 `@henira`

- **状态**：已定 · 2026-11-16 · 首次公开发布（GitHub push）前的品牌总决
- **背景**：推送前占名普查发现 npm scope `@reins` 已被占（prc5 的 17 个 React 工具包，约 2 年未动）——品牌与发布 scope 只能二选一：改 scope 保品牌（`@reins-harness`，永久疙瘩）或整体换名。项目所有者拍板：**整体换名，造一个独一无二、词根有意义的新词**（"用的人多了就自然顺"，Kubernetes 同款路线）。两轮 16 词普查后 Henira 全绿胜出。
- **决定**：
  1. **品牌整体更名 Reins → Henira**，词源 = 古希腊语 ἡνία"缰绳/马勒"（三源验源），与 Kubernetes（希腊语 κυβερνήτης"舵手"）同族同构：舵手驭船，驭手（ἡνίοχος）驭马——README 第一行的话术。
  2. **改名清单**（全库机械扫换，单条提交）：npm scope `@reins/*` → `@henira/*`；类型 API `ReinsContext` / `asReinsContext` / `ReinsConfigService` → `HeniraContext` / `asHeniraContext` / `HeniraConfigService`；环境变量 `REINS_*` → `HENIRA_*`（模板变量认读清单同步为认 `${HENIRA_PLUGIN_ROOT}` / `${HENIRA_PROJECT_DIR}`）；钩子自有前缀 `reins/` → `henira/`；运行数据根 `~/.reins` / 项目 `.reins/` → `~/.henira` / `.henira/`；配置文件 `reins.config.ts` → `henira.config.ts`；系统提示身份行 "You are Reins" → "You are Henira"；内核日志前缀 `[reins:kernel]` → `[henira:kernel]`。**本条目之前的旧条目（含 `@reins/*`、`reins.config.ts` 等旧写法）为历史记录，一字不改**（append-only）。
  3. **防混闸**：`check:deps` 尾部新增"品牌单一性检查"——除本文件历史条目外，任何入库文件出现 `reins`（任意大小写）即红；CI 同跑。旧品牌写法从此在活代码 / 活文档里不可能复活。
  4. **普查存档（2026-11-16，两轮 16 词；取证面 = npm 散包 / scope / 全文提及、GitHub 工具类目、PyPI / Docker Hub / Homebrew / 域名 RDAP）**：
     - 词典词全灭：Bridle / Rein / Tack（npm 用户名占位）、Snaffle（散包被活跃终端工具占）、bridon（活跃包连带 `@bridon`）、volte（死包占散包名）、farrier（**被活跃 coding-agent harness 工具占**，关键词 claude-code / ai-agents——马具隐喻词典已被同行挖空的铁证）、rienda（西语"缰绳"，GitHub 有同名 Go agent harness 仓）、arnes（西语"马具"，活跃 npm agent 工具 + 多个西语 agent 仓）、lorum（2026-09 被占）、freno（**github/freno 733★ 官方节流服务**）、manege（manage 拼错噪音 4387，可发现性死）、brido（Docker Hub 被占 + 任天堂 Birdo 一字邻 + 1989 年巴基斯坦品牌）、peiran（.dev 2025-10 被注册 + 常见中国人名，非造词）；
     - **Henira 全绿**：npm 散包 / scope / 全文提及零；PyPI、Docker Hub、Homebrew 全空；GitHub 工具类目零撞名（全站仅 2 处无关用户名字母子串）；henira.dev / henira.io 未注册；通用网络仅软件类目之外的小时尚品牌与内容创作者。已知代价：英语读者一眼可能误读为 hernia（搜索引擎不窜，口头一次性纠正成本）。
- **理由**：①类目隐喻词典（英语马具族 + 西语 arnés / rienda + farrier 这类冷词）已被全球同行挖空——Reins 撞名不是名字不幸，是正中类目靶心的副产品，造词是唯一空白区；②造词的 scope 即品牌（`@henira`），"scope 与品牌分叉"和"新旧 scope 混用"两个风险从结构上消失；③词根有魂：缰绳 = 驾驭 AI agent 的本义，与 Kubernetes 的希腊舵手互为镜像，公开话术一行讲完。
- **备注**：scripts/check-deps.mjs（品牌单一性检查）；发布占坑账——npm org `henira` 与 Docker Hub org `henira` 于 M4 发布前注册（免费），henira.com 不追；henira.dev 域名暂缓购买（项目所有者拍板，购买时尽快注册）。作者邮箱卫生（QQ 邮箱 → GitHub noreply 历史重写）属贡献者身份管理，非项目决策，不另立 ADR。
