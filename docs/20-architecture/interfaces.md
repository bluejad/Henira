# 关键接口形状（TS 签名草案）

> 各包对外 API 的**形状级草案**——定方向不锁细节，实施时在此文件同步演进。
> 状态：**kernel 段、config-loader 段与插件 UI 门面已定稿**（2026-11-12）；**protocol 段全部定稿**——信封类型、事件注册表（D-051）、SessionService（2026-11-16）与引擎五槽接口及全部 DTO（2026-11-16，M2 开工定稿）；**server / sdk / web 段定稿**（2026-11-17，M3 开工定稿）。

---

## kernel —— 机制（唯一内核，D-010）

```ts
// ── 服务定义 ──────────────────────────────────────────────
// 一个插件 = 一个 ServiceDefinition。槽位可选：只注册工具 / 注册事件类型 /
// 挂钩子的插件不占槽位，省略 name 即可（如熔断插件）。
interface ServiceDefinition<T = unknown> {
  name?: string; // 占用的槽位名，如 'loop'；省略 = 不占槽位
  inject?: readonly string[]; // 启动前必须已存在的槽位 → 启动顺序由依赖图驱动
  start(ctx: HarnessContext): T | void | Promise<T | void>;
  stop?(svc: T): Promise<void> | void; // 只收尾"服务自身的资源"（连接、句柄、flush）
}

// ── 事件总线 ──────────────────────────────────────────────
// 四种模式（D-012①）：
//   emit      —— 发完不管
//   serial    —— 顺序 await 每个监听器，异常向上抛
//   waterfall —— 链式改写；监听器必须返回新值或调用 next()，否则短路
//   bail      —— 顺序执行，第一个返回 Veto 的即停；无反对返回 undefined
type Veto = {
  by: string; // 谁否决的（插件名，排查用）
  reason: string; // 为什么
  resume?: { prompt: string }; // 可选：注入这句提示继续跑（熔断续跑）
};

interface EventBus {
  // 注册：每种模式一个方法——调用处一眼看出语义，类型各管各的
  on(type: string, fn: (payload: unknown) => void): Disposable;
  onSerial(type: string, fn: (payload: unknown) => void | Promise<void>): Disposable;
  onWaterfall<T>(
    type: string,
    fn: (value: T, next: (v: T) => Promise<T>) => T | Promise<T>,
  ): Disposable;
  onBail(
    type: string,
    fn: (value: unknown) => Veto | undefined | Promise<Veto | undefined>,
  ): Disposable;

  // 触发
  emit(type: string, payload: unknown): void;
  serial(type: string, payload: unknown): Promise<void>;
  waterfall<T>(type: string, value: T): Promise<T>;
  bail<T>(type: string, value: T): Promise<Veto | undefined>;
}

interface HarnessContext {
  get<T>(slot: string): T; // 取已启动的服务；未注册 → 抛 MissingSlotError
  events: EventBus;
  effect(fn: () => Disposable | void): Disposable; // 与插件同生命周期，逆序撤销
}

type Disposable = () => void; // 注册撤销：同步、幂等；服务自身资源由 stop() 异步收尾
// 所以 P7 的"可逆卸载" = 注册同步撤销 + stop() 异步收尾 + Harness.dispose() 逆序等待

// ── 装配 API（开发者面，D-011）───────────────────────────
interface Harness {
  use(def: ServiceDefinition): this; // 只能在 start() 之前；槽位重名立刻抛
  start(): Promise<void>; // 校验 inject → 按依赖图排序启动
  readonly context: HarnessContext;
  dispose(): Promise<void>; // 逆序 unwind 全部 effect 与 stop()
}
function createHarness(): Harness;
```

**四种情况必须报清楚**（否则只能看天调试）：

| 情况                        | 时机       | 行为                                                              |
| --------------------------- | ---------- | ----------------------------------------------------------------- |
| `ctx.get('llm')` 但没人提供 | 运行期     | 抛 `MissingSlotError`，消息含"谁在要、有哪些槽位可用"             |
| 两个插件抢同一槽位名        | `use()` 时 | **立刻抛**，不等 `start()`                                        |
| `start()` 之后再 `use()`    | `use()` 时 | 抛错——依赖顺序与 effect 都要重算，不允许                          |
| `inject` 里有不存在的槽位   | `start()`  | **统一静态检查、一次报全**：`loop 需要槽位 'llm'，没有插件提供它` |

**两条约定**：

- `effect()` 收钩子 / 监听 / 定时器（自动撤销）；`stop()` 收服务自身资源（连接、句柄、flush）。两者都参与逆序卸载；
- 每个插件拿到的 `ctx` **绑定自己的名字**，所以报错能说清是谁在要，而不是"某个地方要 llm"。

**为什么自研、不 vendor cordis（D-023）**：cordis 的价值大半在 loader / HMR / YAML 配置树——D-011 / D-015 明确不要；剩下 core 与本文四种模式同构。M1 用上游 22 条本地补丁暴露的边界当"语义钉子"测试清单（重入卸载 / setup 内注册 / pending 新增 inject / waterfall 否决 / unloading 拒绝注册），M2 收尾若内核 bug 拖慢闭环或出现会话内热加插件需求，再评估 vendor（MIT）。

**类型化门面在 protocol**（kernel 不认识任何业务接口，D-012②）：

```ts
// protocol 导出：插件作者用这个，不直接用未类型化的 HarnessContext.get
interface SlotMap {
  session: SessionService;
  llm: LlmService;
  tools: ToolsService;
  approval: ApprovalService;
  loop: LoopService;
  interaction: InteractionService;
  config: ConfigService;
}
// commands 槽随 plugin-commands 落码（M6）进入 SlotMap（D-025；接口形状已定稿于 protocol 段）
type HeniraContext = Omit<HarnessContext, "get"> & {
  get<K extends keyof SlotMap>(slot: K): SlotMap[K];
};
function asHeniraContext(ctx: HarnessContext): HeniraContext;
```

## protocol —— 契约（槽位接口 + 事件词表 + DTO）

> **最小化规则（D-013③）**：protocol 只放"两个插件必须达成一致的东西"——槽位接口、事件信封与词表、跨插件 DTO；不放便利类型、不放单插件内部类型、不放产品概念。新增类型先回答"谁和谁必须一致？"，答不出就不进。

```ts
// 槽位接口（D-012②：全部在 protocol，kernel 不认识它们）
type SessionEventInput = { type: string; data: unknown; ignorable?: boolean };

interface SessionService {
  header(): SessionHeader;                                  // 文件第 1 行的不可变身份（含 version）
  readonly directory: string;                               // 会话目录（queue.json / 附件住处，data-directory §2.1）
  append(input: SessionEventInput): Promise<SessionEvent>;   // 校验 → 分配 seq → 追加 → fsync
  events(): readonly SessionEvent[];
  deriveMessages(): ModelMessage[];                          // 应用 surfaceOp 后的模型历史
  fork(atSeq?: number): Promise<SessionService>;             // 复制前缀；半回合切点补 turn/end{forked}
  replay(visitor: (e: SessionEvent) => void | Promise<void>): Promise<void>;
}

// ── 引擎 DTO（M2 定稿 · 2026-11-16）──────────────────────────

type JsonSchema = Record<string, unknown>; // 裸 JSON Schema（D-044）：书写层形状；装载期由 tools 校验

/** 模型配置：能力字段由 models.dev 字典预填、手写覆盖（D-040）；不含凭据（D-013②） */
interface ModelConfig {
  provider: string; // 供应商标识（credentials / 字典键）
  model: string; // 模型 id
  baseUrl?: string; // OpenAI 兼容端点（自建 / 代理）
  contextWindow?: number; // 能力字段——引擎内禁止厂商备表（P9-4），只从配置解析
  maxOutputTokens?: number;
}

interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/** 封闭词表（对齐 AI SDK finish reason 集；error / other 映射 unknown + 流 rejection） */
type FinishReason = "stop" | "tool-calls" | "length" | "content-filter" | "unknown";

/** llm 流失败的类型化错误（rejection 通道，不进 StreamEvent——失败不走事件） */
class LlmError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

// StreamEvent：封闭判别联合（不变量见 P3，测试锁定）。失败 = 流 rejection（携带 LlmError）；
// 中断由 loop 先查自有 AbortController 再诊断（P6 纪律 1）。
type StreamEvent =
  | { type: 'text-delta';      text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call';       callId: string; name: string; argsText: string }  // 恒为原始 JSON
  | { type: 'usage';           usage: TokenUsage }                               // 先于 finish
  | { type: 'finish';          reason: FinishReason };

interface LlmRequest {
  model: ModelConfig;
  messages: ModelMessage[];
  tools: WireToolSchema[]; // 本请求投影给模型的工具清单
  temperature?: number;
  maxTokens?: number;
}

interface WireToolSchema { // tools.project() 的产物 = 模型可见清单形状
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

interface LlmService {
  stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}
// prepareCall 从 M2 契约移除（无消费者；M1 纪律：只有定稿契约进 protocol）——
// contextWindow 经 ModelConfig 解析（P3），压缩预算接口随 M5 压缩设计文档回归。

/** 引擎侧工具调用（与 StreamEvent 同源）；日志侧对偶 = ToolCallDraft.arguments */
interface ToolCall {
  callId: string;
  name: string;
  argsText: string; // 恒为原始 JSON 文本
}

interface ToolDefinition {
  name: string; // 全局唯一，注册时查重
  description: string; // 给模型看
  inputSchema: JsonSchema; // 裸 JSON Schema（D-044）
  isConcurrencySafe?: boolean; // 只读标记：默认放行层（D-039）与并行调度共用
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  requestPermission(req: PermissionRequest): Promise<Decision>; // 判定链唯一入口
  config: ConfigService;
  /** 工具输出超限落盘目录（截断 spill；loop 传会话目录 artifacts/——随会话同生共死，M4 批 A） */
  artifactsDir?: string;
}

interface ToolResult {
  content: string; // 模型可见文本（出口限量已应用，tools-approval §1.1）
  isError?: boolean;
  __meta?: Record<string, unknown>; // 带外通道（P4）：检查点/引用/图片元数据，loop 分流，不进模型上下文
}

interface ToolOutcome {
  result: ToolResult;
  truncated?: { path: string; preview: string }; // 超限落盘留路径（tools-approval §1.1）
  durationMs: number; // execute 段真实耗时；未到 execute 的链前拒/解析拒为 0（审计事实不造假）
}

interface ToolFilter {
  include?: readonly string[];
  exclude?: readonly string[];
}

interface ToolsService {
  register(tool: ToolDefinition): Disposable;
  project(filter?: ToolFilter): WireToolSchema[]; // 模型可见清单（声明式过滤）
  isConcurrencySafe(name: string): boolean | undefined; // D-039 默认放行层查询
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolOutcome>;
  // 批执行（loop 的每步调用入口）：连续 isConcurrencySafe 并行（上限 10），其余串行；结果按原顺序回写
  run(calls: readonly ToolCall[], ctx: ToolContext): Promise<ToolOutcome[]>;
}

// `tools/pre-execute` waterfall 值：监听者经 mergeGateVerdict 合并表态（deny > ask > allow，单调）
interface GateVerdict {
  tool: string;
  args: unknown;
  verdict: "allow" | "deny" | "ask";
  by?: string; // 谁表的态（排查用）
  reason?: string;
}
function mergeGateVerdict(
  prev: GateVerdict,
  next: Pick<GateVerdict, "verdict"> & Partial<Pick<GateVerdict, "by" | "reason">>,
): GateVerdict; // 单调合并：deny > ask > allow；后注册者不得放宽先注册者的表态（tools-approval §2.1）

// `tools/post-execute` waterfall 值：监听者可检视/替换结果（附加上下文）
interface PostExecuteValue {
  call: ToolCall;
  outcome: ToolOutcome;
}

type Decision = "allowed-once" | "rejected" | "cancelled" | "unavailable";

/** 审批载荷（D-046 定稿）：引擎一字不加工；显示折叠归界面 UI */
interface PermissionRequest {
  tool: string;
  args: unknown; // 完整原样
  reason?: string;
}

// 审批策略（D-013①：只管规则与 fail-closed，不碰 UI）
interface ApprovalOptions {
  signal?: AbortSignal;
  /** 闸门抬高下限（tools-approval §2.1）：pre-execute 监听者表态 ask → 默认放行层不得自动通过 */
  floor?: "ask";
}
interface ApprovalService {
  requestPermission(req: PermissionRequest, opts?: ApprovalOptions): Promise<Decision>;
}

// 交互通道（D-013①）：引擎所在进程的宿主实现（①=server；③=cli / sdk 嵌入方，sdk 自带缺省实现；
// 测试与 examples 用 mock 自动应答）。M2 只定审批交互；question 类随其首个消费者定稿时扩展。
type InteractionRequest =
  | { kind: 'approval'; requestId: string; toolName: string; args: unknown; reason?: string };

type InteractionAnswer =
  | { kind: 'approval'; requestId: string; decision: Decision };

interface InteractionService {
  ask(req: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer>;
  settle(requestId: string, answer: InteractionAnswer): boolean; // 幂等，先答者赢
  listPending(): readonly InteractionRequest[]; // 断线 / 刷新重放（P5）
}

/** 跨会话权限规则（tools-approval §3.1 permissions.json；deny 压倒一切，链首） */
interface PermissionRule {
  match: { tool: string; commandPrefix?: string; commandContains?: string };
  decision: "allow" | "deny";
}

// 配置面（D-013②）：宿主实现（config-loader）；llm / approval 不直接读 env 或文件
interface ConfigService {
  readonly cwd: string;
  model(id?: string): Promise<ModelConfig>;        // 只含能力字段（contextWindow 等），不含密钥
  credential(providerId: string): Promise<string>; // 仅 llm 适配器调用
  get<T>(key: string): Promise<T | undefined>;     // 插件自有配置段（settings.json plugins.<id>.options
                                                   //  与项目 henira.config.ts options 合并，项目优先）
  permissionRules(): Promise<readonly PermissionRule[]>; // permissions.json 规则（approval 经此读，§3.1）
}

/** turn/end.reason 7 值（session.md §2.4 同源）；interrupted / forked 只由 session 补写产生，loop 不发 */
type TurnEndReason =
  | "completed"
  | "aborted"
  | "blocked"
  | "error"
  | "max-tokens"
  | "interrupted"
  | "forked";

interface QueuedPrompt {
  id: string;
  text: string;
  steer: boolean; // true = "立即发送"插话条目（下一 step 边界进场，D-045）
}

// run() 产出的回合事件流（增量变体走 16ms 攒批；结构事件永不攒批——[opencode]
// `publish-llm-event.ts:289` "block starts are not batched" 同规）。定稿 2026-11-16。
type LoopEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-started"; callId: string; name: string }
  | { type: "tool-finished"; callId: string; name: string; isError: boolean }
  | { type: "approval-requested"; requestId: string; tool: string; reason?: string }
  | { type: "turn-ended"; reason: TurnEndReason }
  | { type: "error"; message: string };

interface LoopService {
  run(prompt: string, signal?: AbortSignal): AsyncIterable<LoopEvent>; // 开启一回合并流出事件
  send(prompt: string, opts?: { steer?: boolean }): Promise<QueuedPrompt>;
  //   闲时 = 直接开新回合（事件照常落账本；无返回 iterable——消费者经总线 / 会话事件观察）；
  //   忙时入队（queue.json 持久化，重启恢复，D-045）
  steer(entryId: string): Promise<boolean>; // 队列条目"立即发送" = 插话升格
  interrupt(signal?: AbortSignal): Promise<void>; // 中止当前回合（turn/end{aborted, cause:'user'}）
}

// 命令收集（D-025）：官方 plugin-commands 实现并占 `commands` 槽位；宿主只消费
interface CommandInfo {
  name: string;              // 不含前导 /
  description: string;
  argumentHint?: string;
  source: string;            // 插件 id / 目录
}
interface CommandService {
  list(): Promise<CommandInfo[]>;                       // 本会话可见的 commands/
  expand(name: string, args: string): Promise<string>;  // 替换 $ARGUMENTS，返回待发送文本
}

// 事件注册表：开放 map（P1）；校验器 = 最小 duck 接口（D-051：protocol 零依赖、
// 只认"会 safeParse 的校验器"，不认 schema 库牌子；官方 15 变体由 session 包用 zod 实现）
interface EventValidator {
  safeParse(data: unknown):
    | { success: true; data: unknown }
    | { success: false; error: unknown };
}
const SessionEventRegistry: Map<string, EventValidator>;   // 官方注册基础变体，插件可追加
// 派生清单（禁止手抄，P9-5）：KNOWN_EVENT_TYPES、schema 反查表均由此生成
```

## config-loader —— 装配翻译（定稿，D-011 / D-015 / D-016）

```ts
// ── 官方默认预设（出厂清单）：无 config 文件时的装配来源 ──
interface PluginEntry {
  id: string;                        // 稳定标识：官方插件 id / 已装插件目录名
  definition?: ServiceDefinition;    // 引擎插件装配物；纯内容包省略（不占槽位，由读者扫目录）
  options?: Record<string, unknown>; // 插件参数（settings 与项目 options 合并后由 config-loader 填入）
}
// defaultPreset 共 21 条：引擎 / 能力 / 读者 20 条带 definition（服务件与工具件皆清单条目，D-049）；
//   web-ui 为 id-only 条目（无引擎 definition，由 web 宿主装载其界面件，D-043）；
//   已装内容包只以 id + options 出现在装配结果里，供读者按开关过滤。
export const defaultPreset: PluginEntry[];   // 官方 22 个插件；想基于默认改 = import 后 spread,
                                             // 不设 add/remove 补丁语法（TS 代码即补丁机制）
export const bundledSkillDirs: string[];     // 官方随包技能目录清单（D-026，读者按清单扫）

// ── 项目根目录 henira.config.ts（开发者手写，进 git；普通用户不碰）──
//   import { defaultPreset } from '@henira/config-loader';
//   export default defineConfig({ plugins: [...defaultPreset, myPlugin] })
defineConfig(cfg: HeniraConfig): HeniraConfig;   // 纯类型辅助，零运行时逻辑

interface HeniraConfig {
  model?: string;                      // 本项目固定模型（缺省听全局 settings.json）
  plugins?: PluginEntry[];             // 基础插件清单；缺省 = defaultPreset
  options?: Record<string, unknown>;   // 本项目插件参数（键 = 插件 id）；项目优先于全局
}

// ── 全局 ~/.henira/config/settings.json（界面上点、程序写、不进 git，见 data-directory.md §2.3）──
//   { version, model?, plugins?: { <id>: { enabled?, version?, options? } }, ui?: { theme? } }
//
// 装配三步（每个新会话执行，D-016）：
//   ① 基础清单 = cfg.plugins ?? defaultPreset
//   ② 加已装目录里的插件（~/.henira/plugins/ 与项目 .henira/plugins/；同 id 不重复算，同名项目盖用户级；
//     用户包 id 撞官方且带 engine/ → 经确认卡替换官方，D-048）
//   ③ 去掉 settings.json 里 enabled: false 的（内圈 5 槽位不给关）
// 对新会话立即生效；官方替换两条路：开发者 = 显式写清单（cfg.plugins 不列官方、列自己的）；
//   用户 / AI = 同 id + engine/ 经确认卡（D-048）。
// 服务件与工具件同为清单条目；工具件声明注入的服务不在装配结果里 → 该件不装载 + 告警（D-049 装配层预检）。
//
// ── 常见改法（D-022：不设补丁语法，TS 表达式就是补丁）──
//   plugins: [...defaultPreset.filter(p => p.id !== 'plugin-shell'), myShell]   // 换一个
//   plugins: [...defaultPreset, myPlugin]                                       // 加一个
//   plugins: defaultPreset.map(p => p.id === 'plugin-loop' ? myLoop : p)        // 整只替换
// 同一槽位两个插件 = use() 立即报错（不静默后者赢）。

loadConfig(root: string): Promise<HeniraConfig>;          // 读 henira.config.ts + settings.json + 最小校验
applyConfig(harness: Harness, cfg: HeniraConfig): void;   // 翻译成 .use() 调用
```

## tools / approval（官方插件实现，签名经槽位接口暴露）

- **定稿形状全部在 protocol 段**（2026-11-16）：ToolDefinition / ToolContext / ToolResult / ToolOutcome / PermissionRequest / Decision / PermissionRule / GateVerdict（`tools/pre-execute` waterfall 值 + mergeGateVerdict 单调合并）/ PostExecuteValue（`tools/post-execute` waterfall 值）；
- `defineTool(def): ToolDefinition` —— 类型推断辅助，住 `@henira/plugin-tools` 出口（不进 protocol，D-013③）；
- 官方插件直写 JSON Schema（dsh 同款），不建转换糖；execute 入参不靠 schema 推导 TS 类型（松散 args + 引擎校验 + 工具测试钉）；装载期校验非法 schema → 插件跳过 + 告警（接 D-029）；
- ToolResult 带 `__` 前缀带外通道（P4）：`__meta` 等由 loop 路由，不进模型上下文。

## 能力服务与注入装载（D-049）

> 机制骨架已定（kernel `ServiceDefinition.inject` + `start()` 静态检查）；本节定**能力服务**的规矩与装载语义。各服务契约小节落码前在本文件定稿（活文件），**此处只记名与归属，不写实现**。

- **官方插件对外能力一律服务**（单消费者亦然，无第二种写法）；跨包共享必经服务；第三方插件同权提供与消费；
- 注入声明在引擎模块导出：`export const inject = ['fs', …]`；manifest 不复写（单一事实源）；
- **装载语义两级**：装配层预检——声明注入的服务无提供者 → 该引擎件不装载 + 告警（不挡其他插件）；进到 kernel 的 inject 静态检查是最后防线（`start()` 一次报全）；
- 替换两级粒度：换工具件或换服务件（全体工具件跟着换实现），同一套 D-048 确认卡与回落；
- `SlotMap` 随各服务契约定稿扩项；服务清单开放不封顶。

| 服务                                                   | 提供者                                | 契约定稿时点  |
| ------------------------------------------------------ | ------------------------------------- | ------------- |
| `fs`（文件能力 + 路径围栏）                            | `plugin-fs`（服务件）                 | M4 落码前     |
| `shell`（命令执行能力）                                | `plugin-shell`（服务件）              | M4 落码前     |
| `workingDirectory`（每会话 cwd）                       | 随 fs 批定（plugin-session 或独立件） | M4 落码前     |
| `tasks`（计划 / 任务状态，`plans/` `tasks/` 唯一写者） | `plugin-tasks`（服务件）              | M5 落码前     |
| `subagents`（子代理编排） / `web`（抓取）              | `plugin-subagent` / `plugin-fetch`    | M5 随设计文档 |
| `skills`（技能目录）                                   | `plugin-skills`                       | M6 随设计文档 |
| `commands`                                             | `plugin-commands`（D-025 已是服务）   | 已定          |

## server —— HTTP + SSE 宿主（正式宿主，D-035；定稿 2026-11-17）

> 把引擎端成 HTTP：REST 命令面 + SSE 投影流。不含业务策略（packages.md）；宿主契约四样（hosts.md §3）在此全部落地——配置注入（每会话装配）、InteractionService 实现①（审批卡经 SSE 推给网页、答案经 HTTP 端点收回，web 页是呈现端不是实现者）、事件消费（SSE）、输入投递（prompt / steer / interrupt 端点）。

### 会话注册表（每会话一个 harness 实例，hosts.md §3 定稿语义）

```ts
interface SessionSummary {
  id: string;
  cwd: string;
  title?: string; // meta.json 标题；缺省截取首条用户消息
  updatedAt: number;
  busy: boolean; // 回合进行中（投影 state 提供）
}
// POST /api/sessions { cwd? } → SessionSummary：装配三步 ①③（D-016：官方 preset + settings.plugins
//   enabled 过滤）；②已装插件目录扫描装载随 M4（M3 判据无一条需要，克制不预建机器）。
//   会话内 session 槽由宿主以装饰组合占据：宿主自己的 ServiceDefinition 包住 sessionPlugin，
//   SessionHandle.append 接进投影器（装配权属宿主 D-016；引擎与协议零改动）。
// GET /api/sessions → SessionSummary[]
```

### REST 命令面

```text
POST /api/sessions                          { cwd? }    → SessionSummary   // cwd 传必须绝对路径（400）；建成功自动登记 projects.json（D-060）
GET  /api/sessions                                      → SessionSummary[]
DELETE /api/sessions/:id                                → { ok: true }     // busy → 409 { code: "session_busy" }；删账本目录整棵（data-directory §7）
GET  /api/sessions/:id/snapshot                         → SessionSnapshot（初始渲染与断档重拉共用一出口；长会话 = 尾窗 60——ZCode snapshotTailWindowRows 同档）
GET  /api/sessions/:id/rows?before=&limit=              → RowsPage        // 行翻页（长会话历史：before = rowSeq 排他游标、页首补齐到轮边界、limit 钳 200——D-061）
POST /api/sessions/:id/prompt               { text }    → { queued: boolean; id: string | null }  // D-045 单口：闲直跑 / 忙入队（id = 排队条目）
POST /api/sessions/:id/steer                { entryId } → { ok: boolean }                         // 排队条目"立即发送"升格
POST /api/sessions/:id/interrupt                        → { ok: true }
POST /api/sessions/:id/approvals/:requestId { decision: Decision } → { applied: boolean }        // settle 幂等，先答者赢
GET  /api/sessions/:id/files?path=                      → DirEntry[]   // UI 门面 listDir；只限会话工作区，隐藏项不返
GET  /api/dirs                                          → RegisteredDir[]  // 登记工作目录（data-directory §4 projects.json，可自愈；D-060）
POST /api/dirs                              { cwd }     → { ok: true; dir }  // 登记：绝对路径 + 存在 + 是目录（非法 400）
DELETE /api/dirs/:id                                    → { ok: true }     // busy → 200 { ok: false; blocked: [sessionId] }（批操作语义响应，与删会话 409 双轨——D-060）；
                                                        //   删 projects/<key>/ + checkpoints/<key>/ + 登记条目，盘上工作目录不动（data-directory §7）；未知 id 幂等
GET  /api/dirs/browse?path=                             → DirBrowse        // 全局目录浏览一层（新增目录弹窗数据源；path 缺省 homedir、__drives__ = win32 盘符（非 win32 = / 单项）；
                                                        //   隐藏项不返、只回目录；信任边界 = 回环三件套之上，D-060）
GET  /api/server/info                                   → { version; startedAt; model }
GET  /api/settings                                      → settings.json 内容（凭据永不出现，D-030）
PUT  /api/settings                                      → 程序写 settings.json（data-directory §2.3）
GET  /api/models                                        → 模型清单（models.dev 字典 + 手写覆盖；无密钥）
PUT  /api/credentials/:provider             { key }     → 写 credentials.json（0600）；GET 无对应端点（D-030）
```

```ts
// REST 面 DTO 形状（真源 = @henira/protocol server-events.ts 与 sdk facade——R127 批收口反向核对补全）
interface SettingsData {
  // GET/PUT /api/settings；凭据永不出现（D-030）
  version: 1;
  model?: string;
  ui?: { theme?: string; locale?: string };
}
interface ModelCatalog {
  // GET /api/models（手写 models.json + models.dev 快照，按 id 查）
  providers: Record<string, { baseUrl?: string; models?: string[] }>;
}
interface UiAssets {
  locales: UiAssetLocale[];
  themes: UiAssetTheme[];
} // GET /api/ui-assets（D-059 语言包/主题包清单）
interface UiAssetLocale {
  pluginId: string;
  version: string;
  lang: string;
  url: string;
}
interface UiAssetTheme {
  pluginId: string;
  version: string;
  name: string;
  url: string;
}
interface RegisteredDir {
  // data-directory §4 projects.json 条目（权威工作区列表，可自愈复活）
  id: string; // sha256(canonical cwd) 前 16 位（win32 大小写归一后）
  cwd: string;
  key: string; // §4 命名（--slug60-hash8--，只给人看，查找不靠它）
  displayName: string;
  createdAt: number;
  lastOpenedAt: number;
  openCount: number;
  lastSessionId?: string | null;
}
interface DirBrowseItem {
  name: string;
  path: string;
  type: "drive" | "directory";
}
interface DirBrowse {
  // GET /api/dirs/browse 响应：一层目录内容（懒展开树逐层拉取）
  path: string;
  parent?: string; // 上一层目录（盘符根 = 自身）；盘符列表根（path=__drives__）= undefined
  items: DirBrowseItem[];
}
```

### ServerEvent 词表（server → 客户端的唯一词表；行模型核心与 ZCode 同构，类型实现时落 `@henira/protocol`——纯 DTO，运行时零依赖不变）

```ts
type RowId = string; // 会话内单调唯一；账本事实的确定性函数（回放重建 rowId 不变）

interface UserRow {
  kind: "user";
  rowId: RowId;
  turn: string;
  text: string;
  source: string; // 账本 user/message.source 原样（send / steer / veto / …开放词表，投影器不筛选）
}
interface AssistantRow {
  kind: "assistant";
  rowId: RowId;
  turn: string;
  step: number;
  text: string;
  reasoning?: string;
  streaming: boolean;
  model?: string;
  finishReason?: string;
}
interface ToolRow {
  kind: "tool";
  rowId: RowId;
  turn: string;
  step: number;
  callId: string;
  name: string;
  status: "running" | "done" | "error";
  input: string; // 模型原始 argsText（P3-1）
  output?: { content: string; isError: boolean; durationMs: number };
}
interface ApprovalRow {
  kind: "approval";
  rowId: RowId;
  turn: string;
  step: number;
  requestId: string;
  toolName: string;
  argsSummary?: string;
  status: "pending" | "settled";
  decision?: Decision;
}
interface ErrorRow {
  kind: "error";
  rowId: RowId;
  turn?: string;
  code?: string;
  message: string;
}
type Row = UserRow | AssistantRow | ToolRow | ApprovalRow | ErrorRow;

interface SessionState {
  busy: boolean;
  lastTurnId?: string;
} // turn/start…turn/end 之间 = busy（账本事实派生）
interface SessionSnapshot {
  sessionId: string;
  seq: number;
  rows: Row[]; // 尾部窗口（长会话只含最近段——历史经 /rows 翻页拉取，D-061）
  state: SessionState;
  hasOlder: boolean; // 窗口首行之前还有历史（客户端此后派生 totalRows > rows.length——快照帧只发一次，派生化防过期）
  totalRows: number; // 全序行数（客户端自持：delta 追加自增、前插不变）
}

// 封闭增量语法（4 操作）——结构变化换整行、文本增长用增量；表达不了的结构变化 → 整体快照
type Delta =
  | { op: "row.appended"; row: Row }
  | { op: "row.delta"; rowId: RowId; field: "text" | "reasoning"; text: string } // 流式追加，仅限 streaming 行
  | { op: "row.upserted"; row: Row } // 行整体替换（账本权威落定 / 状态迁移）
  | { op: "state.updated"; state: SessionState }; // 键级整体替换，键内绝不深合并

// SSE 帧信封（GET /api/events；帧序 = connected → 逐会话快照帧 → 增量帧混排）
type ServerFrame =
  | { kind: "connected"; server: { version: string; startedAt: number } }
  | { kind: "snapshot"; sessionId: string; snapshot: SessionSnapshot }
  | { kind: "delta"; sessionId: string; seq: number; delta: Delta };
```

**客户端纪律（断档不猜）**：每会话记 `lastSeq`；增量帧仅当 `seq === lastSeq + 1` 时应用，否则调 snapshot 端点整体替换并重置水位——客户端永不猜中间态。

### 投影器（实现住 `@henira/protocol`——server 与 sdk 双形态共用的事件→行唯一组装处）

- **唯一权威输入 = 会话账本**：历史与断线重建都从账本回放——快照永远从真相重建，实时路径任何漂移都被账本兜底（自愈）；
- 实时两路：①**账本追加**（宿主装饰组合接 `SessionHandle.append`——user / tool / result / approval / turn 生命周期等有身份的事实）；②**总线 loop/event 流式增量**（text / reasoning delta——刻意不落账的打字机碎片，挂到当前流式 assistant 行）；
- 行构造纯函数共享：快照 = 从空投影顺序 apply 全部账本事件；增量 = 逐追加 apply；两路同一套行构造逻辑（一个词表，无第二 reducer）；
- **步边界自愈**：`assistant/message` / `tool/result` / `approval/decided` 落账即 `row.upserted` 整行替换，冲掉流式累积的任何漂移；
- seq 在扇出层按会话编发（快照帧携带当前水位，增量帧 +1 单调）；
- 队列状态不投影（D-045：队列不是对话事实，不进账本）；busy/lastTurnId 由账本 turn/start…turn/end 派生；
- rowId + seq 游标为将来留口：per-session 订阅与 rowsRange 分页是加法不是重构（见文末备考）。

### SSE 传输形状

- 单端点 `GET /api/events`；首帧 `connected`，随后**逐会话快照帧**，之后增量帧按会话混排；
- 心跳：15s 注释帧（传输层）；每订阅者有界队列，溢出断开（客户端重连 = 重拉快照）；
- **volatile 显式声明**（无 Last-Event-ID）：断线期间的帧不补发，重连 = connected + 全量快照——判据②的审批卡重放由快照携带挂起审批行天然达成。

### 回环三件套（D-035，判据⑤）

1. 默认只绑 `127.0.0.1`（对公网 / 局域网开放 = 显式配置）；
2. 随机端口（`HENIRA_PORT` 可覆盖）；
3. Host / Origin 头校验（防恶意网页解析到回环冒充访问本机服务）；`HENIRA_SERVER_TOKEN` 设置时启用 Bearer / `?token=` 校验（可选 token 位）。

> **功能面加法生长（备考）**：行协议当前 5 行类型 / 4 增量操作 / 快照 + 心跳——行模型核心与 ZCode 同构，功能面按各自功能批**往协议加方法**：附件（M4）、插件管理面（M4）、tasks / plans（M5）、subagent（M5）、文件 diff（发布后）。重开条件：分屏工作台 / 超长会话初始渲染需求出现 → 评估 rowsRange 分页；多路复用 / 桌面中继需求出现 → 升级 WS 传输层（行协议词表不动）。

## sdk —— 双形态客户端（D-037 纯 TS 零 React；定稿 2026-11-17）

```ts
// 两形态实现同一门面接口、吐同一 ServerEvent 词表（进程内与远端行为一致，同一测试套件锁定；
// D-034① 所有 web 系宿主说同一协议）。
interface PromptReceipt {
  queued: boolean;
  id: string | null;
} // id = 排队条目 id（忙时）；null = 闲时直跑

interface RowsPage {
  rows: Row[];
  hasOlder: boolean;
} // GET /rows 与 facade.sessionRows 共同载荷（hasOlder=false = 已到顶）

interface HeniraFacade {
  stop(): Promise<void>; // 收尾：runtime 释放会话锁与句柄；client 断开 SSE 连接
  createSession(opts?: { cwd?: string }): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  prompt(sessionId: string, text: string): Promise<PromptReceipt>; // D-045 单口
  steer(sessionId: string, entryId: string): Promise<boolean>;
  interrupt(sessionId: string): Promise<void>;
  settleApproval(sessionId: string, requestId: string, decision: Decision): Promise<boolean>;
  snapshot(sessionId: string): Promise<SessionSnapshot>; // 初始渲染 + 断档重拉（长会话 = 尾窗 60）
  getSettings(): Promise<SettingsData>; // 设置读（settings.json；凭据永不出现，D-030）
  putSettings(patch: {
    model?: string;
    ui?: { theme?: string; locale?: string };
  }): Promise<SettingsData>; // 设置写（程序写，data-directory §2.3）
  listModels(): Promise<ModelCatalog>; // 模型目录（手写覆盖 + models.dev 快照；无密钥）
  putCredential(providerId: string, key: string): Promise<void>; // 密钥写入（credentials.json 0600；无读取面——D-030 永不回读）
  listUiAssets(): Promise<UiAssets>; // 界面资产清单（D-059 语言包/主题包）
  listDir(sessionId: string, dirPath?: string): Promise<DirEntry[]>; // 会话工作区文件列表（只限会话 cwd；隐藏项不返）
  listDirs(): Promise<RegisteredDir[]>; // 登记工作目录（data-directory §4 projects.json；D-060）
  addDir(cwd: string): Promise<RegisteredDir>; // 登记（绝对路径 + 存在 + 是目录；非法抛错）
  deleteDir(id: string): Promise<void>; // 删登记目录（该 cwd 全部会话 + 登记条目；盘上工作目录不动；busy 抛错——D-060）
  browseDirs(path?: string): Promise<DirBrowse>; // 全局目录浏览一层（新增目录弹窗数据源；D-060）
  deleteSession(id: string): Promise<void>; // 删单个会话（账本目录整棵；busy 抛错——D-060）
  events(): AsyncIterable<ServerFrame>; // 全局帧流（connected/快照/增量），
  //   内置断档不猜纪律与重连
}

// 形态一：进程内（cli run / 测试 / 嵌入③）——loadConfig → applyConfig → createHarness 聚合官方
//   preset + 缺省 fail-closed InteractionService（没人应答一律拒；嵌入方可整只替换，packages.md 槽位归属）
function createRuntime(opts: RuntimeOptions): Promise<HeniraFacade>;

// 形态二：远端（Web / 跨进程①）——REST + SSE 解析 + 重连 + 断档重拉；token 可选
function createClient(opts: {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}): HeniraFacade;
```

- 词表类型真源 = `@henira/protocol`（Row / Delta / ServerFrame / SessionSnapshot / SessionState / PromptReceipt）；进程内形态在宿主进程内合成同一词表，不经过 HTTP。

## web —— 正式宿主（可嵌入界面，D-037 / D-038 / D-043；定稿 2026-11-17）

```ts
// 界面从外部注入 client；web 自身的宿主用法 = 注入同源 client 的特例。
// npm 用户 = @henira/sdk（client）+ @henira/web（界面）两包组合；所有 web 系宿主都说 server 协议（D-034①）。
// web 客户端 = 哑渲染器：行 store 应用增量 → 渲染行（事件→UI 组装逻辑在 server 投影器，客户端零 reducer）；
// 流式文本用透明度浮现（DOM 首帧完整、只动画透明度——虚拟滚动测高稳定）。
type Layout = "full" | "center" | "composer" | { parts: WebPartSpec[] }; // 缺省 = 完全体（D-043 第 7 条定稿）
function createWebApp(opts: { client: HeniraFacade; layout?: Layout }): WebApp;
interface WebApp {
  mount(el: HTMLElement): void;
  dispose(): Promise<void>;
}

// ── 官方件承重缝（件 + 会话上下文一起给；M4 批 A 扩定——D-057 slots / D-059 主题字符串 id）──
interface WebPartContext {
  client: HeniraFacade;
  sessionId: string | null; // 当前会话（null = 未选中）
  selectSession(id: string | null): void; // 会话切换（承重缝：SessionList → 宿主单源）
  t: (key: string) => string; // D-050 locale 取字（缺 key fail-loud；D-059 语言包覆盖优先、回落 zh）
  theme: string; // 主题 id：官方 light/dark 或已装主题包名（D-059）
  store: RowStoreLike; // 流式增量从哪来
  host: PluginUiHost; // 宿主门面（13 方法）
  slots: ReadonlyMap<string, readonly SlotPart[]>; // 槽位只读视图（区域 + keyed，D-057）
}
type WebPart = (ctx: WebPartContext) => ReactNode;
```

- **plugin-web-ui = 真插件**（D-043）：id-only 条目进 defaultPreset（无引擎 definition），web 宿主经**公共注册路径**装载其 UI 模块，件经 `UiModuleContext.registerSlot / replaceSlot` 挂载；可整只替换；安全模式（双击 Alt / `?ui=safe`）= 不激活任何 UI 模块、只渲染官方默认组合（web 宿主实现，web-ui 供默认组合）；未装件的槽位**收起**（不渲染不占宽）；
- **编译期出口**（D-043 第 7 条定稿）：`@henira/plugin-web-ui` 同时导出布局 + 官方件（会话列表 / 对话面板 / 输入框 / 审批卡）+ `locales/zh` 字典——web 宿主 import 同版本件，官方件与插件用件同一零件库；**不 eval 插件源码（模块加载，D-021）**；
- **组织约束（D-043 第 8 条，首发生效）**：web 界面自第一行代码起按"可拆组件 + 槽位组合"组织，默认组合只是一种排列；
- **挂载点词表 v1 七个（D-057，2026-11-17 扩定）**：区域级三个（`session.top` / `composer.above` / `sidebar.right`，D-033）＋ 行级四个——`tool.call.view.<工具名>`（工具卡自定义渲染，keyed；官方工具卡默认占用，插件顶替、卸载回落）· `conversation.images`（图片画廊单槽；官方默认件渲染行内图片组）· `turn.tail`（回合尾追加位；registerSlot 多件共存按 order——最终回复的富结果呈现挂此处，追加不改写回复正文）· `sidebar.right.preview.<扩展名>`（侧栏文件预览实现，keyed；插件实现排官方默认前）。**markdown 正文本体不可插**：`renderMarkdown` 保持宿主门面方法，正文渲染永远是官方实现——可插的是容器（工具卡 / 画廊 / 回合尾 / 预览）不是内容；`chat.node` 式整行替换不进 v1（绕过宿主渲染管线，与界面统一视觉系统冲突，有真需求再议）。落码随 M4 界面优化轮（官方默认件 + 缝位），此前行级缝不生效；
- **视觉语言（设计基线）**：
  - 过程纪律 = 项目内 skill `.agents/skills/frontend-design/`（设计计划先行 + 俗套自查 + 截图自审，Anthropic 官方，Apache 2.0）；质量闸 = `.agents/skills/no-ai-design-slop/`（紧凑闸门 + 移除测试，MIT）——web 步开工先 load，写码期间照办；
  - 配色 = CSS 变量 token（暖单色基底 + 语义粉彩点缀思路自 minimalist-ui 蒸馏），**明暗双主题**（theme 切换 = 换变量组，判据③）；嵌入方零样式依赖（token 随组件注入）；M4 批 A 视觉二轮起层次机制 = **前景色派生透明度档**（surface 5% / hover 8% / selected 10% / border 10-16%，color-mix 自 --henira-text——ZCode 行为层参照 2026-11-17），行内淡面用派生档、浮层面板用实色 `--henira-panel`（透明档不作浮层）；运行态 = 文字扫光（`.henira-sweep`）不用转圈 spinner；
  - 布局与部件基线（批 A3，2026-11-17 用户拍板照 ZCode/BC 形态）：**会话列表按工作目录分组**（折叠组头 = caret + 目录名 + 会话数徽标，活跃会话所在组自动展开——BC「目录」/ZCode projects view 行为层）；**设置齿轮住侧栏左下**固定行（ZCode WorkspaceSidebarFooter 行为层）；**输入卡两层**（输入行上 / 工具排下；卡 focus-within 边框变 accent + 底色提亮、内部无独立焦点环），工具排左 = 模型选择器（宿主设置/目录面齐备时渲染，值变更走 putSettings）、右 = 圆形发送钮；**发送/停止语义 = ZCode**（忙+有草稿 = 发送排队、忙+空草稿 = 停止——有字时圆钮恒为发送）；prompt 失败回填草稿 + 行内错误提示（不静默）；**对话列宽三档**（列含内衬默认 808px → 视口 ≥1124px 896 → ≥1540px 1152，对话列与输入 dock 同档——ZCode conversationLayout 672/896/1152 行为层）；**滚动条细圆条**（14px 槽 / thumb 3px 透明边 padding-box 胶囊 / track 透明 / 色=border 派生档，对话列 `scrollbar-gutter: stable`——ZCode styles.css 数值档行为层，实现自家写法）；usage 徽章全 0 不渲染；
  - **长会话渲染（批 A'，2026-11-18——D-061）**：对话时间线虚拟滚动（tanstack react-virtual——ZCode 同款；虚拟单位 = 轮，turn 相同行不拆散；measureElement 动态测高、estimateSize 一屏兜底、overscan 2；会话切换以 sessionId 为内层 React key 重挂换测高缓存）；**bottom-follow**（上滚手势 wheel/touchmove/方向键 capture 解除 + 落点贴底 48px 恢复 + 回底按钮——dsh 显式按钮不取）；**滚顶翻页**（scrollTop < 64 且 hasOlder → `sessionRows(before=窗口首行 rowSeq)` → store 前插合并（只收窗口首行之前 + rowId 去重）+ scrollTop 补位防跳顶；宿主缺 sessionRows = 静态窗口）；**行引用契约**（store：未变行同引用、变化行新对象）+ RowView/SessionRow memo（比较函数拆稳定子集 row+t+host+slots——ctx 本体每渲染新对象不可比）；jsdom 无 ResizeObserver 降级全量渲染；
  - **侧栏目录区（R127，2026-11-18 用户三拍板——D-060）**：分组数据 = 登记工作目录表（`client.listDirs` 驱动——空目录也显示、未登记 cwd 补组、无 cwd 归「其他」）；宿主**五可选方法齐备才渲染目录交互**（缺任一退化纯 cwd 分组）；区头 hover 显「＋目录」（服务端目录树弹窗：此电脑 → 盘符 → 目录逐级懒展开 + 路径输入框双通道，浏览器拿完整路径——BC OpenDirectoryDialog 行为层自家写法）；目录行 hover 显 ＋ = 在该目录新建会话（`createSession({cwd})` 服务端自动登记）；右键组头/会话行出非模态菜单（目录 = 新建会话/复制路径/删除目录；会话 = 删除——busy 项 disabled「运行中，请先中断」）；删除一律模态确认（硬删不可恢复，不学 ZCode 软删两击——BC 确认弹窗 + busy 前置守卫语义）；
  - 图标 = **Phosphor**（`@phosphor-icons/react`，MIT，light/regular 档细线），统一经内部 `Icon` 收口组件使用（库可换：换集只动一处）；品牌标 / favicon 自绘缓建，M3 用文字词标占位；
  - 文案纪律按 frontend-design 的 writing 节（用户视角命名 / 动词一致 / 错误消息具体不道歉）+ D-050（一切用户可见文案经 `t(key)`，缺 key fail-loud）；
  - 界面资产缝（D-059，**设计定稿落码随需**）：插件包可带 `locales/<lang>.json` 语言包（缺 key 回落官方 zh，不 fail-loud）与 `themes/<名>.css` 主题包（变量组追加进设置下拉，官方 light / dark 两档永在不可覆盖）；读者 = 官方界面件；`settings.ui.theme` / `ui.locale` 扩为任意已装 id；安全模式回落官方默认组合；**落码前这两个槽位合法但不被读取**（创建无害、无效果）。

## 插件 UI 宿主门面（web 系宿主实现，D-028）

> **不属于 `SlotMap`，不是引擎协议**；只存在于 web / desktop / 云端网页 / 手机网页。TUI 与 headless 没有插件 UI，不实现该门面。UI 模块与宿主同源，**不是安全边界**（D-021）。

```ts
interface UiModuleContext {
  registerSlot(name: string, component: unknown, opts?: { order?: number }): Disposable; // 追挂（append）；name 按当前宿主词表校验（D-033）；
  //   keyed 词表按前缀识别（tool.call.view. / sidebar.right.preview. 前缀合法、后缀自由，D-057）
  replaceSlot(name: string, component: unknown): Disposable; // 替换该区域 / keyed 槽的官方默认件（D-043 / D-057）；同 key 冲突报错（D-022 同款）；
  //   卸载 / 停用自动回落官方（D-048 同语义）；安全模式下行级缝全部收起回落默认渲染
  host: PluginUiHost;
}

interface PluginUiHost {
  // 对话：发起仍单口 sendPrompt；接收 = 双向事件流（D-042：订阅 opt-in、增量可并、终局必达）
  sendPrompt(text: string): Promise<TurnReceipt>; // ✓ M3
  subscribe(filter: EventFilter, cb: (e: ServerFrame) => void): Disposable; // ✓ M3
  //   EventFilter = { sessionId?: string; types?: string[] } —— 行词表帧流（ServerFrame），
  //   types 过滤 Row["kind"] / 帧类；有界队列背压；与 web 宿主同一词表（断档不猜纪律随帧）
  onTurnFinished(receipt: TurnReceipt, cb: (result: TurnResult) => void): Disposable; // ✓ M3 恰一次（自己发起回合的便捷终局）
  prefill(input: { chip?: string; text: string }): void; // ✓ M3 只回填不发送
  renderMarkdown(text: string, opts?: { streaming?: boolean }): unknown; // ✓ M3 web 宿主返回 React 元素；M4 批 A 起 shiki 高亮（预装 js/ts/python/bash/json，流式中不高亮——opts.streaming 透传，delta 高频重渲下高亮留到回合完成）

  // 数据
  useResource(address: string): ResourceSnapshot; // ⏳ M4 占位（M3 返回 { status: "failed", error: "随 M4（plugin-mcp）落地" }）；React hook 语义：仅 render 期调用
  listPlugins(filter?: { category?: string }): Promise<PluginInfo[]>; // ⏳ M4 占位（M3 返回 []——插件管理面随 M4）
  listDir(path: string): Promise<DirEntry[]>; // ✓ M3（经 server files 端点）；只限会话工作区；隐藏项不返
  listSessionsByCwd(cwd: string): Promise<SessionRef[]>; // ✓ M3（经 GET /api/sessions）

  // 宿主
  getSession(): { sessionId: string; cwd: string } | null; // ✓ M3
  openInExplorer(path: string): Promise<boolean>; // ✓ M3 仅桌面宿主；其他宿主返回 false
  openPlugin(id: string, view?: unknown): void; // ✓ M3 最小实现（聚焦 / 无视图时提示）
  getInitialView(): unknown; // ✓ M3 读后即焚、按插件隔离
}

interface TurnReceipt {
  messageId: string | null; // null = 发送失败
  sessionId: string;
}

type TurnResult =
  | { ok: true; text: string }
  | { ok: false; reason: "interrupted" | "error" | "submit_failed" };

interface ResourceSnapshot {
  status: "loading" | "live" | "failed";
  data?: unknown; // 工具返回文本的 JSON 解析结果
  text?: string; // 原文；JSON 解析失败时保留
  error?: string;
  updatedAt?: number;
}

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  category?: string;
  enabled: boolean;
  broken?: string; // 损坏原因；正常时缺省
  slotKinds?: string[]; // 已识别槽位类型（skills / commands / hooks / mcp / locales / themes / agents / ui）
}

// 插件管理面详情（D-029）：hooks 事件 / 命令、mcp 连接目标必须可见
interface PluginDetail extends PluginInfo {
  path: string; // 版本目录或插件根
  versions: string[]; // 已装版本
  activeVersion: string; // settings 钉的版本，缺省最高
  dataSize?: number; // plugins-data/<id>/ 占用
  uiSlots?: string[]; // ui.slots 声明（D-031）；运行时注册仍是权威
  hooks?: { name: string; event: string; command: string }[];
  mcp?: { name: string; target: string }[]; // command 或 url 的展示串
}

interface DirEntry {
  name: string;
  kind: "file" | "dir";
  size?: number;
  mtime?: number;
}
interface SessionRef {
  id: string;
  cwd: string;
  title?: string;
  updatedAt: number;
}
```

- 官方界面件（会话列表 / 对话面板 / 输入框 / 审批卡…）经**宿主标准件出口**供插件 import（import map，与 react 同口子，D-043）；件与**会话上下文**一起给——连着哪个会话、往哪发、流式增量从哪来（**承重缝已定稿 = `WebPartContext`，见 web 段**）；没装东西的区域槽**收起**（不渲染不占宽）；
- `useResource` 地址格式 `henira-data://<pluginId>/<mcpServer>/<tool>?args=<URL 编码 JSON>`；只允许同一插件 `mcp/` 里声明过的 server（越权 403）；2 秒共享轮询、30 秒超时、200 KB 截断；失败保留上次数据；
- `onTurnFinished` 只收该 UI 模块自己发起那一轮的终稿；终局映射见 [plugins.md](./plugins.md) §4；
- `openInExplorer` 是能力查询：非桌面宿主返回 `false`，UI 模块应自行降级；
- `renderMarkdown` 的返回类型由宿主决定（protocol 不依赖 React）；非 web 宿主不实现 UI 门面。

## loop（官方插件；对外形状 = LoopService）

- **定稿形状全部在 protocol 段**（2026-11-16）：LoopService / LoopEvent / TurnEndReason / QueuedPrompt；
- 中断纪律五条 + 16ms 合并 = 官方 loop 的实现纪律（P6，测试锁定；16ms = 一帧间隔，UI 工程通行做法）；
- 三缝载荷（[loop.md](./loop.md) §4 定稿）：`loop/pre-step` → PreStepValue / `loop/request` → RequestValue / `loop/turn-stopping` → TurnStoppingValue。

---

_实施时：每个包落码前先把本文件对应小节改成"定稿"并补全签名；发现形状问题就地改此文件（改动记入 ADR 仅当涉及原则层）。_
