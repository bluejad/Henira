# 待讨论问题清单

> 工作方式：讨论定稿一条 → 勾掉 + 结论落进对应文档（原则级改动进 ADR，其余改进对应架构文件）。
> 标注：🔴 阻塞实施（M1 前必须定）· 🟡 M2–M4 前定即可 · 🟢 低优。

---

## 🔴 阻塞实施（M1 开工前定稿）

_无。M1 开工前的阻塞项已全部定稿。_

## 🟡 M2–M4 前定稿

- [ ] **`plugin-tasks` 设计文档**——11 个工具的形状、"一条主线"规则细则、喂给模型的四层机制（工具回显 / 代码提醒 / 收尾把关 / 工具拉取；其中 `key` 提醒与压缩后重注入已入 [session.md](./20-architecture/session.md) §4）、按日志重建所需的快照形状（排期已定：M5，见 D-041；**D-049 后 = 任务服务件 + plan / todo 工具件三包**，服务契约占位见 [interfaces.md](./20-architecture/interfaces.md) 能力服务表）
- [ ] **网页界面 v1 边界（M4 前置）**——界面 UI 形态与三个挂载点已定（D-021）；设置页范围按 M3 判据（默认模型 / 主题 / 密钥；插件管理面随 M4，D-029）；剩：命令怎么进输入框（`CommandService` 形状已定，D-025；剩 UI 交互：菜单 / 补全 / 插入还是直接发送）。定稿前命令部分不动工（命令插件随读者 4 批挪 M6，D-041）
- [ ] **`plugin-compaction` 设计文档**——成熟参数已取证照抄：预算 = 模型窗口 × 0.8（dsh `thresholdRatio 0.8`）、热尾巴按量 ≈ 窗口 10%、原子单元不拆 assistant + tool 结果、摘要失败降级必须可见（P2）、替换区间不碰头部系统块（session.md §4）、摘要请求由插件经模型槽位自调；M5 落码前定稿（D-041）
- [ ] **`plugin-subagent` 设计文档**——成熟参数已取证：暴露为一个工具、并发上限 8 / 嵌套深度 1（dsh `subagent/src/index.ts:186,194`）、报告即工具结果（限长可配）、取消经 signal 传导（`ToolContext` 已有）、后台完成注入守卫（忙则排队、回合末冲刷，D-045 同款）；审批规则见 [tools-approval.md](./20-architecture/tools-approval.md) §3.2；M5 落码前定稿（D-041）

## 🟢 低优

- [ ] **serial 事件模式去留**——kernel 四模式中 serial 消费 / 注册两侧当前全库零命中（2026-11-17 查实：emit = loop 全部引擎事件；waterfall = tools 管线两缝；bail = 熔断件已定 M4 首发批，2026-11-17 拍板见 D-058）。保留理由存在：plugin-hooks（M6 批）"事件上顺序执行外部命令"是 serial 语义的天然消费者——M6 落码时复评，届时仍无消费者再议删（kernel 模式 4→3 是架构动作，立 ADR）
- [ ] **性能基准实测（M5 compaction 落码顺带）**——四项零实测：deriveMessages 长会话全量派生 / JSONL 单文件全量读入 / fork 整目录复制成本 / 断线重连全量快照；设计均有重开条件、无实测数字。可选：M4 取证 pass 捎带跑一个大日志 deriveMessages 基准先有个底
- [x] **deepseek / agnes 思考参数形状（R145 ⑥挂账，2026-11-18；2026-11-19 思考档批销账）**——真 key 采样 + 官方文档双证：deepseek = `thinking:{type:"enabled"/"disabled"}` + `reasoning_effort`（low/high/max，medium 由服务端 clamp 到 high）；agnes = `chat_template_kwargs:{enable_thinking:boolean}`（仅开/关，采样实锤 reasoning_content 出现）；档位集合已改数据驱动（models.dev `reasoning_options`：toggle/effort values——快照与刷新管线补保真）、思维链回传（`interleaved` 声明 + 开思考 → 历史 assistant 带 reasoning_content）已落码
- [ ] **思考档剩余挂账（2026-11-19 思考档批）**——①~~deepseek 真 key 采样~~（2026-11-19 已验：thinking disabled 真关、effort low/medium/high/max 四值全 200、**工具轮不带 reasoning_content 也 200 不强制**——旧版注释的 400 在这代端点未复现，回传保留因多轮一致性无坏处）；②zhipu 数据说 effort[low/high/max]、实现发 thinking 开关（R142 活体过）——统一口径待采样复核；③moonshotai/kimi 数据有 effort 但形状表未收录（仍 none）——采样后加一行形状；④老会话工具轮 reasoning 未落账本（无法回填）——现证不强制回传，老会话风险解除，仅多轮一致性略降；⑤budget 型（anthropic/google budget_tokens）未接

- [ ] 黑窗口聊天（cli 包）与 Repl 命令集、流式渲染——发布后启做
- [ ] **plugin-mcp 后续扩展（C5 落码后挂账，D-064 范围外清单）**——OAuth（远程 server 授权流；三家参照物都有，机器量大）；SSE-only 旧 transport（声明即跳过+告警）；MCP prompt templates / resources / elicitation / sampling；server instructions 注入系统提示（涉头部稳定性，须与压缩预算同议）；进程级连接池共享（hosts.md §3「每 server 进程级共享」语义，v1 每会话独立连接）；管理面连接状态显示与重连钮（v1 只有声明/目标/确认态）；图像 / 音频结果 blob 落盘 + 路径指针（现占位行文本）；MCP 工具描述长度上限（防 OpenAPI 型 server 撑爆工具表）
- [ ] **fs / shell 工具后续扩展（批 B 落码后挂账，D-065 范围外清单）**——read 的图片 / PDF / notebook 特化（现二进制一律报错）；grep offset 分页与 head_limit 0=不限；grep `-A/-B` 不对称窗口（现归并为对称 context）；edit 模糊匹配阶梯（引号归一 / 行修剪 / 缩进弹性——参照物最深 8 级）与多段批量编辑；shell 后台任务（run_in_background / 超时转后台——四家参照物都有）与持久会话 / cwd 持久化（持久化是 workingDirectory 服务的唯一潜在消费者）；fs 围栏 symlink 真实归属检查（现词法）；grep ripgrep 加速（有 rg on PATH 时可选外挂）；灾难命令清单 v2（PowerShell 破坏动词 `Remove-Item -Recurse` / `rd /s` 等——现清单为四家同款最小集，硬拒错杀代价不对称故未扩）；breaker 升级为多级提示链（提醒 → 收紧 → 否决的分档）。
- [ ] TUI 拓扑：**倾向 C1** 薄客户端连本地 server（终端"不起服务"的坑位由发布后 cli 聊天占住）——共同成本是 InteractionService 终端实现；发布后按需求定稿（[hosts.md](./20-architecture/hosts.md) §6）
- [ ] 移动端层次：**倾向远程客户端先行**（复用①栈；第一步响应式网页 / PWA，原生壳后置）；proot 手机本地执行为执行环境课题单独立项；发布后按需求定稿（移动 UI 词表已随 D-033 推迟）
- [ ] 本地沙箱插件设计：**倾向暂缓 + 容器过渡**（`henira serve` 跑进容器 / devcontainer 即得隔离；需 SandboxService 新槽位，开工时立 ADR）；与云已定不共用（D-036）
- [ ] CI 矩阵（node 20/22/24 × win/linux/mac？）
- [ ] 文档英文版时机（M4 判据已含 README 英文，docs 是否全翻）
- [ ] 发布后的 backlog 排期（评测闭环、沙箱、ACP 等协议接入、进程边界 SDK、conformance 守护套件的再评估）

---

_已定稿归档区（勾掉的问题在这里留一行结论 + 指向）_

- ✅ 文档结构粒度——docs/ 16 份文件（2026-11-11，D-009；2026-11-12 增 plugins.md、2026-11-13 增 hosts.md 后为 17；2026-11-14 调研存档定为两份、总数 16，D-047）
- ✅ 架构形态——机制内核 + 一切皆插件，官方语义包可整包替换（2026-11-11，D-010）；放弃"语义内核 + 只增不改"方案
- ✅ 守护方式——**不做 conformance 套件**（YAGNI，开源用户自主组装责任自负；生态成熟后再评估）；官方默认 = 安全默认 + 文档责任声明（D-010 配套）
- ✅ 装配机制——TS API（开发者）+ `henira.config.ts`（开发者手写），**无 YAML patch**（2026-11-11，D-011；后由 D-015 收窄：最终用户面 = 界面 + settings.json）；重开后门：跨语言 SDK / 多 profile / 热改需求出现时从上往下加翻译层
- ✅ 事件模式——定为 4 种：emit / serial / waterfall / **bail**（否决）（D-012①）
- ✅ 槽位接口归属——全部放 protocol，kernel 保持纯机制（D-012②）
- ✅ 插件物理位置——语义 5 + 能力 5 全进 `plugins/`，`packages/` 只留 kernel / protocol / 宿主（D-012③；后扩为 16 见 D-018 / D-043、再至 21 见 D-049）
- ✅ config 读取器——独立小包 `@henira/config-loader`，宿主层共享（D-012④）
- ✅ 凭据硬拒清单——由官方 approval 插件承担（kernel 不承载业务策略）（D-012④）
- ✅ 死循环熔断——官方插件，走 `loop/turn-stopping`（bail）缝（loop.md §4）
- ✅ 交互槽位——新增 `InteractionService`（protocol），approval 只管策略，弹卡收答归宿主（D-013①）
- ✅ 配置槽位——新增 `ConfigService`（protocol），llm / approval 不直接读 env 或文件（D-013②）
- ✅ protocol 最小化规则——只放"两个插件必须一致的东西"（D-013③）
- ✅ 替换者责任清单——6 条写入 principles.md P8（D-013④）
- ✅ bail 去留——保留；理由改为官方熔断插件的真实需求（D-013⑤）
- ✅ 会话存储路径与运行数据目录——两层结构（`~/.henira/` + 项目内 `.henira/`）、`--<slug60>-<hash8>--` 命名、检查点平行树（2026-11-11，D-014，[data-directory.md](./20-architecture/data-directory.md)）
- ✅ JSONL 写入语义——追加 + `fsync`；读取时丢弃末尾半行；`tmp + rename` 只用于 meta / 注册表这类整体重写文件（2026-11-11，session.md §5）
- ✅ 数据模型三处归属——压缩 = 替换记录（原事件永久保留、区间只前移）；审批问答对在回合内且不进模型历史、没有打开回合不记、先落 decided 再执行；权限分两层（会话内 = 事件，跨会话 = `config/permissions.json`）（2026-11-12，session.md §1.1 / §4、tools-approval.md §3.1）
- ✅ **事件词表 v0**——15 个类型；信封 `{type, seq, time, data, ignorable?}` + 第 1 行不可变 `SessionHeader`；`turn/start`·`turn/end` 命名；每条事件显式带 turn/step；`surfaceOp` 作为压缩唯一机制入口；`turn/end.reason` 7 值；`request/header` 每请求快照；`assistant/attempt` 保留；保留域 + 包名前缀的命名规则；fork 实现 = 复制前缀，切点在半回合处补 `turn/end{forked}`（2026-11-12，session.md §2–§6）
- ✅ **kernel 签名**——`name?`（插件可不占槽位）；`Veto = {by, reason, resume?}`、`bail(): Promise<Veto|undefined>`；四模式四条注册方法（`on` / `onSerial` / `onWaterfall` / `onBail`）；四类错误时机（缺槽位 / 重名在 use / start 后 use / inject 静态检查）；`effect()` 与 `stop()` 分工；类型化门面 `HeniraContext` 留 protocol（2026-11-12，interfaces.md §kernel）
- ✅ **会话级数据归属**——附件、子代理记录、侧问、计划、任务全部进会话目录（相对路径，删除 / fork 只动一个目录）；`system/message.key` 同名最新者胜；压缩后重注入（2026-11-12，data-directory.md §2.1、session.md §2.2 / §4 / §6）
- ✅ **侧问（sidechats）**——就是一个挂在主问上的主问：`sessions/<sessionId>/sidechats/<sideChatId>/` 嵌套小会话目录，结构同会话目录，不并入主日志（2026-11-12，data-directory.md §2.1）
- ✅ **计划 / 任务的存储**——会话目录内的文件：`plans/index.json` + `plans/<slug>.md` + `tasks/<id>.json`（通用清单字段；刻意不设 `sessionId` 与 `path`）；会话日志与 `meta.json` 不含计划 / 任务字段；只有插件写、不支持手工改；日志照记，对不上时按日志重建。**同日曾先定为"无独立文件、状态只在日志"，后改定为文件方案**——同步是所有会话内文件的共性问题，统一处理即可（2026-11-12，data-directory.md §2.2）
- ✅ **计划与任务是一个插件**——`@henira/plugin-tasks`（外圈，不占槽位，无需 ADR；计划部分可关）：两者共用"一条主线"状态，拆开则两个插件互改对方数据、须在 protocol 新增公共接口（2026-11-12，packages.md。**后被 D-049 修订**：共用状态改由任务服务承接——拆为 tasks 服务件 + plan / todo 工具件，当年"须新增公共接口"的顾虑正是服务化的前提）
- ✅ **配置面**——官方默认预设从 config-loader 导出（无 config 文件即用它；想改 = TS import spread，无 patch 语法）；配置两文件：`~/.henira/config/settings.json`（界面上点、程序写：model / plugins / ui）与项目 `henira.config.ts`（开发者手写：model / plugins / options），同一项听项目的（2026-11-12，D-015，interfaces.md §config-loader、data-directory.md §2.3）
- ✅ **插件启用与装配**——装了就生效 + settings.json 开关（缺 key = 启用）；装配三步（基础清单 → 加已装目录 → 去关掉的；同 id 不重复算，同名项目盖用户级）；**对新会话立即生效**，运行中会话不变；官方替换 = henira.config.ts 显式写清单，不做目录自动顶替；内圈 5 槽位不给关（2026-11-12，D-016，plugins.md §5）
- ✅ **插件格式与来源**——版本目录 = 清单 + `index.js`（约定名，纯内容包可无）+ 开放内容目录（skills / commands / hooks / mcp / agents / ui + 自由区）；依赖发布时单文件打包；唯一用户侧来源 = **AI 自己创建**（内容包）；术语定"界面 UI"（2026-11-12，D-017，plugins.md。**后被 D-019 修订**：生态兼容恢复，排除的是导入 / 同步管线；**后被 D-021 补充**：`ui/` 可带界面模块代码；**后被 D-048 修订**：新增 `engine/` 引擎代码槽位、依赖放开 pnpm，`index.js` 占位作废）
- ✅ **生态兼容澄清**——不做导入 / 同步管线（界面无入口、后台不扫描）与市场货架机器；格式采用行业标准（agentskills.io / MCP 标准协议 / 聚合 hooks.json / 生态变量），市面上现成的直接可用（2026-11-12，D-019，plugins.md §4）
- ✅ **排期甲与里程碑调整**——官方插件 11 → **15**（+ skills / mcp / hooks / commands），全进 M4；"网页界面边界"升为 M4 前置；黑窗口聊天推迟到发布后（启动服务的命令保留）（2026-11-12，D-018，40-roadmap.md、packages.md）
- ✅ **技能来源补口**——只读扫描项目 `.agents/skills/` 与用户 `~/.agents/skills/`（agentskills.io 标准）；优先级 项目插件 > 项目 `.agents` > 用户插件 > 用户 `.agents`；不创建 / 不复制 / 不登记；不新造 `~/.henira/skills`（2026-11-12，D-020，plugins.md §4、data-directory.md §1；后由 D-026 增第五级"官方随包"；**D-032 再调整为 项目 `.agents` > 项目插件 > 用户 `.agents` > 用户插件 > 官方随包**）
- ✅ **界面 UI 形态**——ESM 模块 + 类型化挂载点（不 eval、不 `new Function`）；`ui/main.js` 导出 `apply(ctx)`，门面先只有 `registerSlot`（后由 D-028 扩为 12 方法宿主门面）；v1 三个挂载点 `session.top` / `composer.above` / `sidebar.right`；`ui/` 是唯一可带代码的口子（2026-11-12，D-021，plugins.md §3/§4；**后由 D-048 新增 `engine/` 引擎代码槽位，`ui/` 不再是唯一代码口子**）
- ✅ **替换粒度**——整份清单 + TS 表达式（`defaultPreset.filter / map / spread`），不设按 id 的补丁层；同一槽位两个插件 = 内核报错（2026-11-12，D-022，interfaces.md §config-loader）
- ✅ **内核自研**——不 vendor cordis；M1 增"语义钉子"测试清单，M2 收尾设 vendor 评估闸门（2026-11-12，D-023，interfaces.md §kernel、40-roadmap.md M1/M2）
- ✅ **插件更新语义**——写新版本目录（版本级不可变，旧版本保留可回滚）；`settings.json plugins.<id>.version` 钉版本（2026-11-12，D-024，plugins.md §6）
- ✅ **命令投递通道**——protocol 新增 `CommandService` 槽位（list / expand），官方 plugin-commands 实现并占用；宿主把展开文本放进输入框（2026-11-12，D-025，interfaces.md、packages.md）
- ✅ **官方随包技能**——官方 npm 包内 `skills/` 作第五级来源（最低优先级）；创建技能随 plugin-skills 发布（2026-11-12，D-026，修订 D-020）
- ✅ **事件缝命名统一**——工具缝 `tools/pre-execute` / `tools/post-execute`；审批钩子缝 `approval/request`；loop 缝 `loop/pre-step` / `loop/request` / `loop/turn-stopping`（2026-11-12，D-027，loop.md §4、tools-approval.md §2/§3）
- ✅ **插件 UI 宿主门面**——C 档 12 方法（对话 / 数据 / 宿主三组）；单向阀（UI→中柱仅 `sendPrompt`，AI→UI 无事件流）；`useResource` 数据泵（2026-11-12，D-028，interfaces.md、plugins.md §4）
- ✅ **插件管理面**——列表 / 详情 / 版本 / 启停 / 卸载 / 数据区；安装 = AI 创建版本目录，不建导入 / 市场（2026-11-12，D-029，plugins.md §6.4、data-directory.md §7）
- ✅ **插件安全基线**——凭据不进插件文件、静态资源 CSP sandbox、MCP 变更确认、hooks 明示（2026-11-12，D-030，plugins.md §4、data-directory.md §8）
- ✅ **插件硬缺口**——槽位校验与失败语义、UI 更新生效、创建技能工作流（2026-11-12，plugins.md §4/§6）
- ✅ **UI 位置静态申报**——可选 `ui.slots` + 运行时 `registerSlot` 权威；声明与注册不一致告警不阻断（2026-11-12，D-031，plugins.md §3/§4）
- ✅ **同名覆盖统一口径**——项目独立定义 > 项目插件 > 用户独立定义 > 用户插件 > 官方随包；命令 / 子代理 / 同名插件一并适用；D-020 / D-026 技能顺序随之修订（2026-11-12，D-032，plugins.md §7.1）
- ✅ **宿主槽位词表**——v1 桌面三个；`session.top` / `composer.above` 为 web 系共享核心，`sidebar.right` 仅桌面；移动端词表等移动 UI 设计时定；按需扩展，不做 7×5（2026-11-12，D-033，plugins.md §7.2；**后由 D-057 扩行级四缝 3→7、D-062 正名 `sidebar` / `conversation` / `composer` ＋扩结构性 `layout` 与右栏 tab 框架 7→10**）
- ✅ **宿主形态总口径**——引擎是库、宿主决定住处；三拓扑 ①一对多 / ②一对一（①的退化用法）/ ③零服务；Web 与桌面住 ①、headless 与 sdk 住 ③；server 是宿主之一不是必经层（2026-11-13，D-034，hosts.md）
- ✅ **桌面宿主＝A1**——utilityProcess 起 server 子进程＋窗口加载回环；server 升正式宿主；回环三件套（只绑 127.0.0.1 / 随机端口 / Host 校验＋token 位）（2026-11-13，D-035，hosts.md、packages.md）
- ✅ **云端＝分层丙案**——token / user 字段进 server，容器编排 = `examples/cloud` 样例，不立 cloud 宿主包；云容器本身即沙箱（2026-11-13，D-036，hosts.md、packages.md）
- ✅ **npm 形态与 headless 入口**——`@henira/sdk` 纯 TS（零 React）+ `@henira/web` 可嵌入（注入 client），不造 `@henira/sdk/web` 子路径、不把 UI 搬进 sdk；headless = cli 子命令 `henira run`，不立独立包（2026-11-13，D-037，hosts.md、packages.md）
- ✅ **web 升正式宿主**——与 server 同级，"宿主示例"表述移除（2026-11-13，D-038，packages.md、00-vision.md）
- ✅ **examples 目录形态**——mock（离线 e2e 载体，M2）+ real（真实模型 demo，M2）+ cloud（部署样例，D-036）三者角色已定（2026-11-13，packages.md、40-roadmap.md）
- ✅ **fork 复制粒度**——整目录复制（含分叉点后产生的子代理记录 / 侧问；计划 / 任务按日志重建到分叉点）；"截断丢弃 transcript"式裁剪不采用：裁剪要对日志外的文件做时间对齐，机器不小、收益只是"分叉会话里少看见几条记录"（2026-11-13，session.md §6）
- ✅ **云端会话归属字段**——SessionHeader 增可选 `user?`（云端部署写入归属者，本地缺省；fork / 侧问随 header 复制）——D-036 第 2 项收口（2026-11-13，session.md §2.1、hosts.md §5）
- ✅ **审批默认放行面**——判定链补默认放行层：只读标记（`isConcurrencySafe`）无规则命中即自动放行并落审计；灾难操作硬拒与凭据同列链外；路径围栏由官方 fs / shell 工具内部实现（区内直行、区外问、凭据灾难硬拒）；deny 压倒一切；web_fetch 类只读免问；headless 开箱可跑只读任务（2026-11-13，D-039，tools-approval.md §3；实证 ZCode / Claude Code / OpenCode 同构。**围栏归属后被 D-049 修订**：围栏跟着能力走，住进 fs 服务）
- ✅ **多会话进程模型**——①宿主 = 进程壳 + 每会话一个 harness 实例（装配每会话执行即此语义）；进程级共享 HTTP / SSE、server.json、设置缓存与 MCP 连接管理器；每会话一回合闸、跨会话无上限（2026-11-13，hosts.md §3；ZCode / OpenCode 同构实证）
- ✅ **子代理审批**——前台问（经父会话 UI、origin 标注来源）/ 后台永不问（fail-closed 拒、写进报告）/ 两种都继承父会话规则；不采用 dsh 钉死 never + 工具收紧案（2026-11-13，D-039，tools-approval.md §3.2；Claude Code 前台 / 后台分法）
- ✅ **工具结果截断与附件上限**——执行出口统一限量（默认 2000 行 / 50KB 可配），超限落盘留路径 + 预览 + 截断尾注可见；工具可自定更严上限；附件宿主入口校验（单文件 20MB / 图片 5MB / 单消息 50MB / 100 个）（2026-11-13，tools-approval.md §1.1、session.md §2.2；ZCode / OpenCode / Claude Code 同构）
- ✅ **系统提示组装**——机制不新增（system/message + key 即组装）；基底身份归官方 loop 插件；块序 = seq 顺序（前缀稳定 = 厂商缓存）；压缩不碰头部系统块（2026-11-13，session.md §4、loop.md；dsh / OpenCode / Claude Code / ZCode 实证）
- ✅ **模型接入与参数字典**——接模型 = AI SDK 直接用不自研（D-007 钉死）；模型参数字典 = models.dev（配置层同步：运行时拉＋缓存＋快照兜底，断网可用）；配置入口不动（models.json ＋ settings.json 选默认），字典只预填能力参数、手写覆盖字典；引擎零网络零厂商表（2026-11-13，D-040；ZCode＝AI SDK＋自带表 / OpenCode＝自研＋models.dev 活字典，各取一半）
- ✅ **官方插件排期拆批**——15 个分三批随版本发布：首发（M4，v0.1.0）＝引擎 5＋fs＋shell＋规范/管理面/changesets；二批（M5）＝fetch / compaction / subagent / tasks；三批（M6）＝读者 4；P8 清单不动，批次只管发布时点；内圈引擎 5 是唯一不能延的（2026-11-13，D-041，roadmap M4–M6；修订 D-018；web-ui 第 16 个不占批，D-043）
- ✅ **UI 门面交互方向**——定**双向**：门面增 `subscribe`（本会话、事件类型白名单＋可选 turnId、有界队列背压——增量可丢可并、终局必达；输入仍单口 sendPrompt、不订阅不收）；D-042 修订 D-028 单向阀（2026-11-13，interfaces.md、plugins.md §4；roadmap M4 判据随改）
- ✅ **界面全插件化 + npm 嵌入出口**——官方默认界面 = 真插件（`plugin-web-ui`，官方第 16 个，M3 随 web 诞生，不占三批名额）；宿主 = 框 + 默认装法（**无布局槽**）；区域槽 append / replace / 没装则收起，同区冲突报错；内圈 UI 不给关、不钉版本（D-016 机制）；插件用件走宿主标准件出口（import map 与 react 同口子，禁插件间直连）＋上下文注入承重缝；三级后手（槽位自动回退 → 双击 Alt → URL `?ui=safe` 安全模式）；npm 嵌入 = 同一零件库编译期出口（createWebApp 挑件）（2026-11-13，D-043，packages.md、interfaces.md、plugins.md §4、roadmap M3 / M4；**后由 D-062 立结构性 `layout` 整页框架槽——「无布局槽」修订，区域槽正名 sidebar / conversation / composer，2026-11-18**）
- ✅ **工具 schema 形态**——ToolDefinition 参数声明只收**裸 JSON Schema**（协议唯一形状：模型投影 / MCP tools/list / AI 创建内容包同形零转换）；官方插件直写、不建转换糖；装载期校验、非法 schema 插件跳过 + 告警（2026-11-14，D-044，tools-approval.md §1、interfaces.md；各家公开实现出口全 JSON Schema、AI 创建包是唯一用户侧来源 = 协议单一形状让 AI 没得选）
- ✅ **回合队列与插话（steer）**——忙时投递**唯一 = 排队**（无第二种投递语义、无设置项；闲时直发开新回合，回合末队列依次冲刷）；队列条目**"立即发送" = 插话**，下一个 step 边界进场、不打断正在执行的工具（dsh / ZCode 主流式，Claude Code 行为层同构；中断式不采）；插话落 `user/message` 不新增事件类型；排队按会话持久化（会话目录 `queue.json` tmp+rename）（2026-11-14，D-045，loop.md §1、data-directory.md）
- ✅ **loop step / token 上限**——步数上限**机制保留为可选配置、默认不设**（主循环与子代理均不设，dsh 干净路线；OpenCode 机制可选、Claude Code 行为层同构）；**token 硬顶不做**，上下文规模归压缩预算（2026-11-14，D-045，loop.md §4）
- ✅ **PermissionRequest 形状**——载荷 = `{tool, args 全文, reason?}`，引擎一字不加工；显示折叠归界面 UI（裁剪不是转述，引擎层摘要无人做）；挂起请求自足可渲染（P5 重连重放）；displayReason 不进 v1、M2 落码时按卡片可读性再定（2026-11-14，D-046，tools-approval.md §3.3）
- ✅ **开源卫生：一切引用可公开对证**——来源标签封闭词表（公开仓库实名 + `[用户]`）；教训三分类：公开锚点（公开仓库 + file:line）/ 通用真理无主语 / 独家判断自持，不编归属；实证数字一律无主语；引用统一公开锚点（2026-11-14，D-047；D-004 表述随改）
- ✅ **AI 创建插件开放引擎代码（engine/ 槽位，D-048）**——版本目录新增 `engine/`（与素材槽平级；ESM 模块加载不 eval；与官方同一套 API，P8 字面同权）；同 id + `engine/` 经确认卡显式替换官方（项目 > 用户 > 官方 npm；版本升级重弹、同版本一次；失败 / 崩溃 / 关闭自动回落官方）；**16 个官方插件含内圈 5 全部可换，无特例**（"一般情况下没人去换的，但是要能替换"）；依赖放开 = `engine/` 标准 Node 包，AI 自己 `pnpm install` 走审批链、装载器零安装机器；硬规矩 = kernel / protocol 不进依赖表、宿主 import map 注入唯一实例（2026-11-15，D-048，plugins.md §1–§7.1、data-directory.md；dsh plugin-manager 四道闸实证：审批升权 tools.ts:39-43 / 构建脚本 README:64 / 兼容门 :69-71 / inspect :48 / 回滚 :104）
- ✅ **能力服务化（D-049）**——官方插件对外能力**一律服务，只有一种写法**（单消费者亦然，不做两轨道）；跨包共享必经服务，注入声明在引擎模块导出（`export const inject`）、装配层预检（服务不在场 = 该件不装载 + 告警）；清单开放不封顶、第三方（AI 插件）同权提供与消费；**围栏跟着能力走**（修订 D-039"围栏进工具"）；替换两级粒度（工具件 / 服务件，同一套 D-048 确认卡与回落）；界面挂点 = 界面侧服务（theme / shortcuts 词表 M3 对齐）；按族拆包 fs / shell / tasks——**官方件 16 → 21**；盒（插件）/ 货（工具）/ 通道（服务）/ 清单（配置）词表入 plugins.md §1（2026-11-15，D-049，plugins.md / interfaces.md 能力服务表 / packages.md / data-directory.md / roadmap / principles P8；dsh 全库 ~60 服务取证：tool-fs inject=['tools','fs',…] tool-fs/src/index.ts:23、shell 契约+四实现+四工具包、compaction 单消费者也跨包成服务、todo=sessionProjections）
- ✅ **mock LLM 测试设施形态**——独立测试支撑包（@henira/llm-mock，原定 `packages/llm-mock`，后随 test-support/ 根划位迁至 `test-support/llm-mock`——目录即宣言，产品包与测试假件分家）：llm 槽位的**脚本化 mock 实现**（一次性响应队列 + 兜底应答函数 + 请求捕获 + 造事件辅助 + `'hang'`/`Error` 条目；自校验 StreamEvent 不变量）。立独立包的两条理由：①mock 本质是 llm 槽位**第二种实现**——packages.md 卷首"出现第二种实现再拆包零迁移"；②插件互不 import 规则是 CI 强制，测试方 import mock 必须走非插件包（以 devDependency 消费）。取证四仓：dsh 槽位级 MockAdapter（mock-adapter.ts:72-85）+ 三层设施、opencode TestLLM（ai/src/testing.ts:36-51）发布为 /testing 出口、ZCode 每包自备、CC 用 VCR 录制重放（vcr.ts，CI 缺 fixture 硬拒）——两层互补，HTTP 线级 mock + 录制重放随适配器成熟后追加不互斥（2026-11-16，M2 计划定案；packages.md 树 + 依赖规则同步）
- ✅ **熔断插件批次归属**——进 M4 首发批（第 11 件，`plugin-breaker`，进 defaultPreset）：D-045 步上限默认不设、死循环兜底必须默认在场——bail 缝语义 M1 起有测试锁定而生产消费者缺位 = v0.1.0 默认装配死循环保护为空；件小（bail 缝首个生产消费者：检测 + bail 否决 + 事件行），不动二批三批。官方件 21 → 22（2026-11-17 拍板，D-058；D-041 后续修订 / roadmap M4 内容行 / packages.md / principles P8 / plugins.md 计数同批修订）
- ✅ **会话绑定界面状态持久化**——每会话一个 `ui-state.json`（会话目录，与 session.v1.jsonl 平级：草稿 / 面板宽度 / 右栏 tab 引用；web 宿主所有、整份原子重写、不进事件账本、删会话随整树走）＋ 全局"上次选中"一条 `state/ui.json`（`{ lastSessionId }`；启动还原：在列表则选中，否则回落最新更新 / 新建）——服务端存，落我们目录树（ZCode 路线 = 浏览器 localStorage 分键，换浏览器 / 换设备即丢，不采）；不进 ui-state.json 的：plan / task（引擎态，已有家 plans/index.json + tasks/<id>.json）、审批 / 提问（活等待不跨重启，与 ZCode 同裁；刷新存活靠审批行账本投影）、**折叠组**（用户裁决 2026-11-18：刷新 / 重启只展开选中会话所在组、其余组收起，平时折叠纯本地）；写时机 = 客户端防抖 + 关页 / 切会话冲刷。随批 C 两个小口子待定：①重启幽灵 pending 审批行清理语义（对账标中断）②projects.json.lastSessionId 接消费方或作废（2026-11-18 拍板，D-063，data-directory.md、interfaces.md REST 面 + facade 四方法；**已落码·界面持久化批 2026-11-18**：机制全量 + 草稿 / 选中 / 侧栏拖宽，rightPanel 留位随批 C 接线——右栏 tab 需要这个家）

- ✅ **插件装载通道 + 管理面落码（批 C，2026-11-19）**——`plugin.json` 目录发现与校验（config-loader `discovery.ts`）、engine 件装载（jiti + `@henira/kernel/protocol` alias 唯一实例 + 依赖表硬规矩 + `inject` 预检 + `engines` 兼容门）、确认卡 fail-closed（`settings.plugins.<id>.confirmedVersion`，未确认 = 不装载）、装配三步（config.plugins ?? 出厂清单 + 目录件 + enabled 过滤；**顺带修 `opts.plugins` 进 registry 即丢的 bug**——henira serve 的配置清单自此生效）、UI 装载通道（window 模块表 + import map shim + 版本化 URL + 2s 指纹轮询**免刷新重装** + 槽 ErrorBoundary 崩溃隔离 + order 排序 + 未知槽告警；源修正：件按组件渲染，直呼会让 hooks 落进外层序列）、管理面（GET/POST/PUT/DELETE 五端点 + 设置「插件」分区：状态/启停/版本/卸载/确认）、ui-assets 扫描根修正（`~/.henira/plugins`，原误扫 config/plugins）；e2e 4 用例真浏览器闭环（装载/新版本自动重装/停用/安全模式/崩溃隔离/管理面停用）。
- [ ] **排队卡剩余挂账（2026-11-20 E1 批）**——①steer 待进场条目以流内 pending 气泡呈现（本地回显 + 与落账节点合并同外观，dsh/ZCode 双通道；现面板徽章区分）~~②面板拖拽排序~~（**先不做，2026-11-20 用户拍板**：「立即发送」升格已覆盖最常用排序需求）③多条折叠头（>N 条折叠为计数条）~~④中断×队列语义~~（✓ **2026-11-20 落码**：队列非空中断 = 冻结不冲刷，`paused()`/`resume()` + `SessionState.queuePaused` + 暂停横幅「继续发送」钮 + REST `POST queue/resume`；loop.md §2 纪律⑥）；闲时队列自动消费（升格/入队竞态窗口条目滞留到下一回合末）⑤编辑跨窗口冻结锁⑥queue 面板 keyed 化（composer 内部件 → 独立缝可顶替）。
- [ ] **批 C 挂账（2026-11-19）**——①项目级 `.henira/plugins/` 扫描（装配②）②D-048 用户包同 id 替换官方（确认卡已有，替换/回落随后）③运行时文件级 HMR（版本目录不可变；新版本目录走轮询重装已落）⑤中文 id 引擎件（先 ASCII）⑥插件数据区展示与 hooks 详情（mcp 详情✓ 已随 C5 落码）；~~④ C5 plugin-mcp 与 D-030 凭据注入~~（✓ 2026-11-19 C5 批落码，D-064）；~~⑦ useResource 实装~~（✓ 同批）
