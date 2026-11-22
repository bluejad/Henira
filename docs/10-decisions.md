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
  3. `useResource` 地址格式 `henira-data://<pluginId>/<mcpServer>/<tool>?args=<URL 编码 JSON>`；宿主 2 秒共享轮询（同地址共用、引用计数、末订阅者退订）；30 秒超时、结果 200 × 1024 字符截断；只允许调用**同一插件 `mcp/` 里声明过的 server**（越权 403）；失败保留旧数据。
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
- **后续修订**：**D-057**（2026-11-17）行级四缝入词表（3→7）；**D-062**（2026-11-18）区域三名正名为宿主代码三名 `sidebar` / `conversation` / `composer`（原 session.top / composer.above / sidebar.right 作废——三名从未在宿主实现，按文档写插件会被静默忽略，两张皮病根除）＋ 结构性槽 `layout` 与右栏 tab 框架入词表（7→10）；第 1 条"不做大矩阵承诺"修订为"结构性槽逐个拍板入表、不预造矩阵"；第 3 条共享核心改为行级三条。

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
- **后续修订**：**D-043** 增官方第 16 个插件 `plugin-web-ui`（界面 1，M3 随 web 诞生，不占三批名额）；本条三批名单与时点不变。**D-049** 能力服务化按族拆包——计数 16→21：首发批 7→10（引擎 5＋fs 族 3＋shell 族 2）、二批 4→6（＋任务族 3、－原 tasks 1），名单与时点仍不变。**D-058** 熔断插件进首发批（2026-11-17）——计数 21→22、首发批 10→11（＋熔断 1），二批三批名单与时点仍不变。**D-074** 提问件 `plugin-ask-user` 落码（2026-11-23，R184）——计数 22→23、首发批 11→12（＋提问 1），二批三批名单与时点仍不变。

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
- **后续修订**：**D-062**（2026-11-18）立**结构性 `layout` 整页框架槽**（官方框架件占槽、同一注册声明子槽，`replaceSlot("layout")` = 整页重排）——本条第 2 点"无'布局槽'"随之修订；区域槽正名 `sidebar` / `conversation` / `composer`（D-033 后续修订同笔）；"宿主 = 框 + 默认装法"升级为"宿主 = 占 layout 槽的官方框架件 + 默认装法"。

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
- **后续修订**：**落码归位（E6，2026-11-21）**——实现初版把 `approval/asked` 落成 12 位 digest（偏离本条「照记全文」备注，当时引 D-030；经核凭据经架构保证不进 args、`tool/call.arguments` 全文进账本已是既有实践），E6 批对齐：`approval/asked` 补 `args` 全文 + `reason`，`ApprovalRow` 同步携带（「挂起自足可渲染」落地）；digest 保留作关联指纹。

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
- **后续修订**：**D-049** 能力服务化——"与官方同一套 API"落实为 defineTool + ServiceDefinition + **注入能力服务**（官方与第三方同权）；替换语义增**两级粒度**（换工具件 / 换服务件，同一套确认卡与回落官方）；官方件计数 16→21 见 D-049。**2026-11-19 批 C 前修订**：第 5 条兼容门字段名 `engine` → **`engines`**（原名与 §3 的 `engine` 段对象撞 JSON key）；第 3 条确认卡范围从"同 id 替换官方"扩为**任何带 `engine/` 的包首次生效及版本升级都弹卡**（新 id 的引擎件 = 任意 Node 代码执行，无卡即无门；同 id 替换场景卡上额外写明替换对象）；确认记录落 `settings.json plugins.<id>.confirmedVersion`，**未确认不装载**（fail-closed）。

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
- **备注**：scripts/check-deps.mjs（品牌单一性检查）。**发布占坑账（2026-11-16 状态）**：npm 账号 `bluejade` 已注册（邮箱 `bluejad@qq.com`，QQ 英文别名——地址本身不编码 QQ 号，过 D-047 同款拟名测试）；npm org `henira` **已注册**（免费计划，scope 落袋）；Docker Hub 账号 `henira` **已注册并验证**（2026-11-16，`henira/` 命名空间落袋）；npm 账号 2FA——暂缓，项目所有者拍板，**M4 发布前必开**（npm 2027-01 起发布强制，已列入 [40-roadmap.md](./40-roadmap.md) M4 前置）；henira.dev 域名暂缓购买（购买时尽快注册）；henira.com 不追。作者邮箱卫生（QQ 邮箱 → GitHub noreply 历史重写）属贡献者身份管理，非项目决策，不另立 ADR。

## D-054 代码组织判据：行数条文废止，职责划界替位

- **状态**：已定 · 2026-11-16 · 修订 AGENTS.md「代码组织」首条（旧条文首见于 M0 骨架期 AGENTS.md，未立过 ADR，本条为其唯一修订记录）
- **背景**：全库审计（2026-11-16）按旧条文"文件 ≤ 200 行 / 函数 ≤ 50 行 / 嵌套 ≤ 3 层"清点出 3 个 src 文件与 9 个测试文件超限。复核发现条文自身缺陷：①不区分 src 与测试——行为矩阵测试天然长，9 个测试文件天天"违规"，与现实打架的规矩养不成公信力；②没有"想完可不拆"的出口——单职责的长文件（如 session/store.ts，一个类、方法皆小）在条文下只能记为欠账，而拆开反而更糟；③行数是职责的坏代理——250 行单职责文件与 150 行混三件事文件都真实存在。项目所有者拍板：**拆分依据从来只能是职责，行数不进条文**；"行数留作私下自查线索"的折中方案也被否——本轮审计中行数先入为主，把 turn.ts 误记为"尺寸欠账"，真实依据（回合骨架与单步执行两件事挤一文件）是读代码读出来的，与 314 这个数无关——锚定效应当场实证。
- **决定**：
  1. **条文替换**：AGENTS.md「代码组织」首条改为"文件与函数按职责划界，不按行数：一个文件 = 一个用文件名说得清的职责；两类变化原因或两类知识挤进同一文件才拆（D-054）"。数字代理（文件行数 / 函数行数 / 嵌套层数）全部清除。
  2. **行数彻底出局**：不进条文、不做闸门、不作审计清点项。"单一职责"与"每包文件布局随 interfaces.md 小节定稿"是仅有的两条布局判据；机械自查的唯一替代 = 文件名能否一句话说清内容（读文件头顺手即查）。
  3. **审计判词重排**：旧条文下的"尺寸欠账"群（turn.ts / store.ts / harness.ts / deriveMessages / approval requestPermission 等）中，仅**职责混装**者留存为发现（turn.ts 一个）；其余按新判据不是问题。测试文件不受任何行数判据约束，判据 = 一文件一行为矩阵、矩阵拆了才算坏。
- **理由**：按行数拆会拆出错的边界——一个 300 行单职责文件好过四个 50 行碎片：跳转与状态追捕成本高于滚动成本。错误边界引入的间接层是永久税，长文件只是滚动税。布局已有契约管（interfaces.md），职责已有条文管（单一职责），行数闸是叠加其上的粗糙代理，且对 AI 码工产生锚定伤害（先见数字后凑理由）。
- **备注**：AGENTS.md「代码组织」首条。本轮审计（2026-11-16）报告的判词按本条重排；修码类发现（引擎文案英文 / durationMs 假值 / 死导出 / 测试竞态等）不受影响照旧成立。
- **后续修订**：principles.md P7「体量目标 < 1000 行」为本条漏网残留——kernel 体量边界改由机制面清单封顶（清单外按需增、立 ADR 再加），行数目标清除（2026-11-17）。

## D-055 投影器与 ServerEvent 行词表落 `@henira/protocol`（追认）

- **状态**：已定 · 2026-11-17 · 追认（迁移在 M3 落码期执行，本条同日补记）
- **背景**：M3 渲染架构定案（行模型核心与 ZCode 同构）后，投影器最初规划为"server 包内部模块"（interfaces.md 初稿原文如此）。落码时发现 sdk 双形态的进程内形态（createRuntime）需要同一套事件→行组装逻辑——行为一致测试锁定（D-037）的结构前提是组装逻辑只有一份。若投影器住 server，sdk→server 直依违反宿主互不依赖规则（packages.md 规则 3；仅有的两个例外是 cli→server 与 web→plugin-web-ui 件出口）；双方唯一可依的公共层是 protocol。迁移随 M3 提交执行，但只改了 packages.md / interfaces.md 正文与两包 README，未立 ADR——2026-11-17 项目所有者问"文档是否和代码一致"，逐段核对暴露三处偏差，同批发现此结构性搬迁无 ADR 轨迹，追认补记。
- **决定**：
  1. **projection.ts**（ingest / applyStreamDelta / snapshot / rebuildProjection）与 **server-events.ts**（5 行类型 / 封闭增量 4 操作 / ServerFrame 帧信封）住 `@henira/protocol`，测试 projection.test.ts 同包；消费方 = server（宿主①）与 sdk（createRuntime③）。
  2. **protocol 职责表述随之扩准**："契约" = 槽位接口 + 事件信封与词表 + 跨插件 DTO + **事件→行投影纯函数**。投影器零 IO / 零 Node API，运行时零依赖不变（packages.md 规则 1）。protocol 最小化规则（D-013③"谁和谁必须一致？"）在此的答案：server 与 sdk（及未来一切宿主 / 嵌入方）必须对"账本→UI 行"的组装一致——一行两处实现必然漂移，与 P9-5 禁两处手抄同源。
  3. **不变式**：投影器不得引入环境依赖（时间 / 随机 / IO）；行构造与增量产出的唯一入口在 protocol，宿主只消费——fanout 只编发 seq，registry 只喂数据，都不自建行。
- **理由**：行为一致是 sdk 双形态的产品承诺，组装逻辑唯一实现处是它的结构前提。把投影器当"契约的可执行规格"而非"逻辑破例"，protocol 的纯度表述才站得住——packages.md protocol 行"不含执行逻辑"的边界据此以"投影纯函数除外"理解；若未来出现第二种需要环境依赖的共享能力，再议拆包，不预建。
- **备注**：同日一致性核对入库 f16ca31（UserRow.source 开放词表 / 回环三件套删 cookie 换发半句 / 投影器住址表述 / protocol–server 两 README 文件表迁移漏登记补齐）。本条同时是"结构性搬迁必须立 ADR"的追认实例——后续迁移类改动拍板即记，不留正文痕迹。

## D-056 里程碑收尾反向核对闸：文档定稿段落逐段对代码

- **状态**：已定 · 2026-11-17 · 修订 AGENTS.md「裁决与验收」段（新增一条）
- **背景**：M3 收尾做了正向核对（判据→具名测试逐条映射）但没做反向核对（文档→代码）。2026-11-17 项目所有者一句"文档是否和代码一致"触发逐段核对，暴露四处漂移：UserRow.source 文档封闭枚举 / 代码开放 string；回环三件套文档写 cookie 换发 / 代码未做；投影器住址文档写 server / 实际已迁 protocol（无 ADR，见 D-055）；protocol–server 两包 README 文件表漏登记迁入迁出文件。共同成因：判据闸只验"判据被测试满足"，不验"文档表述与代码相符"——文档演化落后于代码没有防线，靠人随机发问才暴露。
- **决定**：里程碑收尾固定步骤增一条**反向核对**——对当里程碑定稿的 interfaces.md 小节（或功能设计文档）逐段对代码：类型字段 / 端点面 / 住址表述 / README 文件表逐项相符；发现偏差即改（文档落后改文档、代码越界改码），重要偏差立 ADR 或随收尾批记录。不引入新工具，这是评审闸的人工步骤——check:docs 查"存在与链接"不查语义，本闸补语义层。
- **理由**：文档是下一个写码 AI 的入口（D-052 同源理由），入口失真比没有入口更贵。正向核对证明"产品对了"，反向核对证明"说明书与产品一致"——两者不可互替。
- **备注**：AGENTS.md「裁决与验收」段。M3 的反向核对已按本条于 2026-11-17 补做（f16ca31）。

## D-057 行级挂载点进 v1 词表：工具卡 / 图片画廊 / 回合尾 / 侧栏预览

- **状态**：已定 · 2026-11-17 · 扩定 plugins.md §4 挂载点词表与 interfaces.md web 段（D-033 / D-043 之上叠加，机制不变）
- **背景**：M3 后界面挂载点只有区域级三个（D-033 v1 词表），对话流内部零挂载点——工具卡渲染、消息图片、回合尾呈现、文件预览全是官方实现硬编码，插件不可插。2026-11-17 项目所有者提出"工具输出按类型挂 UI、最终回复富结果呈现（网页内容 / 表格 / 图片 / docx / pptx）是否该有挂载点"。取证 dsh：整套 web UI 走 keyed slot 注册（自身界面就是内置插件，同一注册路径）；工具卡按工具名分发，55+ 内置工具卡即内置件注册、外部插件同名顶替；消息图片画廊本身是插件位（无注册则不渲染）；回合尾扩展位承载交付卡 / 富结果呈现；侧栏文件预览按扩展名分发且插件实现排官方之前；markdown 正文本体不可插（内置固定渲染）。结构对照：双方"官方界面 = 真插件"同构（D-043 ↔ dsh shipped-UI），差异只在 dsh 做穿了行级、Henira 只做穿了区域级。
- **决定**：
  1. v1 词表 3 → 7：新增行级四——`tool.call.view.<工具名>`（keyed 工具卡）· `conversation.images`（图片画廊单槽）· `turn.tail`（回合尾追加位）· `sidebar.right.preview.<扩展名>`（keyed 侧栏文件预览）。词表开放集合不变（D-033），keyed 词表按前缀识别（前缀合法、后缀自由）。
  2. **keyed 槽占用语义**：官方内置件默认占用；插件 `replaceSlot` 顶替，卸载 / 停用自动回落官方；同 key 第二家 → 报错不装载 + 告警（与 D-022 唯一占用、D-048 回落官方同语义，无新规则）；安全模式（双击 Alt / `?ui=safe`）行级缝全部收起回落默认渲染（defaultParts 编译期出口占位）。
  3. **`turn.tail` 是追加位**：`registerSlot` 多件共存按 `order` 排序——最终回复的富结果呈现（交付卡 / 网页 / 表格 / 文档卡）挂此处，追加不改写回复正文。
  4. **markdown 正文本体不可插**：`renderMarkdown` 保持宿主门面方法，正文渲染永远是官方实现——可插的是容器（工具卡 / 画廊 / 回合尾 / 预览）不是内容（dsh 同款边界）。
  5. **`chat.node` 式整行替换不进 v1**：插件能整体换掉任意消息行渲染就绕过宿主渲染管线，与界面统一视觉系统冲突；将来有真需求再议（词表开放集合，届时加 key 不改机制）。
- **理由**：机制零破坏——行类型词表（protocol）与宿主门面 13 方法全不动，纯渲染侧扩展；占用语义全部复用现成规则（replaceSlot / D-048 回落 / 安全模式收起），唯一新形状是 keyed 前缀识别。富结果取追加位而非正文替换，与"UI 不是第二个对话窗口"的输入单口纪律（D-042）同向：插件呈现结果，不改写模型的话。
- **备注**：plugins.md §4（挂载点词表 / keyed 前缀识别 / keyed 占用语义 / ui.slots 取值）＋ §7.2（宿主槽位词表七个 / 共享核心五个）、interfaces.md web 段与 UiModuleContext。落码随 M4 界面优化轮（四缝的官方默认件 + 缝位接线），此前行级缝不生效。
- **后续修订**：**E6（2026-11-21）增 `approval.view.<工具名>` 审批卡缝**——词表 v1 7 → 11 的最新一步（D-062 结构性 8/9/10 之后）；官方 per-tool 审批卡八键注册进缝，插件 `replaceSlot` 顶替、卸载回落通用卡（R163 slot-registry 顶替语义直接复用）；占用语义与第 2 点同款零新规则。

## D-058 熔断插件进首发批：v0.1.0 默认装配死循环兜底

- **状态**：已定 · 2026-11-17 · 修订 D-041 批次表（首发批 10→11，官方件 21→22，二批三批不变）；50-open 🟡 销账。**✓ 已落码（2026-11-20，D-065 批）**——双机制（回合内提醒 user/message{source:"breaker"} + 回合尾 bail 否决注入续跑提示）、阈值默认 50/3/2 且 settings 可配、进 defaultPreset
- **背景**：D-045 定回合步数上限**默认不设**、死循环全靠熔断兜底；D-013⑤ 定熔断 = 官方插件走 `loop/turn-stopping`（bail）缝（principles.md P7：bail 的真实用户就是官方熔断插件）。但官方件清单与三批排期均无此件（2026-11-17 架构评判抓出）——bail 缝语义 M1 起有测试锁定，生产消费者却缺位：v0.1.0 默认装配的死循环保护为空，模型抽风无限重试 / 连烧 token 时无兜底。50-open 🟡 挂"批次归属 M4 前拍板"，2026-11-17 项目所有者拍板：按建议进首发批。
- **决定**：
  1. **首发批第 11 件**：`@henira/plugin-breaker`（熔断件），与引擎五件同批、进 defaultPreset——v0.1.0 默认装配自带死循环兜底；熔断阈值**默认必设**（D-045 步上限不设 ≠ 熔断不设——兜底件本身就是那条兜底），数值随 M4 落码定、settings 可配。
  2. **实现缝**：回合步数 / 同形工具调用重复检测，超限经 `loop/turn-stopping`（bail）否决回合结束并注入续跑提示（D-013⑤ 语义的首个生产消费者）；熔断发生进对话流一行可见（P2 失败可见）。
  3. **边界**：不做审批策略（approval 的事）、不做用户中断（中断纪律的事）。
- **理由**：①发布安全面——v0.1.0 公开发布，用户第一次用就撞上模型死循环烧 token 而无兜底是口碑风险，兜底属于安全默认（D-010"官方默认 = 安全默认"的组成部分）；②件小——bail 缝语义已锁定，熔断件只是首个生产消费者（检测逻辑 + bail 否决 + 事件行），工作量小；③不动结构——首发批 10 是"引擎 5 ＋ fs 族 3 ＋ shell 族 2"的结构数，加熔断是第 11 件；二批三批名单与时点不变。
- **备注**：D-041 后续修订、roadmap M4 内容行与 M6 判据计数、packages.md 树 / 两圈 / 职责表 / 计数、principles.md P8 计数（守护 1）、plugins.md 计数三处、interfaces.md defaultPreset 注释、50-open 归档与 serial 条 bail 注记——同批修订。

## D-059 语言包与主题包：界面资产纯内容槽位（设计定稿，落码随需）

- **状态**：已定（设计） · 2026-11-17 · 增 plugins.md §4 两槽位（locales / themes）；**落码随需——不进任何里程碑判据、不占 D-041 批次名额**
- **背景**：界面扩展面经 D-057 落到七个位置挂载点，全是"往界面上挂东西"，没有"换界面自身资产"的缝——多语言（D-050 词表化自第一行做了，设置浮层语言下拉已留但 disabled，只有官方 zh）与主题（tokens.css 变量组机制 = 换 `data-theme` 即换变量组，实装只有官方明 / 暗两档）都没有第三方注册路径：今天 AI 做一个日语语言包或第三套主题，无处生效。项目所有者提出"AI 做个其它语言插件，插件管理里安装就能切换语言；主题同样意思"——2026-11-17 拍板按纯内容槽位设计定稿，实现等需要时再做。
- **决定**：
  1. **两个新内容槽位**（与 skills / commands 同级的纯素材槽，无代码）：`locales/<lang>.json`（语言字典，顶层 string→string 映射，键集 = 官方 zh 词表同键）· `themes/<名>.css`（主题变量组，`.henira-app[data-theme="<名>"]` 一组 CSS 变量，结构同官方 tokens.css）；
  2. **读者 = 官方界面件**（唯一消费者）：web 宿主装配时扫已装插件的这两目录，设置浮层语言 / 主题下拉列"官方默认 + 已装项"；同一语言 / 主题 id 多包同层 → 按插件 id 字典序靠前者赢 + 告警（§7.1 同款口径），跨层 项目 > 用户（D-032 口径照旧）；
  3. **降级语义**：语言字典缺 key **回落官方 zh**——语言包是内容不是逻辑，缺翻译降级显示中文，不 fail-loud 崩界面（与 `t(key)` 缺 key fail-loud 的分界：那条管代码漏键，这条管第三方字典不全）；主题**官方 light / dark 两档永在、不可覆盖**（总得有回落），第三方方案只是追加进下拉；
  4. **settings 形状加法**：`ui.theme` 从 `"light" | "dark"` 扩为任意已装主题 id、`ui.locale` 从缺省 zh 扩为已装语言 id（字符串位，默认值不变 zh / light）；**安全模式**（双击 Alt / `?ui=safe`）回落官方默认组合——插件语言与主题全部收起（defaultParts 同款口径）；
  5. **边界不变**：引擎消息永英文、永不本地化（D-050 第 2 款）；判据⑥ check:ui-locale 不变（代码剥离注释后零 CJK、字典文件是唯一允许地——第三方语言包是内容，不在闸的扫描范围）；纯内容包无 `engine/` 不弹确认卡、不构成替换（D-032 / D-048 照旧）；资产经宿主静态路由伺服（与 `ui/` 同一套：只读版本目录、禁路径穿越，D-030）。
- **理由**：AI 创建 = 安装（D-029）与"做个语言包插件装上就能切换"天然同构；纯内容槽是最短路径——语言包就是一个 JSON、主题包就是一段 CSS，零代码、零确认卡，也没有"资产里藏可执行代码"的面（对照 dsh 动态 UI 包 `new Function` 闭包求值，我们不采用那套）；机制底子全是现成的（词表化 D-050 / 变量组主题 / 嵌入方零样式依赖），缺的只是注册缝，落码是纯加法（读者扫描 + 下拉接线 + settings 形状扩展），不碰行模型、协议词表、13 方法门面。
- **备注**：plugins.md §4 槽位表与校验表两行、interfaces.md web 段视觉语言资产缝条。**落码随需**：触发 = 真实多语言 / 第三方主题需求出现，或生态需要一个低门槛示范品类时；落码前这两个槽位合法但不被读取（AI 创建无害、暂无效果）；落码时 settings 形状扩展同步进 data-directory.md §2.3；不进 roadmap 判据。
- **后续修订**：**已落码**（M4 批 A，2026-11-17）：scanUiAssets 住 config-loader（server + sdk 共用）、`GET /api/ui-assets` 清单与资产伺服两端点、设置浮层主题 / 语言下拉接已装包、makeT 缺 key 回落官方 zh、安全模式回落官方默认；data-directory §2.3 settings 形状已随步。

## D-060 目录登记与全局目录浏览：侧栏「目录」区的数据底盘与信任边界

- **状态**：已定 · 2026-11-18 · data-directory §4 projects.json 首落地；50-open 无挂账
- **背景**：用户拍板侧栏三件（2026-11-18）：①目录上方放「所有登记目录」，悬浮区头出「新增目录」，选目录走服务端目录树（浏览器可拿完整路径）；②悬浮目录行出 ＋ 新建会话；③右键目录/会话起码可删。取证底账：ZCode「项目」区（hover 显隐 / 右键非模态菜单 / 软删）与服务端目录区（目录树弹窗 / 确认弹窗+busy 守卫 / session.create 自动登记）。实现底盘缺口：server 零 DELETE 路由、projects.json 文档定稿未落地、全局目录浏览无端点。
- **决定**：
  1. **登记表 = data-directory §4 projects.json**（形状照文档定稿，一字不改）：`DirRegistry` 住 plugin-session（账本域共享知识——server 与 sdk 双宿主消费，规则 3 禁宿主互依的正确解是下沉引擎层，不在两宿主各复制一份 projectKey）；**可自愈**：list 时扫账本会话头复活缺失条目；`session.create {cwd}` 成功即自动 upsert；
  2. **全局目录浏览端点 `GET /api/dirs/browse?path=`**：一层 readdir、隐藏项不返、只回目录、`__drives__` = win32 盘符枚举。**信任边界 = 回环三件套**（只绑 127.0.0.1 + Host/Origin 校验 + 可选 token，D-035 判据⑤在所有 /api/* 之上已生效）：本机信任模型下给浏览器补「选目录拿完整路径」的能力——浏览器 File System Access API 拿不到绝对路径，服务端代列是唯一通路；实现住 plugin-session `browseDirectories` 共享函数，双宿主同语义；
  3. **删除语义双轨**：`DELETE /api/sessions/:id` busy → **409 + `session_busy`**（单资源硬拒）；`DELETE /api/dirs/:id` busy → **200 + `{ok:false, blocked:[busySessionIds]}`**（批操作语义响应，不抛 4xx）。删目录 = projects/&lt;key&gt;/ + checkpoints/&lt;key&gt;/ + 登记条目三处同删（data-directory §7），**盘上工作目录本身不动**；key 只从登记条目取 + registry 形态闸兜底（杜绝任意路径删除）；删会话 = 账本目录整棵（§7 已定稿语义）；
  4. **web 侧 feature-detect**：`HeniraClientLike` 加五个可选方法（listDirs/addDir/deleteDir/browseDirs/deleteSession），宿主**五方法齐备才渲染目录区交互**，缺任一退化纯 cwd 分组（模型选择器三可选先例同款——不做半可用状态）；
  5. **确认弹窗不学 ZCode 两击原位确认**：我们是硬删（fs.rmSync 不可恢复），ZCode 软删才敢无弹窗——删除一律模态确认，目录删额外列明删除范围 + busy 红框禁用。
- **理由**：文档先行——data-directory §4/§7 一年前就把形状和删除语义定稿了，本批是兑现不是新设计；下沉 plugin-session 让 runtime 形态零复制拿到同语义（facade.test 双形态一致套件锁定）；信任边界沿用回环三件套不新增防线——全局 readdir 的暴露面是目录名列表（无文件内容），在只绑回环 + token 的既有模型内可接受；若将来对公网开放（显式配置才可能），browse 端点应随部署面重审。
- **备注**：interfaces.md server 段 REST 面（四个新端点 + DELETE 方法入面）、sdk 段门面方法表（14→19）、web 段侧栏目录区形态条；data-directory.md §4 标注已落地；测试：server.test 五用例 + facade.test 双形态两用例 + parts.test 五用例。ZCode 有而不做（范围控制，随批记）：重命名/置顶/归档/拖拽排序/搜索/视图筛选/⋯按钮/「查看文件」。
- **后续（2026-11-18 删除 500 修复）**：用户实测删目录偶发 `DELETE /api/dirs/:id — 500`。**真根因（用户二次实测曝光）：`removeProject` 形态闸正则 `[A-Za-z0-9._-]` 只认 ASCII，而 projectKey 的 slug 本就保留 CJK 目录名——中文目录 key 全被判「非法」必 500**（英文目录一直能删，「有时候删不掉」的真相；修复 = 闸的本义是路径安全（key 进 path.join），拦路径分隔符/NUL 即可：`/^--[^\0/\\]{1,120}-[0-9a-f]{8}--$/`，CJK 合法；回归测试用中文 mkdtemp 前缀全链路锁死）。修复过程中顺带排掉三枚真实隐雷：①`DirRegistry` 读写零互斥 + 固定 `.tmp` 名——并发写者（双击重删 / 删除撞侧栏 list 自愈回写 / 撞建会话自动登记）第二个 rename 撞 ENOENT → **写互斥 promise chain + 唯一 tmp（pid+时间戳）+ rename EPERM 退避**；reconcile 扫盘（全树逐会话头读）挪到锁外，锁内重读合并防丢更新；②`fs.rm` 无重试——Windows 目录被进程占用（另一 serve/CLI 钉着该树）EBUSY 偶发 → **rm `maxRetries:5, retryDelay:100`**（测试用子进程 CWD 钉树确定性复现——Node 自身句柄带 FILE_SHARE_DELETE 拦不住删除，OpenHandle 模拟不成立）；③路由无 try/catch → 裸 500 无形状 → **删除两端点失败返 500 `{error:"delete failed", detail}` + serve 终端打印堆栈**，sdk client 抛错消息带 detail（UI「删除失败：」直接显示真实原因——正是这个 detail 让真根因一眼曝光）；附带 `registry.create` cwd resolve（未归一拼写使会话树 key 与登记 key 分叉——漏 dispose 或树漏删被 reconcile 复活的隐雷）。教训两条：Node 对 Node 的文件句柄全带 share-delete，「句柄占用」类排除先验证句柄来源，别拿自家进程模拟他者占用；**复现环境必须贴近用户真实输入形状——用户目录全中文名，取证脚本用英文临时路径就把唯一真根因完美避开**（错误体 detail 早一点上，root cause 早一轮落网）。

## D-061 长会话渲染：行翻页 + 虚拟滚动（三家取证与取舍）

- **状态**：已定 · 2026-11-18 · 批 A'（界面批收尾补课）；50-open 性能实测条保持挂账
- **背景**：用户问「中间对话是否像 ZCode 分页拉取」→ 取证发现我们快照全量 + DOM 全量直通（几百轮会话首屏大、DOM 节点多、每帧全表重渲）。用户拍板「不要 demo 玩具思路——参照物做了什么就做什么」。取证底账：**ZCode**（docs/ui/chat-virtual-scroll.md 两份设计文档 + 实测数字：30 轮 20 次更新 row 执行 440→20、千轮搜索长任务 775→78ms；ConversationTimeline.tsx 2268 行——虚拟单位=轮、行高缓存 LRU 4000、bottom-lock 状态机、四源滚动意图、搜索定位协调）；**dsh**（SessionPageRequest `beforeSeq`+`maxMessages:50`+`turnWindow`，session-controller/src/history.ts:1「Cold Session history pagination」；主对话不虚拟化——每页 50 条够轻的场景赌注；TurnNavigator 固定行高虚拟化）；**两家同构处**：数据分页完全一个形状（游标=账本事件 seq、页 50-60 行、按轮边界切页、前插防跳顶）——账本事件溯源架构的自然推论。
- **决定**：
  1. **数据分页全抄（三家同构形状）**：行盖 `rowSeq` = 产生它的账本事件 seq（ingest 单点盖章；流式行取已见最大 seq）；快照窗口化尾窗 60（`hasOlder`/`totalRows` 随快照下发）；`GET /api/sessions/:id/rows?before=&limit=`（before=rowSeq 排他、服务端钳 200、页首向前补齐到轮边界——页不切轮）；`totalRows` 客户端自持（delta 追加自增、前插不变）、`hasOlder` 派生 `totalRows > rows.length`——快照帧只在连接时发，跨过窗口边界无帧通知，派生化让 hasOlder 永不过期（真浏览器抓的时序缺口）；
  2. **对话虚拟滚动做轻量版**：tanstack react-virtual（ZCode 同款 ^3.13）+ 虚拟单位=轮（turn 相同行不拆散）+ measureElement 动态测高（estimateSize 一屏兜底）+ overscan 2 + sessionId 作内层 React key（会话切换重挂换测高缓存）；**砍掉 ZCode 复杂度大头**——搜索定位协调（v1 无搜索）、四源滚动意图+TTL（wheel/touch/方向键 capture 解除 + 贴底 48px 恢复 + 回底按钮够用）、多 pane 滚动记忆键、手机布局、编辑重发交接、history/tail 分区缓存（挂账实测）；
  3. **bottom-follow 简版**：解除只由明确上滚手势触发（capture 阶段先于 scroll——程序化写入永不误解除），恢复只看落点距底 48px；dsh 显式「加载更早」按钮不取（滚动自动触发）；
  4. **行引用不可变契约**（store）：未变行同一引用、变化行新对象（row.delta 不再原地 mutate）——RowView/SessionRow memo 的前提；**memo 比较函数必须拆稳定子集**（row + t + host + slots）——ctx 本体每渲染都是新对象（`<Part {...ctxValue}/>` spread），比 ctx 本体 = 永不命中 = memo 纯摆设（测试抓到的真 bug）；
  5. **侧栏不虚拟化**（范围控制非缩水）：折叠组天然不渲染子行（ZCode 折叠组同行为），会话行 memo 化；ZCode 侧栏阈值虚拟化（>80 行）挂账——触发信号 = 实测卡顿或几百会话场景；
  6. **jsdom 降级**：无 ResizeObserver → 全量渲染路径——组件测试不依赖布局（22 用例零改动）；真浏览器行为由 e2e 用例④锁定；
  7. **React 19 onScroll 委托失效**（真浏览器实证，jsdom fireEvent 直走事件系统测不出——第三次实证「jsdom 不替代」）：滚动裁决改原生 `addEventListener("scroll", {capture, passive})` + ref 转发最新闭包。
- **理由**：分页形状三家一致是架构必然，照抄零争议；虚拟化分歧是场景赌注（ZCode 桌面千轮+搜索+多 pane vs dsh web 短会话）——我们渲染器重（shiki）且视觉参照 ZCode，虚拟化必做；但 2268 行的复杂度大头是搜索协调等我们无的功能，全抄=死重。**工程过程教训**：web-ui 改动必须 `pnpm build`（tsc 出 dist）再 bundle 再 e2e——web 包从 web-ui 的 **dist** 消费，漏 build 则 bundle 吃旧代码（三轮诊断白跑的根因，坑册既有条目「web 包 vitest 消费 web-ui dist」的 bundle 版）。
- **备注**：interfaces.md（REST /rows、SessionSnapshot 窗口字段、Row.rowSeq、facade sessionRows 19→20、web 段虚拟滚动形态条）；docs/20-architecture/render-performance.md 新增（渲染边界与更新隔离契约，照 ZCode 文档先例自家写法）；e2e 用例④（64 行会话：尾窗/虚拟化挂载块<10/滚轮翻页 index0 变回合 0/阅读位置稳定/回底按钮）+ 截图 09-12；测试 store 四用例 + facade 双形态 + parts 三用例。不做随批记：会话内搜索定位/四源意图+TTL/多 pane 记忆/手机布局/编辑重发交接/history-tail 分区缓存/JSONL 倒序窗口读（磁盘翻页暂全读重建）。

## D-062 界面挂载点词表 v2：整页框架槽 + 右栏 tab 框架 + 词表名统一

- **状态**：已定 · 2026-11-18 · 文档先行；**UI 侧子项已先行落码（2026-11-18 三栏骨架批，D-063 先例）**——Shell 拆解为占 `layout` 槽的官方框架件（宿主零界面 JSX，root 只挂 layout；同一注册声明子槽）＋ 右栏 tab 框架官方默认件（⌄+tabs+＋空白面板展位+⤢；`rightPanel{open,active,tabs}` 进 ui-state 按会话持久化，D-063 留位接线）＋ REGION_SLOTS 扩容（layout / sidebar.right / sidebar.right.tab；sidebar.right.tab 注册件各成一 tab）；批 C 余项不变（第三方 UI 装载通道 / import map / 插件管理面 / useResource / listPlugins / D-048 确认卡）；**批 C 前其余新槽合法但不被读取（D-059 先例）**
- **背景**：项目所有者对照 dsh 拍板完整愿景："整个页面是插件挂载点、可以完全重新布局；左侧目录列表 / 对话 / 输入框 / 工具卡 / 思考块全是官方写的默认插件；官方组件方法留口子供插件直接引用复用；后端引擎方法同规则可替换；AI 照创建技能写插件即完成新增替换——语义是替换不是修改"。取证核验（行为 / 结构层，零代码复用，D-004 / D-047）：dsh 客户端槽目录 94 槽，页面树全槽化——`root` 槽（shell 唯一直接渲染槽）占用者 ui-layout 的 AppFrame，在占槽的同一 register() 里声明左栏 / 对话 / 右栏 / 浮层子槽（声明 = 独占渲染权）；53 个 `ui-*` 包全是普通插件（布局 / 左栏 / 右栏 / 对话 / 每页设置 / 插件管理页各自成包，同一条注册路径）；右栏 tab 注册制（glob 地址识别 + extension 优先于 builtin 优先于 fallback 三档优先级，extension 接管 builtin、卸载回落）；插件 `require('react')` 走浏览器模块表拿宿主同一份（官方件同口子）；AI 写插件载体 = 官方创建技能（触发条件含"任何视觉物 / 插件请求"，references 分篇 + 模板 + 安装工具 + "装好的插件即第一个预览"验收）。对照自检抓出三缺口：①**词表两张皮**——宿主代码区域槽名（sidebar / conversation / composer，host REGION_SLOTS + web-ui defaultParts）与文档词表名（session.top / composer.above / sidebar.right，D-033 / D-057 落档名）不一致，文档三名在宿主接受集一个都不存在，按文档写插件全部被静默忽略（D-033 未知名处置）；②**整页布局从未成为槽**（web Shell 三栏硬编码，`layout` 选项是 full / center / composer 三值枚举；D-043 只定了"官方件各占各槽"，框架本体没占槽）；③**右栏 tab 框架只有半句**（有 `sidebar.right` 槽名与 `preview.<扩展名>` keyed 缝，无 tab 注册 / 加号下拉 / 优先级语义；web 宿主连右栏区域都未渲染）。另：愿景八成本已在文档（D-043 官方界面 = 真插件 + 标准件出口 / D-048-D-049 后端同 id 替换 / D-057 行级四缝 / plugins.md §6 创建技能），本条是"穿到底"。
- **决定**：
  1. **词表名统一，以宿主代码三名为准**：区域槽正名 `sidebar`（左栏）/ `conversation`（中柱）/ `composer`（输入区）——文档原 session.top / composer.above / sidebar.right 三个插件自挂名作废。选代码三名弃文档三名：代码已落地有测试锚着；三名直白；原命名是"位置修饰语"式（top / above），与 keyed 缝命名风格不一致；
  2. **v1 词表 7 → 10**（结构性一个 ＋ 区域级四个 ＋ 行级五个）：结构性 `layout`——整页框架槽，官方框架件（现 web Shell 拆出）默认占用，并在占槽的同一注册里声明子槽（**槽套槽**：声明 = 独占渲染权，dsh AppFrame 理念行为层）；`replaceSlot("layout")` = **整页重排**（风险标注同 dsh root 槽：影子化官方 UI——官方区域槽声明随框架件消失；安全模式回落官方框架）。区域级 `sidebar` / `conversation` / `composer` / `sidebar.right`（右栏区域槽，官方默认件 = tab 框架）。行级 D-057 四缝全保留 ＋ 新增 `sidebar.right.tab`（追加位，一件 = 一个 tab 面板，registerSlot 多件共存 order 排序；官方 tab 与插件 tab 并存，加号 / 下拉列已注册面板）；`sidebar.right.preview.&lt;扩展名&gt;` 仍为文件预览 tab 的 body 实现缝（extension 优先 builtin 不变）；
  3. **共享核心重申**：行级三条（`turn.tail` / `conversation.images` / `tool.call.view.*`）所有 web 系宿主语义一致；`layout`、区域四名与三个 `sidebar.right.*` 属桌面 web 宿主词表；移动端词表仍等移动 UI 设计（不复用 sidebar.right 系，D-033 第 4 条不变）；
  4. **"不做大矩阵承诺"修订（D-033）**：结构性槽逐个拍板、不预造矩阵——本次 `layout` 与右栏 tab 框架经用户拍板入表；titlebar / session.bottom 等仍按需逐个加（D-033 第 5 条精神不变）；
  5. **官方件口子加一句**：整页框架件与各件同进标准件出口（import map 与 react 同口子，D-043）——插件可 import 官方框架 / 组件复用（站在官方件上写自己的，不强制从零造）；
  6. **两条边界复核不变**：markdown 正文本体不可插（renderMarkdown 恒官方）；`chat.node` 式整行替换不进 v1（D-057 定稿）；
  7. **落码随批 C**：第三方 UI 装载通道（server 伺服 ui entry + 宿主动态 import + import map 注入 react / `@henira/kernel` / `@henira/protocol` / 官方件唯一实例）＋ Shell 拆解为占 `layout` 槽的官方框架件 ＋ 右栏 tab 框架 ＋ 宿主词表对齐（REGION_SLOTS 扩为词表十名）＋ 插件管理面（D-029 / D-030 / D-048 确认卡）同批闭环。**先行落码（2026-11-18 三栏骨架批）**：上列 UI 侧三项（Shell 拆解 / 右栏 tab 框架 / 宿主词表对齐）已落地，批 C 收敛为装载通道与管理面闭环。
- **理由**："AI 写插件替换内置"的物理前置是装载通道——没有它 registerSlot / replaceSlot 全是纸上谈兵（机制层 API 齐、外部代码拿不到 ctx）；词表名统一是零设计量的还账，越晚还不越多的插件死在静默忽略上；layout 槽与 tab 框架是 dsh 已验证的形状（行为层参照、实现自家写法）；整页替换给风险标注 + 安全模式回落双护栏，与"可换"核心承诺（P8）一致不缩窄。
- **备注**：plugins.md（依据行 / §3 ui.slots / §4 挂载点词表块 / §7.2 词表定稿块）、interfaces.md（web 段词表块 + WebPartContext slots 注释）、10-decisions.md（本条 + D-033 后续修订）、roadmap M4 内容行（批 C 闭环项）、INDEX plugins 行。批 C 验收判据随批出计划：第三方 UI 插件真装载 + `replaceSlot("layout")` 整页重排演示 + 右栏插件 tab 面板真渲染 + 安全模式全回落官方。
- **后续修订（2026-11-19 批 C 落码）**：第三方 UI 装载通道上线——window 模块表（宿主 React family）+ server 伺服的 ESM shim + import map（:227 同一口子）、版本化 URL（`?v=<version>`）装载、清单指纹 2s 轮询**免刷新重装**（停用/启用/切版本 dispose+重装，不等整页刷新）、槽件 ErrorBoundary 崩溃隔离（该件退出，不白屏）、`registerSlot` 的 `order` 落码、词表外槽告警；`replaceSlot("layout")` 整页重排与右栏插件 tab 渲染由通道自然支持（e2e 覆盖 turn.tail 实证；整页重排演示待首个真实替换件）。

## D-063 会话绑定界面状态持久化：每会话 ui-state.json + 全局 state/ui.json

- **状态**：已定 · 2026-11-18 · 文档先行；落码随 M4 批 C（右栏 tab 需要这个家——"开着哪些 tab"的总账住 ui-state.json）；落码前端点与文件合法不存在（D-059 先例，两边标注）
- **后续修订**：**已落码（2026-11-18 界面持久化批，先行于批 C）**——机制全量（两文件 / 四端点 / facade 四方法）＋ 草稿 / 上次选中 / 侧栏拖宽接线（宿主是唯一协调者：部件只交 patch，宿主顶层合并 + 统一 500ms 防抖 + 切会话 / pagehide 冲刷——决定 1"owner=web 宿主"的落形）；e2e 双用例锁判据①刷新还原 ②重启还原；顺带修选中高亮档（`--henira-selected` 10/12% → 16/18%——与 hover 档几乎不可分辨是"点了不出选中状态"的真因）。**折叠组撤出持久化（2026-11-18 用户裁决）**：折叠没有跨刷新还原的意义——刷新 / 重启只做一件事：把选中会话所在组展开、其余组收起；平时的折叠 / 展开是纯本地临时操作，不落盘、不还原（`SessionUiState.sidebar` 字段删除；侧栏件内初始播种 + 本地 state）。**rightPanel 接线（2026-11-18 三栏骨架批）**：`rightPanel{open,active,tabs}` 随右栏 tab 框架启用（＋ 空白面板展位；e2e 第三用例锁刷新还原）；`layout.rightWidth` 同批接线（右栏拖宽把手，每会话各记各的）；`SessionUiState` 正名 + `model` / `reasoningEffort` 两字段（模型/思考**会话级 composer 回填记忆**——权威在每次请求携带，引擎无会话态；我们更薄）。
- **背景**：项目所有者逐项质询"会话绑定的状态重启 / 刷新是否还原"：左侧选中的、输入框草稿、排队、审批、提问、plan、task、右栏打开的 tab、左中右拖动的宽度。审计结论：会话内容早已落盘可还原（账本），但界面绑定态几乎全内存——选中 = 启动自动选**最新更新**的会话（host 取列表第一个，非"上次选中的"；projects.json `lastSessionId` 字段只写未读）；草稿纯内存（全库零浏览器存储），刷新即丢；右栏未建（D-062 随批 C）；宽度不可调（侧栏 260px 固定 + 内容列视口自动三档）；排队是唯一已持久化的（queue.json，D-045）但 UI 不渲染队列内容（不进事件账本，P9-1，投影与 REST 均不暴露）；审批刷新存活（审批行账本投影）但重启后留幽灵 pending 行（等待器随进程死，revoked 事件投影认识、无人写）。取证两条路线（行为层，D-004 / D-047）：ZCode = 纯界面态归浏览器 localStorage 分键（按工作区 + 会话存草稿 / 选中 / 分栏布局；队列与审批明确不持久化——重启即丢是写进协议注释的裁决）；服务端路线 = 界面绑定态归服务端（每会话一个 JSON 的字段族：draft / queue / rightPanel{tabs,active,width} / leftWidth，客户端防抖上报 + 关页冲刷，重启后打开会话即续）。项目所有者拍板：**走服务端同构、落我们目录树**；全局"上次选中"住 `state/ui.json`（服务端存，弃浏览器 localStorage——换浏览器 / 换设备即丢，与"重启 / 刷新都要还原"的要求不贴）。
- **决定**：
  1. **每会话一个 `ui-state.json`**，住会话目录（与 session.v1.jsonl / meta.json 平级）：`projects/<key>/sessions/<id>/ui-state.json`。装**界面绑定态**：草稿、左右面板宽度、右栏开着的 tab 引用（插件 id + 面板 id；**只存引用不存面板内部状态**——插件自己的状态归 `plugins-data/<id>/`，边界同"不放 meta.json"的 per-owner 文件规矩）。**折叠组不入档**（2026-11-18 用户裁决，见后续修订：刷新 / 重启只展开选中会话所在组，其余组收起；平时折叠纯本地）。**归属 = web 宿主**（宿主是 D-062 语义下的真插件，它的状态文件它所有）；服务端不解释内容，当不透明 JSON 对象整份收发 + 大小上限；**整份 tmp+rename 原子重写**（同 meta.json / queue.json 模子）；**不进事件账本**（状态是"现在的样子"不是历史，P9-1 同 queue 先例）；删会话随整树走——"和各自会话绑定"由目录生命周期天然保证；多窗口并发 = 后写者赢（整份换）；
  2. **全局"上次选中"一条**：`state/ui.json`（与 server.json 同目录——state/ 本就是运行态的家）：`{ "lastSessionId": "s-..." }`。启动还原顺序：读之 → 在会话列表中则选中 → 否则回落最新更新（现状行为）/ 列表空则新建。**不进 settings.json**（那是用户设置；这是程序运行态）。projects.json `lastSessionId`（按目录记）处置随批 C 定：接消费方或作废；
  3. **写时机**：客户端防抖（草稿 500ms 级）+ 关页 / 切会话冲刷，服务端整份落盘；读时机 = 选中会话时拉取回填；
  4. **不进 ui-state.json 的**：plan / task（引擎态不是界面态，已有家 `plans/index.json` 的 active 字段 + `tasks/<id>.json`，M5 落地用既定住处）；审批 / 提问（**活等待不跨重启**，与 ZCode 同裁——刷新存活靠审批行账本投影；重启 = 对账标中断；幽灵 pending 行清理语义随批 C 一并定）；
  5. **REST 面两对端点**：`GET/PUT /api/sessions/:id/ui-state`（每会话）＋ `GET/PUT /api/ui-state`（全局，backing `state/ui.json`）。facade 四方法（getUiState / putUiState / getSessionUiState / putSessionUiState）随码落档。
- **理由**：服务端存贴用户要求（重启 / 刷新 / 换浏览器都还原）；放会话目录 = 生命周期天然绑定，零新增机制（文件三模子全是既有先例：只追加流水 / 可改元数据整份重写 / 状态不进账本）；"上次选中"单列全局文件是因为它跨会话，塞进任一会话目录都错位；ZCode 路线在其单机单用户桌面形态下成立，我们是 server + web 多端形态，状态归服务端才有一致的还原语义。
- **备注**：落点 = data-directory.md（全局树 / 会话目录树 / §2.1 表 / §5 写者表 / §7 删除范围 / projects.json 注）、interfaces.md（REST 面 + DTO + facade）、roadmap 批 C 行、50-open 账目行。落码验收随批 C 计划出：改宽度 / 草稿 → 重启 serve + 刷新浏览器全还原；换浏览器打开同一 server 同样还原；折叠为纯本地态，不参与还原（仅保证活跃组展开）。

## D-064 plugin-mcp 读者：最小 MCP 通道（官方 SDK 连接 + 工具转接 + D-030 凭据注入 + 确认指纹）

- **状态**：已定 · 2026-11-19 · C5 收尾小批；**✓ 同日已落码**（discovery 扫描/确认门、plugin-mcp 包、server+sdk 双形态、useResource 泵、管理面详情；e2e 真浏览器确认→新会话→泵 live 闭环；顺带修「＋新会话」只建不选）（销 50-open 挂账 ④⑥⑦：plugin-mcp + D-030 凭据注入 / 管理面 mcp 详情 / useResource 实装）
- **背景**：批 C 闭环了插件装载（C1）/ 第三方 UI 通道（C2）/ 管理面（C3）；MCP 是「一切皆插件」生态闭环的最后一条外部通道——AI 创建内容包带 `mcp/*.json` 即接市面上现成 server（plugins.md §4 生态兼容既定：「标准 MCP 协议、兼容 .mcp.json 生态写法、坏服务器退避重连」）。取证四仓（dsh / opencode / ZCode / CC，行为层，D-004 / D-047）：**全部用官方 `@modelcontextprotocol` SDK**（零手写 JSON-RPC）；工具命名 `mcp__<server>__<tool>` 三家一致（opencode 用 `server_tool`）；MCP 工具调用一律走既有审批链、无规则命中默认 ask；连接 eager / 异步非 lazy；重连有界退避、耗尽注销工具不 crash-loop；**四家都没有「新增 / 变更须确认」的结构化卡点**（ZCode 项目级 workspace-trust digest 同精神；dsh 的 `!!js` 配置内求值密钥等价于配置内 eval，不采）。
- **决定**：
  1. **官方 SDK**（现行稳定版；Stdio + StreamableHTTP 两 transport；SSE-only 不做，声明 `type:"sse"` 即跳过 + 告警挂账）；
  2. **命名**：`mcp__<server>__<tool>`；非法字符 → `_`、超 64 截断并追加短哈希防塌缩；server 名跨插件按 D-032 链去重（同层 id 字典序赢 + 告警）；
  3. **D-030 确认门 = per-plugin 指纹**（`mcp/*.json` 内容 sha1 → `settings.plugins.<id>.mcpFingerprint`；不符 = 不 spawn + 工具不进注册表 + 状态待确认；`POST /api/plugins/:id/confirm-mcp` 放行）——比四家参照物都严，plugins.md §4/§5 既定语义的落形；
  4. **凭据**：env / headers 值支持 `${credential:名}` 引用，宿主从 `credentials.json` 展开后内存传递，缺失 fail-closed 跳过不 spawn；stdio 父环境清洗（剔 `KEY|PASSWORD|SECRET|TOKEN` 与 `HENIRA_*` 名）再合并声明 env（防环境侧信道）；plugin-mcp 本体永不接触 credentials.json、不回显密钥；
  5. **生命周期**：会话装配时异步连接（不阻塞开屏）；连上 → tools/list → 注册；`list_changed` → 重列、整代原子换注册（sync 单队列串行；失败保旧代）；有界退避（1s×2，3 次）耗尽 → 注销该 server 全部工具 + 告警，新会话重来；stdio 死亡不自动 respawn（新会话重连）；
  6. **结果**：text 内容按序 join；image / audio 以占位行计入（blob 落盘挂账）；`isError` 原样透传；截断走 execute 出口既有限量（参照物里 opencode 漏接截断，是我们避开的坑）；
  7. **形态（D-049）**：服务件占 `mcp` 槽（`McpService` 契约进 protocol：`call(target, args, signal)` 最小面）+ `inject:['tools']` 注册工具；server 声明由装配前置扫描（config-loader 纯文件读，复用批 C 骨架）喂工厂（opts 模式同 llm 特例）——插件不扫目录、不碰凭据文件；`defaultPreset` 一行（可停用；不可卸载靠「官方件无盘上目录」天然成立，不进 OFFICIAL 保护集）；useResource（plugins.md §4 数据泵规格：所有权闸 / 2s 共享泵 / 30s / 200 × 1024 字符 / 失败保旧数据）经 `POST /api/sessions/:id/resource` → `McpService.call` 落地；
  8. **范围外挂账**：OAuth、prompt templates / resources / elicitation / sampling、server instructions 注入、进程级连接池共享、管理面连接状态显示与重连钮、图像 / 音频 blob 落盘、MCP 工具描述长度上限、SSE-only transport。
- **理由**：MCP 是行业标准（D-019「市面上现成的直接可用」），官方 SDK 是四家参照物的共同选择——自研传输层零收益；命名与审批语义跟着生态同形（模型与用户都无需学新约定）；确认指纹是我们已有的 D-030 语义（「MCP 定义变更要确认」），落形为内容指纹即可，不引入新机制；凭据引用替代配置内求值（dsh `!!js`）与配置内明文（CC headers），是我们凭据分离架构（D-030）的自然延伸——插件目录零 key 这条线从 M3 设置浮层起就没破过。
- **备注**：落点 = interfaces.md（`## mcp` 契约小节 / REST 面 +2 / ResourceReply + PluginDetail.mcp confirmed / 能力服务表行）、plugins.md（落码状态 + §4 mcp 行注）、packages.md（plugin-mcp 行落码标注）、50-open（销 ④⑥⑦ + 新挂账行）、roadmap（批 C 闭环项销账）。验收随批：未确认不 spawn → confirm 后新会话工具进注册表 → mock llm 触达 → useResource 越权 403 / happy / 失败保旧 → e2e 真浏览器确认 → live → 停用全链。

## D-065 fs / shell 能力服务契约定稿 + 首发批六件落码（fs 族 3 / shell 族 2 / breaker 1）

- **状态**：已定 · 2026-11-20 · M4 首发批第 6–11 件（D-041 / D-049 / D-058 的落码批）；interfaces.md `## fs` / `## shell` 契约小节同批定稿
- **背景**：D-049 立了「能力一律服务、按族拆包」的骨架，fs / shell 服务契约按表「M4 落码前定稿」；D-058 拍板 breaker 进首发批第 11 件。开工前四仓取证（dsh / ZCode / opencode / CC，行为层，D-004 / D-047）共识：read 默认/上限 2000 行四家一致；write / edit 的 read-before-mutate 与 stale 守卫三家有（纯权限无守卫的一家是我们避开的坑）；edit `old_string/new_string/replace_all` 三家同形；shell timeout 默认 120s / 上限 600s 四家一致、每次新 spawn 四家一致；grep 引擎三家打包 ripgrep 二进制、一家有 JS 兜底；重复调用检测两家都是「回合内提醒注入 + 阈值 3 起、advisory 不否决」。
- **决定**：
  1. **FsService（fs 槽）**：六能力 `resolve / read / write / edit / glob / grep` + 会话级读态（read-before-mutate 守卫住服务层——注入者皆受，D-049）；结构化返回、格式化归工具件；能力方法带 `gate`（`{signal, requestPermission}`）——**围栏强制点唯一在服务层**：区内直行（判定链照常，凭据 / 灾难硬拒不受影响）、区外 → 服务经 `requestPermission(req, {floor:"ask"})` 走判定链弹卡（默认放行层不得放行区外）。区外 write / edit 会见两张卡（链卡 + 区外卡）——有意为之：区外是显式二次确认，fail-closed 优先于卡片数量；词法围栏（相对 cwd 解析、win32 大小写不敏感、`~` 展开），symlink 真实归属检查挂账——fs 围栏是给模型的护栏不是对抗恶意进程的沙箱（审批链才是闸）；
  2. **read/write/edit 语义**（三家同形）：read 默认 2000 行 / 每行 2000 字符 / 选区 50KB、`N\t` 行号、尾注带 offset 续读提示、二进制（NUL 探测）报错；write 新建自动建父目录、已存在必须先 read（未见 / stale / 部分读三类守卫消息）、写后刷新读态；edit 唯一性报错带计数与「可能已改过」提示、LF 归一匹配保留原换行符、空 new = 删除、v1 纯精确匹配（模糊阶梯挂账）；
  3. **glob/grep**：glob 上限 100、mtime 降序、绝对路径返回、跳 `.git/.hg/.svn/node_modules`；grep **JS 引擎**（零外部二进制——v0.1.0 发布面不带平台二进制，rg 加速挂账）、`output_mode` 默认 files_with_matches、head_limit 默认 250、-A/-B/-C 上下文、跳二进制与 >10MB 文件、单行预览 2000 字符；
  4. **ShellService（shell 槽）**：`run(spec, gate)`——spec = `{command, shell:"bash"|"powershell", cwd?, timeout?, env?}`、结果 = `{exitCode, stdout, stderr, durationMs, timedOut?, signal?}`；每次新 spawn（持久会话 / cwd 持久化挂账）；timeout 默认 120s 上限 600s、超时杀进程树（win32 `taskkill /T /F`；posix detached + 负 pid，TERM→3s→KILL）；**非零退出码不是 isError**（`[exit code: N]` 计入内容，模型自行判读——spawn 级失败才 isError）；
  5. **shell 工具**：`bash`（`bash -c`）+ `powershell`（探 pwsh 7 → powershell 5.1，`-NoLogo -NoProfile -NonInteractive -Command`，UTF-8 输出包装）；每流尾部保留 20KB + 截断注记；env = 父环境 + `NO_COLOR/TERM/PAGER/GIT_PAGER` 输出净化覆盖 + `HENIRA_PROJECT_DIR`（**不洗敏感 env**——agent 以用户身份跑、凭据值本不经环境传递、审批链是闸；与 MCP stdio 的清洗是两个场景，后者防外部 server 侧信道）；审批走既有链——灾难硬拒清单已含 Windows 命令，`commandPrefix/commandContains` 规则天然适配 shell 工具；
  6. **plugin-breaker 双机制**（D-058 落形）：①回合内提醒——观测 `tools/pre-execute`（waterfall 透传 `next(value)`，不否决不截流），签名 = 工具名 + 稳定序 JSON args，连续同形 ≥ 阈值 → `session.append` 一条 `user/message{source:"breaker"}` 英文提醒（模型下一步即见、自纠），封顶 2 条/回合、用户插话重置；②回合尾否决——计步（bus `step/start`）+ 记忆本回合重复，`onBail("loop/turn-stopping")` 超限返回 `Veto{by:"plugin-breaker", reason, resume:{prompt}}`（bail 缝首个生产消费者；内核每回合只查一次缝 → 每回合至多一次干预）。阈值默认必设：步数 50 / 同形重复 3 / 提醒 2 条，`config.get("plugin-breaker")` 读 `settings.plugins.plugin-breaker.options` 可配。无名件（不占槽）、inject `["session","config"]`、进 defaultPreset、可停用（不在 OFFICIAL 保护集）；
  7. **workingDirectory 不设独立件**：cwd 现状链路已通（`SessionHeader.cwd` → `ConfigService.cwd` → `ToolContext.cwd`），fs / shell 服务 inject config 取 cwd 作围栏根；唯一潜在消费者（shell cwd 持久化）挂账，需求出现再立服务。能力服务表该行改记「不设独立件（本条）」；
  8. **第二实现思想实验**（D-049 契约要求，结论进契约）：**沙箱 fs** —— FsService 六能力进出全为字符串 / 结构化数据、零 Node 句柄零流，同槽换 plugin-fs 沙箱实现时围栏从「区外问」变硬 containment（拒绝而非 ask），工具件与全部注入者零改动；**远程 shell** —— ShellService 契约零 child_process 类型、env 显式 map（远程无法继承父环境）、结果纯数据（流文本 + 退出码 + 计时），SSH 实现 `run()` 同形可换；后台任务 / 持久会话属实现细节不进 v1 契约；
  9. **范围外挂账**：read 的图片 / PDF / notebook 特化、grep offset 分页与 0=不限、edit 模糊匹配阶梯与多段批量、shell 后台任务（run_in_background / 超时转后台）/ 持久会话 / cwd 持久化、symlink 真实归属围栏、ripgrep 加速、breaker 升级为否决链多级提示。
- **理由**：语义参数（2000 行 / 120s / 600s / 阈值 3 / head_limit 250）全部取四仓共识值，模型与用户都无需学新约定；守卫语义取有守卫的三家（未读不覆盖是防 clobber 的行为底线）；JS grep 是零依赖发布面的必然选择（ZCode JS 兜底先例证明可行）；breaker 双机制是 D-058 文字（否决）与参照物实践（回合内提醒）的并集——纯否决盖不住「永不完成」的跑飞回合（bail 缝只在回合将结束时触发），纯提醒又缺 D-013⑤ 要求的否决生产消费者；不洗 shell 环境是因为洗了就坏 `git push` / `npm publish` 这类合法流程，而 D-030 的威胁模型（credentials.json 值外泄）本就不经环境变量。
- **备注**：落点 = interfaces.md（`## fs` / `## shell` 契约小节 / SlotMap / 能力服务表三行）、tools-approval.md（围栏段落落码标注）、packages.md（六行 ✓）、loop.md（turn-stopping 典型插件列）、50-open（挂账行）、roadmap M4 判据回填。验收随批：mock 会话跑完 read→write→edit→bash 全链、停用 fs 服务 → fs 工具全体缺席、breaker 提醒行与 veto 续跑、e2e 审批卡全链、冷构建模拟绿。**R153 审查修复补丁（2026-11-20，提交 `3059849` / `7bfabdd`，真实模型验收过）**：grep files 模式截断判据按文件数（`FsGrepResult.totalFiles`）；grep `path` 支持单文件；read 补 50MB 整文件帽（先帽后读）；read 部分读判据收紧（显式 limit 覆盖全文件不算部分）；edit 混合换行只受理单行编辑（多行 `old` 报 `mixed_line_endings`）；shell abort 与超时同款杀树升级（TERM→3s→KILL）；glob `total` 恒为命中全量；grep 上下文行 `-` 分隔 + `-n:false` 生效；breaker「用户插话重置」落码（loop 广播 bus `user/steer`，streak/reminders 清零、maxStreak/steps 保留）。

## D-066 先看后做：参照系取证升级为普适默认 + 交付声明与故障分型

- **状态**：已定 · 2026-11-22 · 过程纪律（不改变任何产品协议）；AGENTS.md「干活顺序」「裁决与验收」同批落条目
- **背景**：R174 质询后先立了「破坏性清单五问」；同日请求洪水缺陷后项目所有者指出整改方向错了——不是炸一个雷补一条清单（打地鼠），并拍板「做任何东西之前都先看参照系」应为无条件默认工序。复盘：此前取证范围只罩当批可见功能面，机制层（保鲜 / 失败 / 并发 / 生命周期 / 资源行为）从未进过任何取证单——懒挂载重启 404、断开丢手写配置、进程死亡残留、请求洪水，四类翻车同根；外观照得像、骨架自创，短演示验收测不出，长用必爆。
- **决定**：
  1. **普适默认**：任何要落进本仓库的东西（功能与 effect / 轮询 / 失败分支 / 状态字段一视同仁），动手前对参照系（dsh / OpenCode / ZCode 公开仓库记 file:line；Claude Code 闭源仅行为层，D-047）做**全集取证**：形状 + 机制 + 边界 + 资源行为，不预设问题单、不按批裁剪。
  2. **分层单主**：结构来源每层唯一——插件体系（槽位 / 装配 / 生命周期 / 官方件 / 词表）以 dsh 为唯一结构来源；会话事件 / 行投影 / 渲染（含分页虚拟化）以 ZCode 为唯一结构来源（R113 既定纠偏）；OpenCode / Claude Code 等其余参照只作行为层补盲（失败模式 / 参数边界 / 踩坑记录），结构不进口。每份取证底账与计划对照表首行标注「结构来源 / 补盲对象」。
  3. **硬闸**：每批计划第一节 = 本批触碰面的参照系对照表（各家做法 + 证据出处）；无此节 = 计划未完成，不落码。唯一合法跳过 = 已查且记录「参照系无此物」。
  4. **够格产出**：取证汇报必须回答「咱这块将来会以什么方式坏、人家怎么防的」；只能讲清外观与 happy path = 未取证。
  5. **交付声明**：每批收尾声明哪块有对照底账、哪块是结合部 / 自主发明 / 环境特有；后两类验收加倍（破坏序列 + 真用法）。
  6. **验收照真用法不照演示**：长时运行、真 key、真浏览器；资源行为（请求量 / 并发 / 堆积）属验收面——功能断言全绿不等于资源正确。
  7. **故障分型认账**：交付后的问题归「没取证 / 接缝 / 发明 / 环境」；「没取证」复犯视为流程失职。
- **理由**：清单式整改以「我想到的」为边界，盲区不可枚举；参照实现已覆盖绝大多数机制先例。把「看」升为工序固定步并配计划首节硬闸，才能从「靠灵感」换成「靠流程」。接缝 / 发明 / 环境 / 长尾四类无法靠参照消除，只能靠声明 + 加倍验收 + 分型让风险可预测、不隐形。
- **备注**：落点 = AGENTS.md 两段（干活顺序 / 裁决与验收）。既有验收闸（语义钉子测试 / 反向核对 / 报告带扫描范围）不变；与类型化清单冲突处以本节为准。

## D-067 会话列表保鲜：全局 sessions.changed 信号帧 + 装载一次/去抖/单飞（R176 洪泛修复）

- **状态**：已定 · 2026-11-22 · 直播事故修复批；✓ 同日落码
- **背景**：聊天中控制台数百条 `net::ERR_INSUFFICIENT_RESOURCES`——`/api/dirs` 与 `/api/sessions` 成对失败。根因：官方件会话列表把行 store 的每次通知当刷新信号（`store.subscribe(refresh)`），而 store 每个流式 token 帧都通知；无单飞 / 去抖 / 退避 → 约 60 次/秒 × 2 请求，浏览器每源连接池被打穿。五家取证（dsh / ZCode / opencode / CC 与闭源产品行为层，D-004 / D-047）铁律：列表 0/5 轮询、流式增量 0/5 触发列表 HTTP、列表 GET 失败 0/5 自动重试。
- **决定**：
  1. **协议加全局帧** `ServerFrame.sessions.changed`（无 sessionId / 无 seq）——只在列表事实变化时发：建会话 / 删会话 / fork / 懒挂载（`#announce` 共点）/ 目录登记增删；**流式增量绝不发**。fanout 只开 `sessionsChanged()` 专用方法（不开放通用 broadcast——行增量必须走 publish 保 seq）。
  2. **双形态同形**：server 路由与 sdk runtime 的 create / delete / dir 变更点各发一次；SDK client 透传不变。
  3. **官方会话列表消费契约**：装载一次 + 信号驱动——250ms 去抖 + 单飞（在飞只标脏、落定恰补一枪）+ 失败保旧列表不自动重试；`state.updated` 帧就地翻 busy（零请求）；重连快照对未知会话补一次重载；**行 store 通知不再接列表刷新**。
  4. **验收面含资源行为**：e2e 以网络面板计数断言流式回合 `/api/sessions` + `/api/dirs` 零增长；双页建 / 删 / 忙同步各零请求或恰一枪。
- **理由**：结构取 dsh（列表一次装载 + 生命周期推送，token 增量走独立管道）；去抖 / 单飞 / 失败不重试参数取 opencode / ZCode 行为层；busy 翻内存取 dsh 与闭源产品的 status 事件语义。全局信号是自主发明（五家分别用 upsert / removed / status / invalidate——无同形）：不推列表本体，保持 REST 列表为唯一真相源，信号频率极低且天然幂等。
- **非目标（挂账）**：`/api/sessions`、`/api/dirs` 的全量扫盘 / 整文件读优化；服务端 batcher 多事件合并；客户端全局并发队列（opencode 4 槽先例）。根因消除后列表调用归零级，以上仅未来加固。
- **备注**：落点 = interfaces.md（ServerFrame / SSE 传输形状 / sdk events / web 侧栏刷新契约 / PluginUiHost.subscribe 过滤语义）；测试 = web-ui 6 例 + server SSE 1 例 + facade 双形态 1 例 + e2e 网络计数/双页 1 例。

## D-068 中间对话区输出组织与视觉重做 + 结构拆分（R177）

- **状态**：已定 · 2026-11-22 · 用户实拍反馈批（样式与输出序列）；✓ 同日落码；**输出组织细节已被 D-069 修正（R178）**
- **背景**：用户连续指出三件事：①一次提问后的输出链（思考 → 工具调用 → 工具结果 → 最终回答）的组织和长相都不对，工具调用与结果尤其丑；②部分样式「AI 味」重，没法接受；③全部 CSS 挤在一个 1920 行文件里，组件该拆没拆。拍板：视觉风格与中间区结构以 **ZCode 为主参考**（用户偏好其排版密度），dsh / opencode / CC 只补行为盲区；只可看不可抄（D-004 / D-047）；顺序 = 先纯拆分零变化，再重做；范围 = 只中间对话区（其它区域只拆文件不动外观）；完成轮过程折叠；读文件 / 搜索 = 摘要 + 文件 chip 弹窗（右栏预览留后期）。
- **决定**：
  1. **完成轮历史折叠**：过程行（思考 / 工具 / 中间文本 / 审批痕迹）收进「已工作 · 用时 Xs · N 个工具」折叠体，最终回答留在外面；运行中 / 失败 / 中断强制展开，用户手动开合优先；最终回答行自带的 reasoning 在折叠时移入折叠体（回答保持干净）；仅「思考 + 回答」无工具的轮次同样折叠（折叠头不显示 0 个工具）。异常终态 = error 行 / assistant interrupted / 审批非允许决策。
  2. **思考块默认收起**（流式与完成一致；ZCode 取证）：触发行 = 脑图标 + 「正在思考」/「思考 Ns」扫光 + 流式收起态最后一行摘要；展开 = 左导线纯文本 max-h 240（协议无 reasoning 时间戳，时长客户端起表，历史行无起点则只显示「思考」）。
  3. **工具行**：图标 + 中文名 + 参数摘要 + diff 计数 / 截断 / 耗时 / 状态词；14px、无边框无底色、hover 提亮 + 箭头浮现；running 扫光、error 摘要与状态红。**工具结果**：统一卡片语言（border + 12px 圆角 + card 底）；终端命令 + 输出上限、diff 行号着色、MCP 参数/结果分区、fallback IN/OUT 两段。**读文件 / grep content 收起态只给摘要与文件 chip**，点击弹窗看账本已捕获内容（不新增后端接口）；glob / count 保留小型展开列表。
  4. **轮内过程分组**：连续工具 + 透明步级行 ≥2 聚合；组头按 explore / run / change / session 统计「已查阅 N 项 · 已执行 N 条命令 · 已修改 N 个文件」；组内左导线、高度上限、默认收起；running 组头显示当前活动 + 扫光。纯空步级行剔除，中断行断开组。
  5. **正文 markdown**：14px / 行高 1.75 / 字距 0.01em；标题 / 列表 / 引用 / 行内代码按 ZCode 档位；外链新标签打开、相对链接 `preventDefault` 不导航；GFM 任务列表只读主题化。
  6. **结构拆分**：CSS 拆 14 个分区文件（顺序 = 原单文件顺序，入口 `tokens.css` 只做 `@import`，包出口与宿主 import 不变；copy 脚本复制 styles/）；组件拆 `parts/conversation/` / `parts/tool-cards/` / `parts/settings/` / `parts/session-list/`，旧路径 re-export 薄壳；中间区布局样式出组件、走 CSS 类。
  7. **不碰**：协议 / 行投影 / 存储 / 槽位语义；`tool.call.view.*` / `approval.view.*` 顶替与卸载回落不变（ToolRow 形状不变）；不引入 Tailwind；不抄参考代码。
- **理由**：折叠解决「每轮回放满屏过程」的组织问题（ZCode 同形）；思考默认收起避免流式思考挤压工具与正文；工具行去底色、结果才用卡片，是把「AI 味」的堆装饰压回层级系统；读 / 搜结果默认不进对话流、按需弹窗，保持长会话干净；结构拆分先零变化再改视觉，出问题能分清是搬家还是改样式。
- **非目标（挂账）**：右栏文件预览（需新增文件读取端点与安全工作区边界；本轮弹窗用已捕获 tool output）；侧栏 / 输入区 / 设置页视觉重做（只拆文件）；工具级 stopped / denied 协议字段（只做渲染层映射）；Tailwind 迁移。
- **备注**：落点 = interfaces.md web 段（输出组织契约 / CSS 与组件组织 / renderMarkdown 注释）；测试 = web-ui 112 例 + web 66 例（含链接 / 任务列表新例）+ e2e 27 例；真 key 活体 = Agnes 3.0 Flash 完整链（思考 → bash → 审批 → read → 最终回答 → 文件弹窗），明暗双主题截图存 `artifacts/r177/`。

## D-069 中间对话区按参照实现修正（R178）

- **状态**：已定 · 2026-11-22 · 用户实拍复核批（「不是照抄吧」「AI 回复这里没破坏吧」两问后开工）；✓ 同日落码
- **背景**：用户指出 R177 仍不对：①usage / 思考档徽章（「最高 36000↑ 6917↓」）不该上对话区；②工具调用 / 工具输出直接露对象花括号；③read 行还要点击展开才见文件名、文件名不是主信息位；并明确「不仅仅是这些问题」。逐行对照参照实现后确认偏差是整条链：过程分组阈值（参照按「思考 + 工具」项数、我们只按工具数）、未知工具 / MCP 的分组边界、审批 settled 痕迹行、轮头形状与时长格式、工具行图标 / 类别词 / 主次信息 / 成功状态词 / 单次耗时、read/search 静态语义、MCP 与兜底参数形状、正文排版档位、运行中轮头与加载行。根因：按自己的计划与记忆落码，并把自造形状写进单测 / e2e 锁死（「全绿」只证明自洽）。
- **决定**：
  1. **工具行**：工具身份图标（read/search 放大镜、bash/powershell 终端、edit/write 铅笔、MCP 插头、兜底扳手，16px 弱色）+ 类别词（正在读取 / 已读取、正在搜索 / 已搜索、正在执行 / 已执行、正在编辑 / 已编辑、正在写入 / 已更新、MCP）+ 主信息 + diff 计数 + **仅失败时**的状态词（虚线下划线 + 原因 title）。成功行不显示状态词 / 单次耗时；错误不自动展开；展开状态按 `sessionId:callId` 记忆。
  2. **read / search / glob 是静态行**：`canToggle=false`，不渲染按钮语义 / 箭头；read 主信息 = 文件图标 + 文件名（点击弹窗看账本已捕获内容），不显示行号范围 / 耗时；search / glob 只有一句「查找 <query>」（或「列出 <path>」），不展开结果列表 / 文件 chip。
  3. **参数与结果**：兜底卡扁平参数 = 两列键值表（不露花括号），嵌套对象才用 JSON 代码块；MCP 结果优先（短结果小卡 / 长结果代码块 288px），参数收进二级「调用详情」；execute 命令 3lh 可展开到 10lh、输出 5lh；diff 上限 240px。
  4. **过程分组**：连续「思考 + 有类别的工具」**项数 ≥2** 折叠（思考也算一项）；未知工具 / MCP 是边界不分组；组头统计「已查阅 N 项，已执行 N 命令，已修改 N 文件」（运行中未完成措辞；中文逗号；change 按去重文件数，路径未知单列）；运行中组头显示当前活动项摘要；组内左导线 + 16lh 上限。
  5. **轮级**：完成轮过程收进「已工作 3 分 44 秒」（无「用时」、无工具计数；底边细分隔线；箭头常显）；运行中不显示轮级折叠头（过程直接展开，末尾「工作中 + 时长」加载行）；中断显示「已停止」；无时长用「已处理」；异常轮默认展开；最终回答自带 reasoning 收进折叠体。
  6. **不上屏**：usage / 思考档行徽章、assistant 下「已中断」胶囊、settled 审批痕迹行。pending 审批仍在输入区 dock；settled 数据仍留在 store（自定义 conversation 区域可消费）。
  7. **正文排版**：14px / 1.75 / 0.025em；strong 500；ul 各级 disc、ol inside、li 内 p margin 0；行内 code 12px 无边框；标题 mt 24 / mb 16；引用 pl 12；链接蓝色点线；外链新标签、相对链接不导航。
  8. **结构**：`styles/conversation/` 下按功能拆 motion / markdown / actions / rows / turn 五个文件（入口 `tokens.css` @import；copy 脚本递归复制）；工具卡内部不再全量内联样式。
  9. **插件缝不破坏**：`conversation` 区域槽、`tool.call.view.<工具名>` / `tool.call.view.mcp`、`approval.view.<工具名>`、`ToolCallView` / `ApprovalCardView` props、公共出口、替换优先级与卸载回落全部不变；行模型 / 协议 / 存储不动。
- **理由**：参照实现的可观察行为是唯一验收标尺；R177 的偏差来自「计划写对、落码走样、测试锁错」，不是审美分歧。审批痕迹与 usage 徽章是自造信息，用户读不懂也不需要；read/search 静态行和过程项计数是组织问题的根。
- **非目标（挂账）**：右栏文件预览；侧栏 / 输入区 / 设置页视觉重做；工具级 stopped / denied 协议字段；diff 语法高亮（本轮只对齐高度 / 行号 / 卡片语言）；逐条动画时长（300ms 收起动画暂挂）。
- **备注**：落点 = interfaces.md web 段输出组织契约（R178）+ CSS 组织；测试 = web-ui 116 例（含 conversation 区域槽顶替）+ e2e 27 过 / 1 skip（usage 不上屏 / read 文件链接 / 审批无痕迹 / 未知工具不分组 / 截断注记进结果区 / 四缝顶替断言保留）；真 key 活体 = Agnes 3.0 Flash（思考 → bash → 审批 → read → 最终回答），明暗双主题 + 运行中截图存 `artifacts/r178/`；`artifacts/r178/` 不入库。

## D-070 R178 审查修正（R179）

- **状态**：已定 · 2026-11-22 · R178 落码后的只读审查批（用户问「需要进行审查吗？」→ 拍板「好」；修哪些由我定 → 拍板「好」）；✓ 同日落码
- **背景**：R178 自测全绿后做独立审查（插件缝 / 文档对码 / 行为边界 / 交互 / 样式漏网 / 死代码 / 测试质量 / 真用户路径八面）。**无 P1**：四缝、公共出口、协议与 R178 契约主体均完好。P2 五项：①展开组的子行仍带工具图标、思考块自带导线与组导线叠成双层；②组头展开后仍显示活动项预览（参照展开显示统计）；③修改组收起态丢了文件名这层信息；④代码块头「换行/复制」仍吃全局按钮基线（与上批 file-link 同类）；⑤「思考也算一项」的核心规则没有单测锁住（上轮假绿的根）。
- **决定**：
  1. **组内收口**：组体隐藏子行前置工具图标；思考块在组内剥掉自身左导线/缩进——组导线唯一（参照组体同法）。
  2. **组头**：展开态显示统计（`open || 无活动项 ? 统计 : 预览`）；`aria-label` 恒为统计串。
  3. **修改组收起态文件名**：`WorkStats.files` 带去重路径（首现序）；收起时单文件显「已修改 + 文件名」、多文件显统计 + 文件名，展开回统计；本轮不可点（查看器沿 D-069 挂账）。
  4. **代码块头按钮**：常态/hover/aria-pressed 加 `.henira-app` 前缀，压过 06-controls 的全局按钮基线。
  5. **测试**：新增 `buildProcessItems` / `buildTurnLayout` 单测 7 例（思考+单工具折组、交错同组、未知/MCP 断组、修改去重与路径未知、空步剔除与中断断组、完成轮折叠、运行中不折）；组件补修改组文件名 1 例。
  6. **箭头**：行/组/思考箭头 12→16px；展开态只旋转，显隐仍归 hover/focus（对齐参照；常显提示退场）。
  7. **文案与 API**：调用参数 / 查看调用详情 / 暂无结果 / 等待结果 / 无参数（对齐参照词表）；`ToolRow.secondary` 的 title 只对字符串生成；删未用的 `useId` 与死词条 `turn.durationPrefix`。
  8. **卫生**：4 条 CSS 降序警告清零；copy 脚本先清 `dist/styles`；`.henira-file-link` 两段声明合一。
- **理由**：审查抓到的都是「自测覆盖不到的形状层偏差」；尤其组体图标/导线与组头文案会直接决定展开后的观感，而核心分组规则无单测意味着下一次改动仍可能悄悄回退。
- **非目标（挂账）**：edit 的 old==new 回落通用卡（无变化时该显示什么待拍板）；折叠/组开合态跨虚拟窗口持久（参照实现同为本地 state）；右栏文件预览与修改组文件名可点（沿 D-069 挂账）。
- **备注**：测试 = web-ui 124 例（+8：分组纯函数 7 + 修改组文件名 1；全仓 621 过 / 1 skip，e2e 27 过 / 1 skip）；七门禁 + build + bundle 全绿；真 key 活体 = Agnes 3.0 Flash（思考 → write a/b → edit a → 最终回答含 ts 代码块），浏览器实测：组体图标 `display:none`、思考体 border/margin/padding 归零、组头收起「已修改 2 文件 a.txt，b.txt」/展开回统计、代码块头按钮 border 0 + 透明底；明暗双主题截图存 `artifacts/r179/`（不入库）。

## D-071 审批卡与排队卡按参照重排（R180）

- **状态**：已定 · 2026-11-22 · 用户实拍点名「审批卡的卡片太丑 / 排队卡也看下参照」；✓ 同日落码
- **背景**：两张卡都把「信息卡」做成了「警报块」。审批卡 = 黄底 + 左警示边 + 状态/工具名徽章 + 三枚胶囊按钮 + 裸排 diff；参照实现 = 中性弹层卡（border + radius-2xl + popover 底）、「权限请求」标题、工具块预览、**编号选项行（主文案 + 说明）**、底部键盘提示。排队卡 = 标题行「排队消息 + 计数」+ 12px 弱文字行 + 三枚方块图标；参照实现 = 贴在输入卡上沿的静音列表（无标题/计数头）、14px 主文字、行内动作、暂停提示条。
- **决定**：
  1. **审批卡 chrome**：中性弹层卡（`--henira-panel` + border + radius-xl + 轻阴影），去黄底/左警示边/状态徽章/mono 工具名；标题「权限请求」弱色；队列数 >1 时弱色尾注；`role=dialog` 与 `ApprovalCardShell` 出口不变。
  2. **预览块**：工具行 chrome（图标 + 「等待审批」+ 工具身份）+ 内容卡（edit/write = 文件行 + ±N + diff；bash = `$ 命令`；read/glob/grep = 路径；兜底 = JSON），不再裸排。
  3. **选项行**：编号 + 主文案 + 说明三段（允许/仅这一次、本会话允许/本会话内不再询问、拒绝/这次先拒绝），首行默认底、hover 提亮；**点击即决定保留**；Enter=允许一次 / Esc=拒绝保留；底部弱色键盘提示。**修活体抓到的真 bug：window 键监听加可编辑控件守卫**——焦点在输入框时打字 Enter 不再误放行审批。
  4. **排队卡**：去标题/计数头（`ul` 的 aria-label 保留给读屏与测试），14px 主文字行、`--henira-card-bg` 底 + radius-xl、steer 徽章、行动作 hover/focus 浮现（沿用 R171 裁定，不做常驻方块阵）；暂停态 = 中性提示条 + 继续发送（前缀压全局按钮基线）。
  5. **不动**：`approval.view.<工具名>` / `composer.queue.*` 词表、审批乐观摘卡/回滚、Enter/Esc 语义、队列 promote/remove/resume 端点与 UI 数据源。
- **理由**：审批与排队是输入区的延伸，不是系统警报；层级应靠字重与留白，而不是底色与徽章。参照的可观察结构（中性卡 + 编号选项 + 静音列表）直接解决「丑」的根因，同时保留本仓一键应答与动作浮现两个既有裁定。
- **非目标（挂账）**：审批卡底部独立「确认」按钮（参照模型 = 选中 + 确认；本仓保留点击即决定，避免多一步）；排队行拖拽排序 / 编辑冻结锁（既有挂账）；审批选项的前缀规则 scope 展示（bash 前缀级规则挂账）。
- **备注**：落点 = interfaces.md web 段（审批/排队卡条）；测试 = web-ui 125 例（+1 键盘守卫；全仓 622 过 / 1 skip，e2e 27 过 / 1 skip）；七门禁 + build + bundle 全绿；活体 = Agnes 3.0 Flash（bash sleep 审批 → 允许 → 忙时入队），明暗双主题截图存 `artifacts/r180/`（不入库）；活体顺带抓修：审批卡 window 键监听会在输入框打字时误放行（已加可编辑控件守卫）。

## D-072 输入座位与 chain 槽（R182）

- **状态**：已定 · 2026-11-22 · 用户拍板「样式看 ZCode，机制看 dsh」；✓ 同日落码
- **背景**：输入框视觉与拆件两件事一起暴露。视觉上我们的卡是灰底 + 16% 重边 + 无影、编辑区 30px、工具排 12px 小字、占位塞键盘教学；参照实现的输入卡是白底 + 10% 细边 + 两层轻影、编辑区最小 40px / 最大 160px、工具排 28px / 14px、占位随状态变。机制上用户追问「模型选择、思考等级、上下文、加号菜单、权限、输入框自身是不是每一个都是插件」——取证结论：dsh 不是「每个零件都是插件」，是**骨架 + 座位**：编辑器 / 加号钮 / 发送停止 / 上下文表留在骨架；模型（含思考档同包）、权限、计划、附件、命令浮层、队列条目各占座位；`conversation.composer` 是 chain 槽，审批/提问/只读子会话按 select 整块替换输入栏（fallback 保持挂载、display:none）。ZCode 没有 chain，只有「隐藏 composer + 交互弹层」的条件分支；它只提供可观测行为与视觉，不提供机制。
- **决定**：
  1. **chain 作为槽库一等 kind**（dsh `SlotKind` 行为层）：条目 = `id + priority + select(owner) + Component`；`priority` 升序、first non-null wins；消费件负责 `fallback` 挂载与 `overlay`（当选时 fallback `display:none` 但保持挂载，草稿/DOM 态不丢）。宿主 API 增加 `registerChainSlot(name, entry, { priority? })` / `replaceChainSlot(name, id, entry)`；官方条目同走公共注册路径，第三方可顶替、卸载按登记回落（D-022 同款冲突判据）。**不搞 composer 私有版、不留「以后再提升」**。
  2. **输入座位拆分**：`composer` = 输入座位（官方件 ComposerDock，chain 接管路由）；新增 `composer.bar` = 常驻输入栏（single，chain fallback，官方默认件 Composer）；新增 `composer.takeover` = 接管 chain（官方默认条目 = 审批）。待审批时输入栏隐藏但挂载，审批卡占同一座位；焦点移入接管容器，决定后回输入栏（用户没把焦点移走时才回焦）。词表 11 → 13。
  3. **视觉（ZCode 行为层）**：输入卡 = `--henira-card-bg` 白底 + `--henira-border`(10%) 细边 + `--henira-radius-xl` + 两层轻影（`--henira-shadow-composer`）；hover / focus-within 只把边框加深到 `--henira-border-strong`(16%)，不再黑边聚焦。编辑区 = 最小 40px / 最大 160px / 行高 20px / 占位 `--henira-text-subtlest`。工具排 = 28px 高、14px 字、hover 浅底不描边；发送/停止 = 28px 圆钮。占位三态：空会话「向 Henira 提问」/ 有历史「提出后续修改要求」/ 忙「继续输入以排队后续修改」；键盘教学与忙态常驻提示退场（发送钮 tooltip 承担修饰键提示）。排队卡 = 上圆角 + 负底边距 + 半透明底 + 毛玻璃，塞到不透明输入卡后面。
  4. **不动**：协议 / 行投影 / 存储 / `approval.view.*` / `composer.queue.*` / 发送停止语义 / 乐观摘卡与回滚 / Enter=允许、Esc=拒绝。
- **理由**：dsh 用一个消费者也把 chain 做成通用机制；我们已有审批这个真实消费者，先把机制做对，提问（R184）到来时只加一条 entry，宿主不用再动。视觉照 ZCode 是因为它是用户点名的观感基准；机制照 dsh 是因为「一切皆插件」的装配基准。两件事同批做，避免同一 dock 被改两遍。
- **非目标（后续批）**：`composer.dock` / `composer.model` / `composer.left` / `composer.right` 四个座位与 composer API 归 R183；向用户提问（第二条 chain entry）归 R184；Esc=停止单独拍；上下文 / 加号 / 发送不做座位（骨架，dsh 同款）。排队面板仍在输入栏内，待审批时随输入栏一起隐藏——R183 `composer.dock` 时移出。
- **备注**：落点 = plugins.md §4/§7.2 + interfaces.md 槽词表/视觉基线；测试 = chain 登记簿 5 例 + ComposerDock 接管/隐藏/焦点 + 占位三态 + 通用 chain 件；e2e 定位器从占位文案改 `data-testid="composer-input"`（占位变三态后文案不再稳定）。

## D-073 输入座位四席与 Composer API（R183）

- **状态**：已定 · 2026-11-22 · 用户拍板批 R183（「加 composer.dock / composer.model / composer.left / composer.right 四个座位 + composer API，配自己的测试矩阵」）；✓ 同日落码
- **背景**：R182 只拆出 `composer` / `composer.bar` / `composer.takeover`，模型与思考、排队、工具排左右仍长在 Composer 私有 state：第三方无法在工具排加按钮、无法替换模型控件、`composer.dock` 不存在；排队面板住在 bar 内，审批接管时随 bar 一起 `display:none`（用户点名的遗留）。dsh 的座位取证：`input.left` / `input.right` 是官方空的 list（工具排左、发送钮前），`input.model` 是 single（模型 + 思考同一包），dock 条目在卡外、chain 之外；`composer.bar` 也是 single。
- **决定**：
  1. **四席入词表**（13 → 17）：`composer.model`（single，官方默认件 ModelSeat = 模型选择器 + 思考档）· `composer.left`（list，工具排左追加位，官方空）· `composer.right`（list，工具排右追加位，官方空）· `composer.dock`（list，输入卡外通栏条目，官方默认件 QueueDock = 排队面板）。dsh 的 `input.dock`（卡上）/`composer.dock`（卡下）两缝在本轮合并为一个 `composer.dock`（卡上，装第一个真实消费者排队面板）；卡下缝等第二个消费者再拆。
  2. **single 槽语义落码**（dsh `SlotKind.single` 行为层）：登记簿增 `isSingleSlot` 判定；命中槽的 `registerSlot` 与 `replaceSlot` 同走认领/回落（同一时刻一位占用、卸载回落前件、第二家第三方报冲突）。当前 single 集 = `composer.bar` / `composer.model`；其余 list 追加不变。
  3. **Composer API**：`WebPartContext.composer`（`ComposerApi`），ComposerDock 以 `{...ctx, composer}` 注入全部 `composer.*` 件。面 = 草稿（`draft/setDraft`，会话级 uiState 双写）· 焦点（`focus/registerInput`，bar 登记 textarea）· 按次模型绑定（`model/setModel/effort/setEffort/catalog/settingsReady`）· 发送（`submit/stop`）· 审批面（`pendingApproval/approvalQueueTotal/onApprovalDecided/onApprovalFailed`）。状态唯一真源上移为 `useComposerRuntime`（ComposerDock 内），`Composer` 退成纯 bar 视图（单独渲染 fail-loud）；`ModelSeat` 承接档位派生与切模型 clamp。
  4. **排队面板移出 bar**：官方 QueueDock 注册进 `composer.dock`，由 ComposerDock 在 bar 外渲染；接管时 bar 隐藏而 dock 仍可见。接管容器补 `position:relative/z-index:1`，排队卡继续从卡后沿长出。
  5. **不动**：协议 / 行投影 / 存储 / `approval.view.*` / `composer.queue.*` / 发送停止语义 / 审批乐观摘卡与回滚 / 视觉基线（只新增座位容器与层叠）。
- **理由**：座位是「一切皆插件」在输入区的最后一段硬编码；模型席按 dsh single 语义落码后，第三方顶替是显式路径（`replaceSlot`）而非追加出两个控件。API 上移是因为 dock 与座位件必须共享草稿/焦点/绑定——状态若继续住在 bar，`composer.dock` 只能靠私有桥接，等于留下第二个真源。
- **非目标（挂账）**：attachments / permission / plan / activity / overlay 座位（功能落地时再加）；`ask_user` 与第二条 chain entry 归 R184；Esc=停止单独拍；审批卡宽度（仍 = 输入座位全宽）。
- **备注**：落点 = plugins.md §4/§7.2 + interfaces.md 槽词表/ComposerApi；测试 = 登记簿 single 3 例 + 四席/API 3 例 + 既有 Composer 测试整座迁移；e2e 定位器不变（`data-testid="composer-input"`）。

## D-074 ask_user：执行中向用户提问（专用工具 + 提问交互种类）

- **状态**：已定 · 2026-11-23 · R184 落码批；修订 D-041 批次表（官方件 22→23、首发批 11→12，二批三批名单与时点不变）
- **背景**：交互族只有「执行前审批」与「发送前排队」，模型执行中无法向用户要信息——只能猜或中断回合。协议早已留位（interaction 槽注释「question 类随首个消费者扩展」）、chain 槽给提问预留 priority 0–9。取证两路（2026-11-23）：dsh 有专用工具 `ask_user_question` + 独立 `UserQuestionService`，**明确不与审批合并**（notes：复用权限通道会把两种产品概念压扁），答复即工具结果、阻塞等待无超时、重启不重问；ZCode 则把提问做成审批通道的 `requiresUserInteraction` + modify 折回，但卡片语义成熟（无预选 / 自动自定义项 / 逐题分页 / Esc 回退取消 / IME 守卫 / 痕迹行留问答对、不伪造 user 消息）。
- **决定**：
  1. **机制照 dsh**：新增官方引擎插件 `plugin-ask-user`（`ask_user` 工具），普通工具调用 await 答复，**答复即工具结果**；不借用审批通道、不折回 modifiedInput。工具 `isConcurrencySafe: true`（无副作用，且必须绕过审批默认链——否则提问前先弹审批）。
  2. **交互种类扩协议**：`InteractionRequest` / `InteractionAnswer` 判别联合扩 `kind:"question"`（答案数组 + `cancelled:true` 两变体）；一个服务承载两类，settle 种类必须匹配（防跨通道误收）。
  3. **审计对 + 行投影**：`question/asked` + `question/settled{outcome: answered|cancelled|invalidated, answers?}`；`QuestionRow`（rowId `q:<requestId>`，题面自足）进 Row 词表；收口 REST `POST /api/sessions/:id/questions/:requestId`（answers 或 cancelled；400/404/幂等语义同审批）；SDK `settleQuestion` 双形态。
  4. **UI 照 ZCode**：`composer.takeover` 第二条官方条目 `question`（**priority 5 压过审批 10**——dsh 客户端 precedence 1>0 行为层；两条都挂起时先显示提问）；提问卡无预选、选项按钮 + ARIA、自定义输入恒在末位（模型不得自带 Other）、逐题分页、Space 多选、Enter 推进 / 末题提交、Ctrl/Cmd+Enter 随时提交、Esc 首题取消整个请求 / 后题回退、IME 组合不提交、空选 = 跳过；乐观摘卡 / 失败回滚 / 404 视为已解决（同审批）。痕迹行 = `tool.call.view.ask_user` 官方卡（挂起「提问中」/完成逐题问答/取消「已取消」），question 行不进正文流（同 approval）。
  5. **取消与重启**：用户取消 / 回合 abort / 交互服务缺席 → 工具 Error 结果、**回合继续**（模型自行判断或重问）；**不做墙钟自动收口**（dsh 阻塞模式没有；此前口头提过的 5 分钟自动收口是 ZCode 专属，不采用）；重启 = 既有 repair 补 `question/settled{invalidated}` + `turn/end{interrupted}`，不重问、不自动答。
  6. **编排落点**：`plugin-ask-user` 进 defaultPreset（可停用、不可卸载）；ComposerApi 扩 `pendingQuestion/questionQueueTotal/onQuestionDecided/onQuestionFailed`；submit 让位判据 = 未答审批 **或** 未答提问（answered 过滤后；乐观已答不拦）。
- **理由**：提问是澄清表单、审批是闭合裁决——合并会让「提问」变成「先审批再提问」，且答案形状被迫压进 Decision 词表；dsh 的不合并是结构上更干净的一条。UI 取 ZCode 是因为它的卡片交互语义已被真实用户使用打磨（预选歧义、IME 误提交、Esc 误取消都是踩过的坑）。提问卡第三方可整只换（chain 条目 `replaceChainSlot("composer.takeover")` 同 id；痕迹卡走 keyed 缝），「一切皆插件」不破。
- **非目标**：MCP elicitation / prompts（50-open 仍挂）；plan-review 式提问；超时自动收口；伪造 user 消息；Esc=停止混合语义（单独拍）。
- **备注**：落点 = protocol interaction/server-events/projection + plugins/session validators/store repair + plugins/ask-user + server interaction-service/app + sdk facade/client/runtime + plugins/web-ui（composer-dock/question-card/tool-cards/locale/css/module）+ 文档五处；测试 = 协议联合/投影/修复、工具三路取消、server REST 全链、SDK 双形态、web-ui 7 例、e2e 答题+取消、真 key 活体双主题。
