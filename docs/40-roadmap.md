# 实施里程碑

> 顺序执行；每个里程碑有明确**完成判据**，判据不满足不算完成。
> 原则上 M1 → M2 之间不回头改接口；实现中发现接口形状问题，先改 [interfaces.md](./20-architecture/interfaces.md) 再动码。

---

## M0 脚手架

**内容**：git init · pnpm workspace · tsconfig/biome/vitest/changesets · GitHub Actions CI · LICENSE (MIT) · 双语 README（当前为占位）· AGENTS.md 骨架

**完成判据**：

- [ ] `pnpm install` 一次通过；`pnpm typecheck && pnpm test && pnpm build` 空跑绿
- [ ] CI 在 push 时跑 typecheck + test
- [ ] 依赖方向检查配置就位（packages.md 规则）
- [ ] 公开来源可追溯性检查（D-047）：全部 file:line 引用可公开对证；来源标识不超出封闭词表（见 [principles.md](./20-architecture/principles.md) 顶部「来源标注」）、无本地机器路径，grep 全库无命中（D-004）

## M1 内核与数据

**内容**：`kernel`（微内核）· `protocol`（事件注册表）· `session`（JSONL 持久化 + deriveMessages + fork/replay）· 每包单测

**完成判据**：

- [x] kernel：四种事件模式 + inject 依赖图 + 可逆 effect，单测覆盖（含 waterfall 短路语义）
- [x] kernel 语义钉子（D-023，照 cordis 上游补丁暴露的边界）：重入卸载 / setup 内注册 / pending 时新增 inject / waterfall 否决 / unloading 拒绝注册，五条各有测试
- [x] protocol：注册表派生清单有测试；新增插件事件类型不需改核心代码
- [x] session：P1 不变量"模型可见 ⟺ 已落日志"有测试锁定；原子 flush（tmp+rename）测试；孤儿 tool_call 合成错误结果的派生测试；fork/replay 测试

## M2 引擎闭环

**内容**：`llm`（契约 + AI SDK 适配器 + mock LLM 测试设施）· `tools`（五段管线）· `approval`（fail-closed 状态机）· `loop`（状态机 + 中断纪律 + 16ms 合并）· `config-loader`（最小版：ConfigService + settings / permissions / credentials 装载 + models.dev 字典同步，D-040；reins.config.ts 装载与 applyConfig 随 M3）· `examples/`（mock 离线 + 真实模型）· 引擎五件以官方插件包落地（plugins/*，ServiceDefinition + 实现同包；mock LLM 测试设施 = 独立支撑包 packages/llm-mock，50-open 归档 2026-11-16）

**完成判据**：

- [ ] mock LLM（脚本化 StreamEvent 序列）可确定性驱动 loop——examples/mock 离线跑通完整回合
- [ ] 中断纪律五条逐条有测试（loop.md §2 表格一行一测试）
- [ ] 忙时投递：排队持久化（queue.json）+ 条目"立即发送"在 step 边界进场不打断工具，有测试（D-045）
- [ ] 审批 fail-closed：answerer 缺失/抛错/不合规 → unavailable 必拒，有测试
- [ ] 判定链全序有测试：凭据/灾难硬拒 → deny → allow 规则 → 默认放行（只读标记）→ `approval/request` 缝 → answerer fail-closed（D-039）
- [ ] StreamEvent 三条不变量有测试锁定
- [ ] 真实模型 smoke：examples/real 用真实 key 跑通一个带工具调用的回合

**M2 收尾决策闸门（D-023）**：内核 bug 是否拖慢引擎闭环、是否出现"会话内热加插件 / 配置热重载"的真需求——任一条成立则评估 vendor cordis core，否则维持自研。

## M3 宿主与界面

**内容**：`server`（Hono + SSE EventBus：每订阅者 bounded queue、心跳；回环三件套——默认只绑 127.0.0.1 / 随机端口 / Host 校验＋可选 token 位，D-035）· `sdk`（进程内 + 远程双形态；纯 TS 零 React，D-037）· `web`（会话列表 / 事件流渲染 / 审批卡 / 输入框 / 设置页；**可嵌入**——界面组件以注入 client 的形式暴露，建 web 之前生效，D-037；`createWebApp` 挑件 layout 参数概要，D-043）· **官方界面插件包 `plugin-web-ui`**（D-043：web 界面即此包——真插件，布局与各件各占槽）· `cli` 骨架（`serve` 命令，D-018；`run` 入口不单列排期，D-037）· **组织约束（首发生效，D-043 第 8 条）：web 界面代码自第一行起按"可拆组件 + 槽位组合"组织，默认组合只是一种排列** · 界面挂点语义 = 界面侧服务（D-049）；theme / shortcuts 等界面词表随本批对齐公开实现清单逐个定 · **文案语言（D-050）：界面文案从第一行起走 locale 词表、不写死组件，首发仅 `zh` 一份字典；引擎消息按 D-050 第 2 款定英文、永不本地化**

**完成判据**：

- [ ] 同一会话：两个网页同时连接，事件都到达（多客户端演示）
- [ ] 断开网络后重连：审批卡重放（P5 挂起会话状态）
- [ ] 设置页可用（默认模型 / 主题 / 密钥录入）；mock 模式离线可跑（插件管理面随 M4 插件一起验收）
- [ ] 界面以官方界面插件包形态装载——真插件走公共注册路径；槽位级自动回退与安全模式（双击 Alt / `?ui=safe`）可演示（D-043）
- [ ] server 回环三件套生效并有测试：默认只绑 127.0.0.1、随机端口、Host/Origin 校验（D-035）
- [ ] 界面无写死的用户可见文案：全部经 locale 词表取字（D-050，机器可查——组件代码里 grep 不到裸文案）

## M4 插件与发布（首发批）

**前置**：网页界面 v1 边界定稿（界面 UI 形态与三个挂载点已定，D-021；UI 位置静态申报已定，D-031；宿主槽位词表已定，D-033；交互方向已定双向事件流，D-042；设置页范围按 M3 判据执行；命令进输入框随读者 4 批挪 M6 前置，D-041）

**内容**：首发批官方插件 10 个（引擎 5：session / llm / tools / approval / loop ＋ fs 族 3（fs / fs-tools / fs-search）＋ shell 族 2（shell / shell-tools），D-041 / D-049）· fs / shell 服务契约在 [interfaces.md](./20-architecture/interfaces.md) 定稿（活文件，D-049）· 界面 UI 模块契约与 13 方法宿主门面（[plugins.md](./20-architecture/plugins.md) §4，D-021 / D-028 / D-042）· 插件管理面（列表 / 详情 / 版本 / 卸载 / 数据区，D-029）· 插件安全基线（D-030）· 《插件规范》定稿 · changesets 版本流程 · npm 首发准备 · v0.1.0 tag

**完成判据**：

- [ ] 已发布官方插件仅经公共注册路径装载（无特权 API，P8 可验证；每批复查）
- [ ] 示例会话（mock）跑完 fs+shell 工具流
- [ ] 能力服务装载强制有测试：工具件声明注入的服务不在场 → 不装载 + 告警；关掉 fs 服务件 → fs 工具全体缺席、系统照跑（D-049）
- [ ] 插件管理面：坏插件告警可见；版本切换、卸载（默认保留数据）、数据区删除正确；无导入 / 市场入口（D-019 / D-029）
- [ ] UI 门面：示例插件 UI 用 `sendPrompt` / `onTurnFinished` / `useResource` 跑通；事件订阅双向流有测试（D-042：类型过滤 / 有界队列背压 / 终局必达）
- [ ] `changeset version && publish` 干跑通过；README 英文版就位
- [ ] 官方插件文档齐全：一包一 README、一工具一 md（文档粒度规矩见仓库根 [AGENTS.md](../AGENTS.md)）

## M5 官方插件二批

**前置**：plugin-compaction / plugin-subagent 设计文档定稿（[50-open.md](./50-open.md) 🟡，成熟参数已取证；plugin-tasks 设计文档同批定稿）

**内容**：plugin-fetch / plugin-compaction / plugin-subagent / 任务族三件（tasks / plan / todo）（D-041；服务化拆包 D-049——tasks / subagent / fetch 服务契约随本批设计文档定稿）

**完成判据**：

- [ ] 压缩插件在超预算会话上触发且失败可见（P2）；替换区间不碰头部系统块（[session.md](./20-architecture/session.md) §4）有测试
- [ ] subagent：并发上限 / 嵌套深度 / 取消传导 / 后台完成注入守卫有测试（审批规则见 [tools-approval.md](./20-architecture/tools-approval.md) §3.2）
- [ ] tasks："一条主线"规则有测试；状态对不上时按日志重建走得通
- [ ] fetch 免问（D-039 默认放行层）在判定链测试覆盖
- [ ] 本批插件仅经公共注册路径装载（P8 复查）

## M6 官方插件三批（读者 4）

**前置**：命令怎么进输入框定稿（[50-open.md](./50-open.md) 🟡）

**内容**：plugin-skills / plugin-mcp / plugin-hooks / plugin-commands（D-041；skills 服务契约随批定稿，D-049）· AI 创建插件 / 技能工作流（创建技能随 plugin-skills 发布，D-026）

**完成判据**：

- [ ] 读者冒烟：mock 插件包带 skills / mcp / hooks / commands 四类槽位——新会话里技能目录注入且可激活、MCP 工具进注册表、钩子拦截与放行正确、命令进输入框且 `$ARGUMENTS` 替换正确；外部 `.agents/skills` 根只读生效（D-020）
- [ ] AI 创建插件：按《插件规范》创建一个内容包（槽位 / 界面 / 引擎模块），新会话生效；带 `engine/` 的包走确认卡流程、同 id 替换后失败可回落官方（D-048）；坏清单插件被跳过且告警可见
- [ ] 21 个官方插件全部发布，全部仅经公共注册路径装载（P8 终验）

---

_发布后的演进（ backlog，不排期）：黑窗口聊天（cli 包：单发 prompt / Repl）、桌面 Electron 宿主（A1 薄壳，D-035）、`examples/cloud` 云端部署样例（D-036）、TUI 与移动端（形态待定，[hosts.md](./20-architecture/hosts.md) §6）、评测闭环（回放即评测输入）、沙箱插件、ACP 等协议接入、进程边界 SDK（JSON-RPC 子进程形态）。_
