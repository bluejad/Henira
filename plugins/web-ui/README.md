# @henira/plugin-web-ui

官方默认界面套件（D-043）：布局 + 会话列表 / 对话面板 / 输入框 / 审批卡各件各占槽；**真插件**——id-only 条目进 defaultPreset，web 宿主经公共注册路径装载其 UI 模块（`webUiModule`），件经 `UiModuleContext.registerSlot / replaceSlot` 挂载，可整只替换；**编译期出口**（本 index 直出的件）供 web 宿主安全模式与默认组合直接用——官方件与插件用件同一零件库（D-043 第 7 条）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) web 段 / 插件 UI 门面段（承重缝 `WebPartContext` = 件 + 会话上下文 + 行 store 一起给）
- 安全模式（双击 Alt / `?ui=safe`）：宿主不激活本模块、直接渲染编译期出口的默认组合（同一零件库两条通道，D-043）
- 组织约束（D-043 第 8 条，首发生效）：界面代码自第一行起按"可拆组件 + 槽位组合"组织，默认组合只是一种排列

## 文案语言（D-050）

`locales/zh.ts` 是**全部界面代码唯一允许出现用户可见中文的源码文件**；组件一律 `t(key)` 取字、缺 key fail-loud。判据⑥机械闸（`scripts/check-ui-locale.mjs`）扫 web / web-ui 源码 CJK 字符只许在字典文件。追加语言 = 新增一份字典文件，不动机器。

## 视觉 token

`tokens.css`：CSS 变量组（暖单色基底 + 语义粉彩；明暗双主题 = 换 `data-theme` 变量组）；零 webfont（系统字体栈——离线工具第一约束）；流式文本透明度浮现（`.henira-streaming`——DOM 首帧完整、只动画透明度，虚拟滚动测高稳定）。图标 = Phosphor（经 `parts/icons.tsx` 收口，库可换）。

## 文件 ↔ 设计

| 文件                    | 职责                                                                                                                        | 设计出处                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| types.ts                | 承重缝类型：WebPartContext（client + sessionId + selectSession + t + theme + store + host）/ PluginUiHost / UiModuleContext | interfaces.md web 段 / D-028 |
| module.ts               | UI 模块入口：官方件注册进宿主槽位（公共注册路径）；defaultParts 映射                                                        | D-043 / 判据④                |
| parts/session-list.tsx  | 会话列表件（槽 sidebar）：busy 点 / 新会话 / 切会话                                                                         | 判据①③                       |
| parts/conversation.tsx  | 对话面板件（槽 conversation）：哑渲染器——行→呈现（user / assistant 流式 / tool / approval / error 五行）                    | ServerEvent 词表             |
| parts/composer.tsx      | 输入框件（槽 composer）：Enter 发送（D-045 单口）/ busy 停止 + 插话提示                                                     | D-045                        |
| parts/approval-card.tsx | 审批卡件（内联）：允许 / 拒绝走 settleApproval（幂等先答者赢，多客户端经行流同步 settled）                                  | 判据② / packages.md 槽位归属 |
| parts/icons.tsx         | 图标收口（Phosphor 子路径导入；换集只动此文件）                                                                             | 视觉语言节                   |
| locales/zh.ts           | zh 字典（唯一 CJK 允许地；fail-loud）                                                                                       | D-050 / 判据⑥                |
| tokens.css              | CSS 变量 token（明暗双主题 / 零 webfont / 流式浮现动画）                                                                    | 视觉语言节                   |

## 测试 ↔ 判据

| 测试           | 锁什么                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| parts.test.tsx | locale 取字 / 会话列表交互（createSession / selectSession 承重缝）/ Composer Enter 发送 + busy 形态 / 审批卡收答调用 |
