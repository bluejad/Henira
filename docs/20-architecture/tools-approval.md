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

- **统一出口限量**：工具结果在进流水账 / 模型上下文前由执行出口统一限量——默认 **2000 行 / 50KB**（量级照 OpenCode `tool-output.ts:13-14`），经 `ConfigService` 可配；**工具可自定更严上限**（如 bash 只留尾部 30KB，Claude Code 同款）；
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

function requestPermission(req: PermissionRequest): Promise<Decision>;
```

**判定链顺序（严格固定；D-039 补默认放行层与灾难硬拒）**：

```
凭据硬拒 ──→ 灾难操作硬拒 ──→ 全局 deny ──→ 会话 deny ──→ 全局 allow ──→ 会话 allow ──→ 默认放行（只读标记）
（链外：任何规则都放不了行）                                                ──→ 仍未命中：approval/request 缝 ──→ answerer
```

- **fail-closed**：answerer（= `InteractionService`）缺失 / 抛错 / 返回不合规值 → 一律 `unavailable` → 必须拒 `[dsh]`；
- **默认放行层（D-039，2026-11-13）**：无任何规则命中时，`isConcurrencySafe: true`（只读标记）**自动放行**并照常落 `approval/decided` 审计；其余照旧走缝与 answerer。`deny` 规则压倒一切（链首），显式 allow 规则也在默认层之前。web_fetch 类只读工具因此免问（Claude Code 默认放行抓取）。headless（`henira run`）开箱即可跑只读任务，写类靠 `permissions.json` 规则（§3.1）；
- **灾难操作硬拒（D-039）**：灾难性命令（`rm -rf /`、格式化、`dd`、shutdown 等）与凭据同列链外，**任何规则、任何标记都放不了行**；清单由官方 approval 插件承担，官方 shell 工具执行前内置检查；
- **路径围栏跟着能力走（D-039 立、D-049 修订）**：默认放行层只看工具标记；"这条路径能不能碰"的判定住进 fs 能力服务（D-049）——官方 fs / shell 工具件与任何注入该服务的第三方件同样受围栏；工作区内直接执行、区外调 `requestPermission`（`ToolContext` 已注入）、凭据与灾难仍硬拒；
- **钩子缝（D-027）**：`approval/request`（waterfall）位于规则链（含默认放行层）全未命中、交给宿主 answerer **之前**；监听者可返回 allow / deny / ask / undefined（ask = 照常弹卡）。凭据硬拒、灾难硬拒与 deny 规则仍在它之前，**钩子不能放行凭据与灾难操作**；
- **挂起状态归交互层**：待答请求由 `InteractionService` 维护，会话级、不挂连接——断线重连、多窗口都能重放同一张卡；`settle` 幂等（先答者赢）。approval 插件自身不保存挂起表，只消费答复并映射成 `Decision`（D-013①）；
- **审计**：每次 ask / decided 落 `approval/asked` + `approval/decided` 事件对；**没有打开的回合不接受审批记录**，且**先落 `decided` 再执行工具**（write-ahead，见 [session.md](./session.md) §1.1）；
- "会话级记住允许"提供，存储分两层 → §3.1。

### 3.1 权限的两层存储（已定 · 2026-11-12）

判断标准一句话：**日志记"发生了什么"，规则记"以后怎么办"**。

| 作用范围                            | 存哪                                | 形态                                                                                                                                                             | 理由                                                                              |
| ----------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **本会话内**（点"本会话允许 bash"） | 会话日志                            | `approval/decided{decision:'allowed-once', scope:'session'}` 事件（Decision 仍是四值，会话范围由 `scope` 表达）；撤销 = 追加 `approval/revoked{scope:'session'}` | 它是一次**发生过的决定**；随会话消亡；顺序由 `seq` 保证；不需要额外的可变文件     |
| **跨会话**（"以后都别问 read"）     | `~/.henira/config/permissions.json` | 可手改的 JSON 规则                                                                                                                                               | 它是**策略**；用户要能编辑、随时撤销、所有会话共享；没人会去手改 7MB 的只追加日志 |

跨会话规则形状（示例）：

```json
{
  "rules": [
    { "match": { "tool": "read" }, "decision": "allow" },
    { "match": { "tool": "bash", "commandPrefix": "npm test" }, "decision": "allow" },
    { "match": { "tool": "bash", "commandContains": "rm -rf" }, "decision": "deny" }
  ]
}
```

- approval 插件**经 `ConfigService` 读规则**，不直接读文件（D-013②）；
- **凭据硬拒永远优先于这里的任何 `allow`**，且不在规则链内；
- 会话内允许集从日志折叠得出（可缓存）——approve 前本来就要读日志判 pending，不增加成本。

### 3.2 子代理的审批（定稿 · 2026-11-13，D-039）

- **前台子代理会问**：审批请求经父会话的交互通道送到用户面前，卡片标注来源——事件 `origin` 字段现成（`{kind:'subagent', id}`）；ZCode（路由父 UI，`subagent-interaction-broker.ts:26-27`）、Claude Code 前台子代理同款；
- **后台子代理永不问**：无交互面 → fail-closed 一律拒，把"被拒了、为什么"写进报告回灌（Claude Code 后台子代理同款，自动 deny）；
- **两种都继承父会话规则**：判定链的规则层照常生效——父会话里点过的"本会话允许"，子代理直接可用（ZCode 同款：子代理继承同一权限服务，`subagent.ts:402-404`）；
- 与 dsh 的差异留档：dsh 把子代理审批钉死 `never` 并收紧工具面（`child-agent.ts:247-254`）；我们不采用——前台子代理保有完整能力，后台以"拒 + 报告"兜底。

### 3.3 PermissionRequest 载荷（定稿 · 2026-11-14，D-046）

- **载荷 = `{ tool, args（完整原样）, reason? }`**：引擎一字不加工——判定链、审计事件对、重连重放用同一份全文（Claude Code 权限回调收全 input 同款，行为层观察）；
- **显示归界面 UI**：折叠 / 展开 / 高亮是**展示裁剪**，不是转述——卡上可以只露"写入 bar.ts（约 2000 行）+ 头部预览 + 展开按钮"，数据全文永远在载荷里；引擎层造摘要没有一家做（摘要是转述层，写错 = 骗批准）；
- **挂起请求自足可渲染**（args 在载荷里）：断线重连、多窗口重放同一张卡（P5 既有设计）；
- `displayReason`（dsh `user-approval/types.ts:72`，仅展示不入审计）不进 v1 载荷——M2 落码时按卡片可读性再定是否补可选字段。

_已定稿：凭据硬拒清单 → 官方 approval 插件承担（D-012④，2026-11-11）。_
_已定稿：审批事件对在回合内 + 先落 decided 再执行；权限两层存储（2026-11-12）。_
_已定稿：判定链补默认放行层与灾难硬拒；子代理审批 = 前台问 / 后台拒 / 继承规则（D-039，2026-11-13）。_
_已定稿：工具结果统一出口截断 + 超限落盘留路径（2026-11-13）。_
_已定稿：PermissionRequest 载荷 = {tool, args 全文, reason?}，显示折叠归界面 UI（D-046，2026-11-14）。_
