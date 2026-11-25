# 工具执行管线与审批设计

> 依据原则 **P4（工具管线）**、**P5（审批 fail-closed）**、**P9（红线）**。
> 定位：`plugin-tools` 与 `plugin-approval` 是**官方插件**（官方预设默认装载；可被整包替换，语义责任随替换转移，见 D-010）。
> 状态：**已定稿**（2026-11-14 收口：工具 schema 单一格式 D-044、PermissionRequest 载荷 D-046）。

---

## 1. 工具定义（已定的形状）

```ts
interface ToolDefinition {
  name: string; // 全局唯一，插件注册时查重
  description: string; // 给模型看
  inputSchema: JsonSchema; // 裸 JSON Schema（D-044：协议唯一形状；装载期校验，非法 → 插件跳过 + 告警，接 D-029）
  isConcurrencySafe?: boolean; // 只读工具可并行（默认 false）
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
```

- **参数声明单一格式（D-044，2026-11-14）**：只收裸 JSON Schema——模型出口、MCP tools/list、AI 创建内容包同形零转换；官方插件**直写**（dsh `tool-bash:370` 同款），**不建** zod→JSON Schema 转换糖；`execute` 入参不靠 schema 推导 TS 类型（松散 args + 引擎校验 + 工具测试钉，"参数不合规拒执行"运行期兜底）。

- `ToolContext` 注入一切依赖（cwd、signal、requestPermission、logger…），**工具自身零全局状态**；
- `ToolResult` 带 `__` 前缀**带外通道**：`__meta`（检查点、引用、图片等元数据）由 loop 路由，不进模型上下文（P4）。

### 1.1 工具结果的尺寸：统一出口截断 + 落盘留路径（定稿 · 2026-11-13）

- **统一出口限量**：工具结果在进流水账 / 模型上下文前由执行出口统一限量——默认 **2000 行 / 50KB**（量级照 OpenCode `tool-output.ts:13-14`），经 `ConfigService` 可配；**工具可自定更严上限**（如 bash 只留尾部 20KB，Claude Code 同款）；带外 `__meta` 同闸管辖——序列化超 **256KB**（或不可序列化）整体丢弃（UI 卡降级通用渲染；官方工具 meta 自带服务层上限，此闸防第三方无界对象绕过出口限量进流水账 / SSE）；
- **超限落盘留路径**：完整输出写进会话目录（具体位置随实现定，不进模型上下文），模型看到"截断尾注 + 完整输出路径 + 头部预览"——ZCode（`result-serialization.ts:34-235`）、OpenCode（`tool-output.ts:75-141`）、Claude Code（通用落盘层）三家同构；截断尾注必须可见（P2）；
- 截断在 UTF-8 边界收口，防代理对切半（多字节字符切在码点中间会让下游解析炸掉）。

## 2. 执行管线五段（已定的顺序）

```
 parseArgs（按 inputSchema 校验，失败→结构化错误回模型重发）
   ↓
 pre-execute   waterfall 钩子：每个 listener 返回 allow | deny(reason) | ask(reason)   ← `tools/pre-execute`
   ↓              （后注册的硬闸不得放宽先注册的拒绝——单调性 [dsh]）
 execute       超时 + AbortController 竞速：
   ↓              未启动即中止 → ABORTED_BEFORE_DISPATCH；
                  已启动则等工具自行结束并保留其自报错误 [dsh]
 post-execute  waterfall：可附加上下文、可检视/替换结果                                ← `tools/post-execute`
   ↓
 权威结果       落 tool/result 事件（P1），带外字段由 loop 分流
```

- 并行执行：连续多个 `isConcurrencySafe` 工具调用可 `Promise.all`，结果按原顺序回写；
- 可见性双层：模型请求前的工具清单投影（声明式过滤）+ 执行时 `isAllowed` 兜底校验。

### 2.1 pre-execute 裁决与判定链的组合（定稿 · 2026-11-16）

- 跨监听者单调合并：**deny > ask > allow**（后注册不得放宽先注册的拒绝——单调性 [dsh]）；
- **deny = 链前拒**：不进判定链、无审批审计对；`tool/call` 与 `tool/result{isError}` 照记（P8 替换者清单"每个 tool/call 必有 tool/result"）；
- **ask = 抬高下限**：判定链照常执行，但默认放行层（只读标记）不得自动通过——直达 `approval/request` 缝与 answerer（沙箱闸要求过目时，只读工具也不能静默放行）；
- **allow / 无监听者表态**：判定链全程权威（§3 全序）——pre-execute 任何裁决都放不了凭据与灾难操作（§3 钩子规则同源）；
- requestPermission 对每次未被链前拒的调用**必然执行**：管线先查闸、判定链管终审（Claude Code 行为层同构：管线内钩子先于权限检查、deny 短路）。

## 3. 审批状态机（语义已定；由官方 approval 插件实现）

**归属（D-012④ / D-013①）**：fail-closed 语义、判定链、审计事件对、**凭据硬拒清单**全部由官方 approval 插件承担并默认装载——kernel 是纯机制，不承载业务策略；替换此插件者接管语义责任。**弹卡、收答、断线重放不在此列**：那是宿主能力，经 protocol 的 `InteractionService` 槽位（由引擎所在进程实现，归属见 [packages.md](./packages.md)「槽位实现归属」；测试用 mock）。

```ts
type Decision = "allowed-once" | "rejected" | "cancelled" | "unavailable";

// D-087：判定结果带拒绝说明与来源标签（旧调用方只读 decision）
function requestPermission(req: PermissionRequest): Promise<{
  decision: Decision;
  feedback?: string; // 用户在卡上填写的拒绝说明（≤4096 码点）
  deniedBy?: "user" | "policy"; // user = 用户拒绝；policy = 链外硬拒 / deny 规则 / hook deny
}>;
```

**判定链顺序（严格固定；D-039 补默认放行层与灾难硬拒）**：

```
凭据硬拒 ──→ 灾难操作硬拒 ──→ 全局 deny ──→ 会话 deny ──→ 全局 allow ──→ 会话 allow ──→ 默认放行（只读标记）
（链外：任何规则都放不了行）                                                ──→ 仍未命中：approval/request 缝 ──→ 完全访问层（D-080）──→ answerer
```

- **fail-closed**：answerer（= `InteractionService`）缺失 / 抛错 / 返回不合规值 → 一律 `unavailable` → 必须拒 `[dsh]`；
- **默认放行层（D-039，2026-11-13）**：无任何规则命中时，`isConcurrencySafe: true`（只读标记）**自动放行**并照常落 `approval/decided` 审计；其余照旧走缝与 answerer。`deny` 规则压倒一切（链首），显式 allow 规则也在默认层之前。web_fetch 类只读工具因此免问（Claude Code 默认放行抓取）。headless（`henira run`）开箱即可跑只读任务，写类靠 `permissions.json` 规则（§3.1）；
- **规则层（R198）**：全局表与项目表合并后**先扫全表 deny 再扫 allow**；项目表随会话 cwd 定位（`projects/<projectKey>/permissions.json`），跨项目互不可见；
- **灾难操作硬拒（D-039）**：灾难性命令（`rm -rf /`、格式化、`dd`、shutdown 等）与凭据同列链外，**任何规则、任何标记都放不了行**；清单由官方 approval 插件承担，官方 shell 工具执行前内置检查；
- **路径围栏跟着能力走（D-039 立、D-049 修订；✓ 落码 2026-11-20 D-065）**：默认放行层只看工具标记；"这条路径能不能碰"的判定住进 fs 能力服务（D-049）——官方 fs / shell 工具件与任何注入该服务的第三方件同样受围栏；工作区内直接执行、区外调 `requestPermission`（`ToolContext` 已注入）、凭据与灾难仍硬拒。落形（interfaces.md §fs）：围栏强制点唯一住 fs 服务层——区内直行（链照常）、区外服务层 `requestPermission(req, {floor:"ask"})` 弹卡；区外写类因此见两张卡（链卡 + 区外卡），有意为之（fail-closed 显式二次确认）；
- **钩子缝（D-027）**：`approval/request`（waterfall）位于规则链（含默认放行层）全未命中、交给宿主 answerer **之前**；监听者可返回 allow / deny / ask / undefined（ask = 照常弹卡）。凭据硬拒、灾难硬拒与 deny 规则仍在它之前，**钩子不能放行凭据与灾难操作**；
- **完全访问层（D-080，2026-11-24）**：回合以 `permissionMode:"full"` 开场（`turn/start` 落账广播，回合内恒定）时，水瀑之后、answerer 之前**自动放行**，落 `approval/decided{decision:'allowed-once', mode:'full'}` 审计标记（事后可辨「非用户逐次放行」）。硬拒清单、deny 规则、hook deny 全部在本层之前——**full 不是「关掉审批」**（[CC] bypass 同界：deny 与凭据在任何模式都活）。缺省 / 换回合未带权威 = ask 兜底（fail-closed）；
- **挂起状态归交互层**：待答请求由 `InteractionService` 维护，会话级、不挂连接——断线重连、多窗口都能重放同一张卡；`settle` 幂等（先答者赢）。approval 插件自身不保存挂起表，只消费答复并映射成 `Decision`（D-013①）；
- **审计**：每次 ask / decided 落 `approval/asked` + `approval/decided` 事件对；**没有打开的回合不接受审批记录**，且**先落 `decided` 再执行工具**（write-ahead，见 [session.md](./session.md) §1.1）；
- "会话级记住允许"提供，存储分两层 → §3.1。

### 3.1 权限的存储分层（2026-11-12 立；R198 修订为三层）

判断标准一句话：**日志记"发生了什么"，规则记"以后怎么办"**。

| 作用范围     | 存哪                                               | 形态                                                                                                                                                                                                                | 理由                                                                              |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **本会话内** | 会话日志                                           | `approval/decided{scope:'session', rule?}`（命令类工具落 `commandExact` 规则、write/edit 落 `pathExact` 规则，其余工具级）；撤销 = 追加 `approval/revoked{scope:'session'}`（回合之外也接受——设置动作不是审批记录） | 它是一次**发生过的决定**；随会话消亡；顺序由 `seq` 保证；不需要额外的可变文件     |
| **本项目**   | `<dataDir>/projects/<projectKey>/permissions.json` | 可手改的 JSON 规则（与全局同形；卡上「本项目允许此命令/此路径」写入精确规则）                                                                                                                                       | 它是**策略**；项目间隔离；与全局同形，复制/手改都简单                             |
| **全局**     | `~/.henira/config/permissions.json`                | 可手改的 JSON 规则                                                                                                                                                                                                  | 它是**策略**；所有项目共享；用户要能编辑、随时撤销、没人会去手改 7MB 的只追加日志 |

规则形状（全局/项目同形；`commandExact`/`pathExact` 精确相等，`commandPrefix`/`commandContains` 是手写能力，多约束同时在场须全部满足）：

```json
{
  "version": 1,
  "rules": [
    { "match": { "tool": "read" }, "decision": "allow" },
    { "match": { "tool": "bash", "commandExact": "git status" }, "decision": "allow" },
    { "match": { "tool": "bash", "commandPrefix": "npm test" }, "decision": "allow" },
    { "match": { "tool": "write", "pathExact": "src/a.ts" }, "decision": "allow" },
    { "match": { "tool": "bash", "commandContains": "rm -rf" }, "decision": "deny" }
  ]
}
```

- 路径规则的 `pathExact` 以会话 cwd 归一（相对路径、POSIX 分隔符、win32 小写，批准/匹配/撤销共用同一函数）；**write 与 edit 的路径规则互相命中**（同文件风险相同），工具级规则不跨工具。卡上只写精确文件，目录/前缀留给手写；
  - **词法路径**：`path.resolve` 不解析 symlink/junction，链接与真实路径互不命中（方向是 fail-safe——会重问）；真实归属检查与 fs 围栏同一挂账（D-065）。
  - **全局文件慎写 `pathExact`**：全局表被所有项目共享，相对路径按**各会话 cwd** 解释——同一条 `"src/a.ts"` 会在每个项目命中同名相对路径；卡上从不写全局路径规则，手写请放项目文件；
- approval 插件**经 `ConfigService` 读规则**，不直接读文件（D-013②）：`permissionRules()` = 全局表、`projectPermissionRules()` = 项目表，判定链把两表合并（**deny 跨表压倒一切**）；写项目规则经 `addProjectPermissionRule()`（2 空格格式化落盘、同条幂等）；
- **凭据硬拒永远优先于这里的任何 `allow`**，且不在规则链内；
- 会话内允许集从日志折叠得出（可缓存）——approve 前本来就要读日志判 pending，不增加成本；`rule` 在场只进规则表、不升级成工具级，撤销按精确规则/按工具/清空三档（折叠层语义；R198 UI/REST 只开清空，R199 起逐条可撤——见 §3.5）；
- 规则文件里**写了命令约束但值非法**（空串/非字符串）→ 整条丢弃：静默降级成 tool 级会把「一条命令的 deny」放大成「整个工具的 deny」；
- 项目规则文件**存在但读不了 / 不是 JSON 对象**（手改语法错）→ 写盘拒绝、原文件不动，本次审批降级为一次放行——整份重写会把用户其他规则静默丢掉；只有文件缺失才新建；
- 规则身份（R199）= protocol canonical key（decision + tool + 命令/路径约束；键序/未知字段无关）：添加幂等、文件删除、账本撤销、UI key 共用；管理面删除命中全部相同条目、未命中不写盘、保留其余原始条目与顶层字段。

### 3.2 子代理的审批（定稿 · 2026-11-13，D-039）

- **前台子代理会问**：审批请求经父会话的交互通道送到用户面前，卡片标注来源——事件 `origin` 字段现成（`{kind:'subagent', id}`）；ZCode（路由父 UI，`subagent-interaction-broker.ts:26-27`）、Claude Code 前台子代理同款；
- **后台子代理永不问**：无交互面 → fail-closed 一律拒，把"被拒了、为什么"写进报告回灌（Claude Code 后台子代理同款，自动 deny）；
- **两种都继承父会话规则**：判定链的规则层照常生效——父会话里点过的"本会话允许"，子代理直接可用（ZCode 同款：子代理继承同一权限服务，`subagent.ts:402-404`）；
- 与 dsh 的差异留档：dsh 把子代理审批钉死 `never` 并收紧工具面（`child-agent.ts:247-254`）；我们不采用——前台子代理保有完整能力，后台以"拒 + 报告"兜底。

### 3.3 PermissionRequest 载荷（定稿 · 2026-11-14，D-046）

- **载荷 = `{ tool, args（完整原样）, reason?, callId? }`**：引擎一字不加工——判定链、审计事件对、重连重放用同一份全文（Claude Code 权限回调收全 input 同款，行为层观察）；`callId` 由 tools 管线填真实 `tool/call` id（R202 / D-085）；
- **显示归界面 UI**：折叠 / 展开 / 高亮是**展示裁剪**，不是转述——卡上可以只露"写入 bar.ts（约 2000 行）+ 头部预览 + 展开按钮"，数据全文永远在载荷里；引擎层造摘要没有一家做（摘要是转述层，写错 = 骗批准）；
- **挂起请求自足可渲染**（args 在载荷里）：断线重连、多窗口重放同一张卡（P5 既有设计）；
- `displayReason`（dsh `user-approval/types.ts:72`，仅展示不入审计）不进 v1 载荷——M2 落码时按卡片可读性再定是否补可选字段。
- **落码归位（E6，2026-11-21）**：实现初版把 `approval/asked` 落成 12 位 digest（偏离本条备注），E6 批对齐——**审计事件对照记全文**（`args` 完整原样 + `reason`），digest 保留作关联指纹；凭据经架构保证不进 args（`${credential}` 展开只在 MCP 配置装载），`tool/call.arguments` 全文进账本早已是既有实践，D-030 面不新增。**「挂起请求自足可渲染」自此成立**：行模型携带 args 全文，断线重连 / 多窗口重放同一张卡。
- **超限降级（R202 / D-085）**：args 序列化 >256KB 或不可序列化时，approval 服务侧丢弃 args（digest 保留）；`approval/asked` 与 `ApprovalRow` 携带真实 `callId`，卡片按此从同会话 `tool/call` 行回查参数——挂起卡仍自足；行不在窗口内才回落 digest-only。正常尺寸仍走全文（不新增 argsPreview）。
- **审计与呈现分层（E3 实锤，2026-11-21）**：默认放行层 / 规则层 / 会话折叠的 `decided` 审计**无 asked 配对**——投影层不为其产会话行（自动放行的工具调用不在对话流里留「权限请求 allowed-once」噪音行）；只有真问过（answerer 路径）的审批对才有行。审计住账本，呈现归 UI。

### 3.4 审批卡呈现（定稿 · 2026-11-21，E6）

- **per-tool 预览体**（四仓对照：CC 每工具一个权限对话框且复用工具卡 diff 组件、ZCode 权限弹窗复用聊天 renderer；dsh 零参数反例已被 D-046 否决）：edit/write → diff 预览（E5 `buildDiffRows` 同机器——CC「同组件复用」行为层）、bash/powershell → 全命令行、read/glob/grep → 路径 / 模式摘要、未知工具（含 MCP）→ JSON 预览；**字段窄化校验不过一律回落 JSON 预览**（E5「宁缺毋滥」纪律），绝不渲染坏预览。
- **选项集（R198 / D-087）**：bash/powershell 且命令在场 → 四钮：允许（once）/ **本会话允许此命令**（`scope:'session'` + 精确命令规则）/ **本项目允许此命令**（`scope:'project'`，写项目 `permissions.json`）/ 拒绝；write/edit 且路径在场 → 同形四钮（**此路径**，`pathExact`）；其余工具（MCP 等）→ 三钮：允许 / **本会话允许**（工具级）/ 拒绝。**精确工具但命令/路径缺失 → 不给会话/项目选项**（工具级放行过宽；降级一次）。撤销入口在 chip 菜单（R199）：本会话允许 → 同弹层规则面板逐条撤销/全部撤销；本项目允许 → 设置 › 权限按项目逐条查看/删除（见 §3.5）。
- **拒绝说明（D-087）**：卡上编号列表**最后一行**是独立 textarea「告诉模型接下来应该怎么做…」（不是挂在拒绝按钮上）：输入后 Enter = 拒绝 + 说明，空内容不提交，Esc 只失焦；点「拒绝」时草稿一并带上。**D-088 起**说明行是独立导航行——聚焦即选中该行（卡上高亮跟随，不再常驻首行）；说明为空时确认按钮禁用。**D-089**：↑↓/Tab 从说明框移出时先清焦点守卫，选中与光标一起回选项（不再滞留输入框）。说明随 `approval/decided.feedback` 落账（≤4096 码点，刷新/重放/多窗口一致）并进入工具结果——用户拒绝 =「工具未执行 + 停下等指示（+ 用户原话）」；策略拒绝/取消/缺席保持中性文本，不冒充用户拒绝。说明同时投影到 `ApprovalRow.feedback`（官方对话流按 E6 纪律不渲染审批痕迹；自定义 conversation 件/审计面可消费）。上限与归一在 REST / 引擎 / 账本三处同源（UI 用 `maxLength` 按码元计，只会更严）。
- **范围落账**：`decided{scope, rule}` 与 `revoked` 全部进账本——会话允许是审计事实、项目允许在文件里是策略；项目写盘失败或命令缺失时降级为一次（用户已点下的这次允许不被配置写失败挡住）。
- **队列**：并发挂起只渲染**队首一张** + 「待审批 N」计数（CC/ZCode FIFO 同款；多卡各挂键盘监听器导致一次 Enter 全中——E6 前真 bug，随单卡化消除）。**键盘与确认（D-088 / D-089）**：默认选中第 1 行并聚焦（焦点在座位外/可编辑控件时不夺焦）；↑↓/←→/Tab 在选项与说明行间移动选中，Enter = 确认当前选中行，**常驻「确认」按钮**（说明行选中且为空时禁用）；数字键 `1..N` 直接裁决、`N+1` 聚焦说明行；鼠标点未选中行只选中，再点 / Enter / 确认钮才裁决。**D-089 Tab 围栏**：Tab/Shift+Tab 只在「选项 + 说明行」循环（说明框 Tab 与 ↑↓ 同路走 moveSelection；确认钮是鼠标件，键盘用 Enter），确认钮/卡容器上的 Tab 由卡根兜底回选中行——Tab 不出卡。**首帧焦点不依赖 RAF**（同步座位守卫 + `setTimeout(0)` 容器兜底；后台标签页 rAF 停摆也落选中行）。**Esc=拒绝**（拒绝通道非中断，CC/ZCode TUI 同款；ZCode 桌面弹窗无 Esc 拒绝，取并集）；焦点在说明框内时 Esc 只失焦。挂起/收口发 `sessions.changed`，左列表显示「等待确认」徽标（D-089）。
- **keyed 缝 `approval.view.<工具名>`**（词表 10→11，D-057 延伸）：官方 per-tool 审批卡八键注册进缝（edit/write/bash/powershell/read/glob/grep/mcp），插件 `replaceSlot` 顶替、卸载回落通用卡；未知工具回落通用卡（非代码级 fallback）。
- **挂账**：bash 前缀级规则（卡上仍只落精确命令；前缀靠手写 rules）与 always 固化预览文案（opencode 样板：save[] 预计算 + 二段确认）。

### 3.5 权限管理面（定稿 · 2026-11-24，R199 / D-082）

- **面划分**：设置 › 权限 = 持久策略（项目 + 全局），任何情况下**不含「本会话」**；会话临时允许只在输入框 chip 的规则面板（同一弹层视图切换：模式菜单 ⇄ 本会话允许列表）。直接点设置与从会话进设置同义——设置不接收会话入参。
- **项目清单** = `projects.json` 登记目录（左栏同源、含自愈）；设置选择器用 `DirRegistry.peek()`（只读不自愈），`list()` 仍负责扫账本复活。只有 `permissions.json`、没有目录条的孤儿项目不进选择器（规则仍生效，可手改）。默认选中当前会话项目，无会话选第一个；**选择只影响查看，不切会话、不改审批归属**。
- **逐条操作**：会话行「撤销」→ `approval/revoked{scope:'session', rule|tool}`（无确认，下一次重问）；项目/全局行「删除」→ 直接改规则文件（确认框；deny 额外警示；全局标注影响所有项目），**不写会话账本事件**——文件是策略源，手改本来也无审计。
- **规则同一性**：protocol canonical key（decision + tool + `commandExact`/`Prefix`/`Contains`/`pathExact`；键序、未知字段无关）。添加幂等、文件删除、账本撤销、UI key 共用；删除命中全部相同条目，未命中不写盘，保留其余原始条目与顶层字段。
- **文件三态**：`ok | missing | corrupt`。管理面把 corrupt 显示为警示 + 路径、禁用删除；写盘（添加/删除）对 corrupt 一律拒绝，绝不覆盖（§3.1 纪律延伸）。`invalidCount` 提示文件里有、形状非法被丢弃的条目数。
- **拒绝语义**：审批卡「拒绝」仍是一次性裁决——不生成规则，下一次相同调用继续询问（参照行为层一致）；持久 deny 只住规则文件（本批可见/可删，不提供新增/编辑）。卡上不加第五钮。
- **深链**：`SettingsModal` 跟随 `props.section` 变化；chip「本项目允许 N 条 › 设置中管理」调 `ctx.openSettings("permission")`。
- **降级**：旧宿主缺 client 方法 → 设置页只显示新会话默认档并提示不支持；chip 无 `sessionPermissions` 时不显示允许区。

_已定稿：凭据硬拒清单 → 官方 approval 插件承担（D-012④，2026-11-11）。_
_已定稿：审批事件对在回合内 + 先落 decided 再执行；权限两层存储（2026-11-12）。_
_已定稿：判定链补默认放行层与灾难硬拒；子代理审批 = 前台问 / 后台拒 / 继承规则（D-039，2026-11-13）。_
_已定稿：工具结果统一出口截断 + 超限落盘留路径（2026-11-13）。_
_已定稿：PermissionRequest 载荷 = {tool, args 全文, reason?}，显示折叠归界面 UI（D-046，2026-11-14）。_
_已定稿：权限管理面 = 设置管持久规则 / chip 管本会话、逐条撤销与删除、坏文件不覆盖（D-082，2026-11-24）。
