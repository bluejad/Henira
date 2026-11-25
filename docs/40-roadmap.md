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

**内容**：`llm`（契约 + AI SDK 适配器 + mock LLM 测试设施）· `tools`（五段管线）· `approval`（fail-closed 状态机）· `loop`（状态机 + 中断纪律 + 16ms 合并）· `config-loader`（最小版：ConfigService + settings / permissions / credentials 装载 + models.dev 字典同步，D-040；henira.config.ts 装载与 applyConfig 随 M3）· `examples/`（mock 离线 + 真实模型）· 引擎五件以官方插件包落地（plugins/*，ServiceDefinition + 实现同包；mock LLM 测试设施 = 独立支撑包 test-support/llm-mock，50-open 归档 2026-11-16）

**完成判据**：

- [x] mock LLM（脚本化 StreamEvent 序列）可确定性驱动 loop——examples/mock 离线跑通完整回合（`examples/mock/src/e2e.test.ts`：工具回合 + 可回放 + 拒绝路径，兼 vitest 套件）
- [x] 中断纪律五条逐条有测试（`plugins/loop/src/loop-interrupt.test.ts` 纪律①–⑤五个具名测试，一行一测试）
- [x] 忙时投递：排队持久化（queue.json）+ 条目"立即发送"在 step 边界进场不打断工具，有测试（`plugins/loop/src/loop-turn.test.ts` 忙时投递 / 插话 / 重启恢复三测试，D-045）
- [x] 审批 fail-closed：answerer 缺失/抛错/不合规 → unavailable 必拒（`plugins/approval/src/service.test.ts` fail-closed 矩阵）
- [x] 判定链全序有测试：凭据/灾难硬拒 → deny → allow 规则 → 默认放行（只读标记）→ `approval/request` 缝 → answerer fail-closed（`plugins/approval/src/chain.test.ts` + `service.test.ts` 全序各段，D-039）
- [x] StreamEvent 三条不变量有测试锁定（`plugins/llm/src/stream-parts.test.ts` 映射侧 + `test-support/llm-mock/src/mock.test.ts` 构造期自校验）
- [x] 真实模型 smoke：examples/real 真跑通带工具调用的回合（2026-11-16 三家真 provider 点火全过——DeepSeek / 智谱 coding plan / Agnes，通用 openai-compatible 适配器零改动；修复提交 c9c8212 / e8b1b68；env 门控不进 CI）

**M2 收尾决策闸门（D-023）——已评估（2026-11-16），维持自研**：引擎闭环全程内核零 bug（M2 的全部摩擦都在脚手架层：TS 5.9 升级 / biome 规则 / JSON 导入 / dist 陈旧，与 kernel 无关）；未出现"会话内热加插件 / 配置热重载"的真需求。不 vendor cordis core。

## M3 宿主与界面

**内容**：`server`（Hono + SSE EventBus：每订阅者 bounded queue、心跳；回环三件套——默认只绑 127.0.0.1 / 随机端口 / Host 校验＋可选 token 位，D-035）· **投影器（账本→行快照/增量；行模型核心与 ZCode 同构，ServerEvent 词表已定稿于 [interfaces.md](./20-architecture/interfaces.md) server 段）** · `sdk`（进程内 + 远程双形态；纯 TS 零 React，D-037）· `web`（会话列表 / 事件流渲染 / 审批卡 / 输入框 / 设置页；**可嵌入**——界面组件以注入 client 的形式暴露，建 web 之前生效，D-037；`createWebApp` 挑件 layout 参数概要，D-043）· **官方界面插件包 `plugin-web-ui`**（D-043：web 界面即此包——真插件，布局与各件各占槽）· `cli` 骨架（`serve` 命令，D-018；`run` 入口不单列排期，D-037）· **组织约束（首发生效，D-043 第 8 条）：web 界面代码自第一行起按"可拆组件 + 槽位组合"组织，默认组合只是一种排列** · 界面挂点语义 = 界面侧服务（D-049）；theme / shortcuts 等界面词表随本批对齐公开实现清单逐个定 · **文案语言（D-050）：界面文案从第一行起走 locale 词表、不写死组件，首发仅 `zh` 一份字典；引擎消息按 D-050 第 2 款定英文、永不本地化**

**完成判据**：

- [x] 同一会话：两个网页同时连接，事件都到达（`packages/server/src/server.test.ts` 判据①具名测试：双 SSE 订阅同会话增量都达）
- [x] 断开网络后重连：审批卡重放（`server.test.ts` 判据②具名测试：审批挂起 → 新客户端首帧快照携带挂起审批行 → REST 收答回合继续）
- [x] 设置页可用（默认模型 / 主题 / 密钥录入）；mock 模式离线可跑（`server.test.ts` 设置端点 + `packages/web/src/host.test.tsx` 面板渲染；`henira serve --mock` 离线全链活体验收：静态页出货 + [mock] 回合 + 快照两行。插件管理面随 M4 插件一起验收）
- [x] 界面以官方界面插件包形态装载——真插件走公共注册路径；槽位级自动回退与安全模式（双击 Alt / `?ui=safe`）可演示（`packages/web/src/host.test.tsx`：模块激活正向 + safeMode 同零件库编译期出口渲染 + layout 挑件槽位收起）
- [x] server 回环三件套生效并有测试：默认只绑 127.0.0.1、随机端口、Host/Origin 校验（`server.test.ts` 判据⑤具名测试 + 可选 token 位；D-035）
- [x] 界面无写死的用户可见文案：全部经 locale 词表取字（D-050，机器可查——`pnpm check:ui-locale` 机械闸：代码剥离注释后零 CJK，字典文件唯一允许地；已进 CI）

## M4 插件与发布（首发批）

**前置**：网页界面 v1 边界定稿（界面 UI 形态与三个挂载点已定，D-021；UI 位置静态申报已定，D-031；宿主槽位词表已定，D-033；交互方向已定双向事件流，D-042；设置页范围按 M3 判据执行；命令进输入框随读者 4 批挪 M6 前置，D-041）· **发布账号前置（占坑账，D-053）**：npm 账号开启 2FA（npm 2027-01 起发布强制 ＋ `@henira` scope 资产保护）——唯一剩余待办；已落袋（2026-11-16）：npm org `henira`（`@henira` scope 已锁）＋ Docker Hub `henira` 命名空间

**内容**：首发批官方插件 12 个（引擎 5：session / llm / tools / approval / loop ＋ fs 族 3（fs / fs-tools / fs-search）＋ shell 族 2（shell / shell-tools）＋ 熔断 1（死循环兜底，挂 `loop/turn-stopping` bail 缝；D-013⑤ / D-058）＋ 提问 1（ask_user，R184 / D-074），D-041 / D-049 / D-058 / D-074）· fs / shell 服务契约在 [interfaces.md](./20-architecture/interfaces.md) 定稿（活文件，D-049；**✓ 已落码 2026-11-20 批 B，D-065——12 件全量在 defaultPreset，含第二实现思想实验**）· 界面 UI 模块契约与 14 方法宿主门面（[plugins.md](./20-architecture/plugins.md) §4，D-021 / D-028 / D-042 / R190）· 插件管理面（列表 / 详情 / 版本 / 卸载 / 数据区，D-029）· 插件安全基线（D-030）· 浏览器 e2e 测试设施（Playwright 无头 chromium：`henira serve --mock` 起服务 → 连入 → 发回合 → 断言行流式渲染 → 审批卡收答；长效规矩「凡交付界面的里程碑必须有真浏览器 e2e + 截图留档，jsdom 组件级测试不替代」随 M4 计划立 ADR）· **界面优化一轮（发布前，2026-11-17 拍板全记 M4）**：视觉语言打磨（token 层级 / 间距 / 空态 / 深色对齐）+ markdown 渲染；插件管理面长在成型视觉系统上；UI 活照规矩过 frontend-design / no-ai-design-slop 双 skill 闸 · 侧栏目录区（登记工作目录分组 / 新增目录弹窗 / 右键删除——R127 用户拍板，D-060）· **插件体系闭环（D-062，2026-11-18 拍板）**：第三方 UI 模块装载通道（server 伺服 ui entry ＋ 宿主动态 import ＋ import map 注入 react / `@henira/kernel` / `@henira/protocol` / 官方件唯一实例）＋ 挂载点词表 v2 落码（**UI 侧子项已先行落码·三栏骨架批 2026-11-18**：`layout` 整页框架槽官方框架件占槽＋同一注册声明子槽、右栏 tab 框架官方默认件、REGION_SLOTS 扩容；`sidebar.right.preview.<扩展名>` 渲染挂点已接（✓ R190 / D-076：官方兜底体占通配 `*`、插件按后缀顶替/卸载回落、工作区路径读取））＋ 引擎件确认卡与"被替换"显示（D-048）＋ useResource / listPlugins 实装（**已落码·批 C 收尾 2026-11-19，D-064：plugin-mcp 读者 + 确认指纹 + 凭据注入 + useResource 数据泵 + 管理面 mcp 详情**）＋ 会话绑定界面状态持久化（D-063，**已落码·界面持久化批 2026-11-18**：机制 + 草稿 / 选中 / 侧栏拖宽 / rightPanel+rightWidth（三栏骨架批接线）；折叠组为本地态不入档——用户裁决 2026-11-18） · 《插件规范》定稿 · changesets 版本流程 · npm 首发准备 · v0.1.0 tag

**完成判据**：

- [ ] 已发布官方插件仅经公共注册路径装载（无特权 API，P8 可验证；每批复查）
- [x] 示例会话（mock）跑完 fs+shell 工具流（**✓ 批 B 2026-11-20**：examples/mock e2e「判据②」write → read → edit → bash 全链，`pnpm --filter @henira/example-mock test`）
- [x] 能力服务装载强制有测试：工具件声明注入的服务不在场 → 不装载 + 告警；关掉 fs 服务件 → fs 工具全体缺席、系统照跑（D-049）（**✓ 批 B 2026-11-20**：server.test「能力服务装载强制」+ facade.test 双形态同语义；宿主装配层预检对官方 preset 条目同规——kernel start() 静态检查为最后防线）
- [ ] 插件管理面：坏插件告警可见；版本切换、卸载（默认保留数据）、数据区删除正确；无导入 / 市场入口（D-019 / D-029）
- [x] UI 门面：示例插件 UI 用 `sendPrompt` / `onTurnFinished` / `useResource` 跑通；事件订阅双向流有测试（D-042：类型过滤 / 有界队列背压 / 终局必达）（**✓ R202 / D-085 2026-11-24**：`subscribe` 帧级词表（Row.kind / turnId）+ 每订阅者队列 + 终局必达、`onTurnFinished` 当前会话 own-send 映射；`test-support/browser-e2e/src/facade.e2e.ts` 第三方探针插件真浏览器跑 `sendPrompt` / `onTurnFinished` / types 过滤（**R203 / D-086**：连发两句——第二句入队，账本 `queueId` 回声对回后双回执）；`useResource` 由 C5 MCP 管理面消费）
- [x] 执行中向用户提问（R184 / D-074）：`ask_user` 专用工具（与审批分离，答案即工具结果）＋ 提问卡（单选 / 多选 / 自定义 / 多题分页 / Esc 取消 / IME 守卫）＋ 痕迹行问答对 ＋ 重启修复收口；server REST + SDK 双形态 + 浏览器 e2e（答题 + 取消）+ 真 key 活体（明暗双主题）
- [x] 浏览器 e2e 通过（Playwright 无头 chromium，进 CI）：serve 起服务 → 无头浏览器连入 → 发回合 → 断言行流式渲染 → 审批卡收答；截图留档（流式中 / 完成 / 审批卡 / 明暗双主题）——jsdom 组件级测试不替代本条（`test-support/browser-e2e` serve.e2e.ts 两用例；落地时真浏览器抓修三 bug——?ui=safe 入口漏接线 / 开场选会话未同步 Shell / 暗色变量组 :root 容器错位，见 4f3a86b；CI 绿 run 44019290772 + 截图 artifact 留档）
- [ ] 界面优化一轮落地：视觉打磨 + markdown 渲染，优化前后截图对照、人眼拍板（界面 = v0.1.0 门面）
- [x] 界面收口批（R188 / D-075）：左栏标题/相对时间 + 空会话草稿态 + 中列 header + 设置四页行卡重排 + 预览打开方式（弹窗/右侧按文件/图片各自可设，`ui.preview`）+ 右栏预览 tab + diff 高亮 + 工具开合 300ms + CSS/组件二次拆分（明细与测试见 D-075；「界面优化一轮」整体判据的优化前后截图人眼拍板仍随真 key 验收）
- [x] 预览缝批（R190 / D-076）：`sidebar.right.preview.<后缀>` 渲染挂点接线——官方兜底体显式占通配 `*`、插件按后缀（复合后缀最长匹配）注册/顶替、卸载与崩溃回落；预览键全族 single 占用；工作区文件读取 `GET /api/sessions/:id/file` + SDK `readWorkspaceFile`（cwd 围栏 + realpath；文本 1 MiB 截断 / 二进制 base64）；行出窗按当前磁盘文本回落；e2e 插件接管→停用回落 + 真 key 活体
- [x] 输入框权限模式（R197 / D-080）：`PermissionMode = ask | full` 按次绑定（与模型/思考档同构；`turn/start` 落账审计 + 队列条目持久化）；会话级 ui-state 记忆 + settings 新会话默认（设置第五页「权限」）；审批链水瀑后自动放行（`decided{mode:"full"}` 审计标记；硬拒/deny/hook deny 不动）；工具排左端权限 chip（full 警示色 + 升格风险确认卡）+ e2e 七步全链
- [x] 命令级权限规则（R198 / D-081）：三层存储（会话事件 `decided{scope,rule}` / 项目 `projects/<key>/permissions.json` / 全局 `config/permissions.json`）+ `commandExact` 精确命令 + 卡四钮/三钮 + deny 跨表压倒一切 + 项目写盘失败降级一次 + 权限菜单计数/清空 + e2e 真浏览器
- [x] 权限管理面（R199 / D-082）：设置 › 权限只含持久策略（项目选择器 + 项目/全局规则逐条查看/删除，确认框、deny/全局警示、坏文件 409 不覆盖）；本会话允许只在 chip 规则面板逐条撤销；deny 仍一次性；`SettingsModal` section 深链修复；SDK/双形态 + e2e 三用例（会话逐条撤销/项目删/全局删）
- [x] 对话滚动视口/输入卡右缘对齐（R200 / D-083）：滚动视口铺满中列（滚动条贴最右，`stable both-edges`）+ 正文列改内层限宽列 + composer 外层按实测槽宽同宽内缩 → 用户气泡右缘 = 输入卡右缘、正文左缘 = 卡片左缘；e2e 1024/1280/1920/右栏开合四组量数（红测缺槽内缩差 15px）；纵向全高轨道留结构批
- [x] 三栏卡片化（R201 / D-084）：左/中/右三栏 = 1px 描边 + 12px 圆角卡片（拖宽把手 4px 即栏缝、缝只在栏间、四周贴窗口；最大化右栏同为圆角全屏卡）；卡片底色/阴影零改动，R200 对齐不变量在卡内成立；e2e 缝宽/四周贴窗/圆角/描边/最大化断言 + 活体截图（1280 明暗 / 1920 亮色 / 最大化 / 权限菜单与模型弹层不被裁切）
- [x] 卡死治理批（R193 / D-077）：删前端 3s「响应停滞」判据（忙碌行恒走秒；≥60s 中性「仍在等待模型响应」）；plugin-llm per-part 空闲看门狗（默认 180s，settings 覆盖）→ `LlmError(LLM_STREAM_IDLE_TIMEOUT)` → ErrorRow + 可行动中文；SSE 客户端字节看门狗（30s 含心跳）→ 自动重连 + `onLinkState` 5s 抗闪横幅 + 重连边沿补拉当前会话（服务重启后不卡 busy）；`stop()` 收口事件泵；帧消费监督重启；e2e 静默 provider + 活体杀 serve 重连
- [ ] 三家真 provider 经 serve 链路（REST + SSE）各跑通带工具回合（真 key，env 门控不进 CI；M2 真跑是 examples/real 直连引擎，本条补宿主链路），并**逐形态验收截图点开看**。**真 key 采样先行（2026-11-17 改拍板）**：markdown 渲染的开发素材直接用三家真 key 跑真实样本（标题 / 代码块 / 表格 / 列表的真实分布），照样本做渲染、做完立刻真 key 复看显示效果（markdown / 代码块 / 截断 / 用量）——不拿 mock 编样本；**mock 只留稀有形态清单**（推理块 / 错误回合 / 拒绝 / 中断 / 多工具 / 插话——真 key 难以稳定触发，mock 确定性重放，兼 CI 离线回归）
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
- [ ] 23 个官方插件全部发布，全部仅经公共注册路径装载（P8 终验）

---

_发布后的演进（ backlog，不排期）：黑窗口聊天（cli 包：单发 prompt / Repl）、桌面 Electron 宿主（A1 薄壳，D-035）、`examples/cloud` 云端部署样例（D-036）、TUI 与移动端（形态待定，[hosts.md](./20-architecture/hosts.md) §6）、评测闭环（回放即评测输入）、沙箱插件、ACP 等协议接入、进程边界 SDK（JSON-RPC 子进程形态）。_
