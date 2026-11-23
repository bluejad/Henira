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
  mcp: McpService; // ✓ 落码（D-064）
  fs: FsService; // ✓ 落码（D-065）
  shell: ShellService; // ✓ 落码（D-065）
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

// 思考参数形态（models.dev reasoning_options，模型级真源）：
//   toggle = 开关两态；effort = 档位枚举（values 为厂商原值，如 low/high/max）；
//   budget = 预算 token（未接——先容错保真，UI 端暂不放开）
type ReasoningOption =
  | { type: "toggle" }
  | { type: "effort"; values: string[] }
  | { type: "budget"; min?: number; max?: number };
// 思维链回传声明（models.dev interleaved）：{ field: "reasoning_content" } 或布尔
type InterleavedSpec = boolean | { field?: string };

/** 模型配置：能力字段由 models.dev 字典预填、手写覆盖（D-040）；不含凭据（D-013②） */
interface ModelConfig {
  provider: string; // 供应商标识（credentials / 字典键）
  model: string; // 模型 id
  baseUrl?: string; // OpenAI 兼容端点（自建 / 代理）
  contextWindow?: number; // 能力字段——引擎内禁止厂商备表（P9-4），只从配置解析
  maxOutputTokens?: number;
  reasoningOptions?: ReasoningOption[]; // 思考参数形态（档位集合数据真源——思考档批 2026-11-19）
  interleaved?: InterleavedSpec; // 思维链回传声明（开思考时历史 assistant 回传 reasoning_content）
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
  __meta?: Record<string, unknown>; // 带外通道（P4）：检查点/引用/图片元数据，loop 分流，不进模型上下文；E5 起工具件亦经此带 per-tool 卡 UI 元数据（kind 开放集 → 账本 tool/result.meta → ToolRowOutput.meta；出口尺寸闸 256KB）
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
// 测试与 examples 用 mock 自动应答）。R184 起两类交互：approval（工具执行前裁决）与
// question（模型执行中提问——专用工具 ask_user，答案即工具结果的来源；与审批分离：权限请求
// 是闭合裁决，澄清表单是自由输入，两种产品概念）。
interface QuestionOption {
  label: string; // 1–5 词
  description?: string;
}
interface QuestionSpec {
  id: string;
  question: string; // 完整问句
  header?: string; // chip 短标签（≤12 字符）
  options?: QuestionOption[]; // 2–4 个；缺省 = 纯自由文本题
  multiSelect?: boolean;
}
interface QuestionAnswer {
  id: string;
  selected: string[]; // 空数组 = 明确跳过
  custom?: string; // 自定义输入（模型不得自带 Other——客户端恒提供；≤2000 字符、码点计长，UI/REST/引擎/账本同源上限——R186）
}

type InteractionRequest =
  | { kind: 'approval'; requestId: string; toolName: string; args: unknown; reason?: string }
  | { kind: 'question'; requestId: string; toolName: string; questions: QuestionSpec[] };

type InteractionAnswer =
  | { kind: 'approval'; requestId: string; decision: Decision; scope?: 'session' }
  | { kind: 'question'; requestId: string; answers: QuestionAnswer[] }
  | { kind: 'question'; requestId: string; cancelled: true };

interface InteractionService {
  ask(req: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer>;
  settle(requestId: string, answer: InteractionAnswer): boolean; // 幂等，先答者赢；种类必须与挂起请求一致
  knows?(requestId: string): boolean; // 该 id 曾为本服务所知（挂起或已答）——settle false 后区分「已答过」与「从不存在」（REST 对后者 404，R175）；可选，缺省实现可缺
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
  //   忙时入队（queue.json 持久化，重启恢复，D-045）；steer=true 忙时直接以插话身份入队
  pending(): QueuedPrompt[]; // 当前排队条目快照（排队卡 UI 数据源；投影态非账本事实）
  steer(entryId: string): Promise<boolean>; // 队列条目"插话"升格（不打断当前，下一 step 边界进场）
  promote(entryId: string): Promise<boolean>; // 立即发送（抢占式）：停止当前回合 + 以该条开新回合（模型/思考随行）；剩余条目原位留守、回合末自动续冲、不产生冻结态；不存在 false
  remove(entryId: string): Promise<boolean>; // 删除排队条目（排队卡行级操作）；不存在 false
  paused(): boolean; // 队列是否处于「中断冻结」态（UI 暂停横幅判据；投影态非账本事实）
  resume(): Promise<boolean>; // 恢复冻结队列冲刷：取队头开新回合；闲时才可，无事可做 false
  interrupt(signal?: AbortSignal): Promise<void>; // 中止当前回合（turn/end{aborted, cause:'user'}；队列非空 = 冻结不冲刷）
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
export const defaultPreset: PluginEntry[];   // 官方 23 个插件；想基于默认改 = import 后 spread,
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
//   { version, model?, plugins?: { <id>: { enabled?, version?, options? } },
//     ui?: { theme?, locale?, preview?: { file?: "panel"|"modal", image?: "panel"|"modal" } } }
//   ui.preview = 预览打开方式（R188）：缺省 file=panel（右侧）、image=modal（弹窗）；
//   按内容类型各自可设，深合并（只改 image 不丢 file）——设置 → 外观页两行分段控件。
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
- ToolResult 带 `__` 前缀带外通道（P4）：`__meta` 等由 loop 路由，不进模型上下文；E5 起工具件亦经此带 per-tool 卡 UI 元数据（kind 开放集，账本 tool/result.meta → ToolRowOutput.meta，出口尺寸闸 256KB）。

## ask-user（官方插件；R184）

> 机制照 dsh 的 `ask_user_question` 行为层：普通工具调用，execute 一直 await 到用户答复——**答复即工具结果**；与审批通道分离（权限请求是闭合裁决，澄清表单是自由输入，复用会压扁语义）。卡片语义照 ZCode：无预选 / 自动自定义输入末位 / 逐题分页 / 首题 Esc 取消、后题回退 / IME 组合不误提交。

- 工具 `ask_user`：`isConcurrencySafe: true`（无副作用，且必须绕过审批默认链——否则提问前先弹审批卡）。入参 `questions` 1–4（`id` / `question` / `header`≤12 字符 / `options` 2–4 `{label, description?}` / `multiSelect`）；运行时校验 id 与 option label 唯一。
- 挂起/收答：append `question/asked` → `interaction.ask({ kind:"question" })` → append `question/settled`。用户取消 / 回合 abort / 交互服务缺席 → settled `cancelled` + 工具 Error 结果，**回合继续**（模型可自行判断或重问）；无墙钟自动收口——重启由 session repair 补 `question/settled{invalidated}`。
- 结果：模型可见文本逐题「问题 → 答案（跳过）」；`__meta = { kind:"ask_user", questions, answers?, cancelled? }`（痕迹卡数据源，不进模型上下文）。
- 装配：`plugin-ask-user` 进 defaultPreset（可停用、不可卸载）；inject `session` / `tools` / `interaction`。

## 能力服务与注入装载（D-049）

> 机制骨架已定（kernel `ServiceDefinition.inject` + `start()` 静态检查）；本节定**能力服务**的规矩与装载语义。各服务契约小节落码前在本文件定稿（活文件），**此处只记名与归属，不写实现**。

- **官方插件对外能力一律服务**（单消费者亦然，无第二种写法）；跨包共享必经服务；第三方插件同权提供与消费；
- 注入声明在引擎模块导出：`export const inject = ['fs', …]`；manifest 不复写（单一事实源）；
- **装载语义两级**：装配层预检——声明注入的服务无提供者 → 该引擎件不装载 + 告警（不挡其他插件）；进到 kernel 的 inject 静态检查是最后防线（`start()` 一次报全）；
- 替换两级粒度：换工具件或换服务件（全体工具件跟着换实现），同一套 D-048 确认卡与回落；
- `SlotMap` 随各服务契约定稿扩项；服务清单开放不封顶。

| 服务                                                   | 提供者                                                                                                                                                   | 契约定稿时点          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `fs`（文件能力 + 路径围栏）                            | `plugin-fs`（服务件）                                                                                                                                    | ✓ 已定（D-065，批 B） |
| `shell`（命令执行能力）                                | `plugin-shell`（服务件）                                                                                                                                 | ✓ 已定（D-065，批 B） |
| `workingDirectory`（每会话 cwd）                       | **不设独立件（D-065）**——cwd 链路已通（SessionHeader → ConfigService → ToolContext），fs / shell 服务 inject config 取 cwd；shell cwd 持久化需求出现再立 | —                     |
| `tasks`（计划 / 任务状态，`plans/` `tasks/` 唯一写者） | `plugin-tasks`（服务件）                                                                                                                                 | M5 落码前             |
| `subagents`（子代理编排） / `web`（抓取）              | `plugin-subagent` / `plugin-fetch`                                                                                                                       | M5 随设计文档         |
| `skills`（技能目录）                                   | `plugin-skills`                                                                                                                                          | M6 随设计文档         |
| `commands`                                             | `plugin-commands`（D-025 已是服务）                                                                                                                      | 已定                  |
| `mcp`（MCP 连接与工具转接）                            | `plugin-mcp`（服务件，D-064）                                                                                                                            | 已定（C5 批）         |

## mcp（官方插件；对外形状 = McpService，D-064）

> 契约定稿（2026-11-19，C5 批）：plugin-mcp 按插件包 `mcp/*.json` 声明连接外部 MCP server（stdio / streamable HTTP，官方 `@modelcontextprotocol` SDK），把其工具转接进 tools 注册表。服务形状刻意最小——useResource 数据泵（plugins.md §4）的宿主单跳落到这里；资源 / 提示模板 / 采样等其余 MCP 能力不进 v1（50-open 挂账）。

```ts
interface McpService {
  /** 调一个已连接 server 的工具（useResource 数据泵单跳）；server 未声明 / 未连接 → 抛错 */
  call(
    target: { pluginId: string; server: string; tool: string },
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
}
interface McpCallResult {
  content: string; // text 内容按序 join；image / audio 等非文本项以占位行计入（blob 落盘挂账）
  isError?: boolean; // MCP isError 结果原样透传
}
```

- **连接语义**：会话装配时异步连接（不阻塞开屏）；连上 → `tools/list` → 注册进注册表；`list_changed` → 重列、**整代原子换注册**（失败保旧代；sync 单队列串行防交错）；有界退避（1s × 2，3 次）耗尽 → 注销该 server 全部工具 + 告警，新会话重来；stdio 死亡不自动 respawn（新会话重连，同生态惯例）；
- **工具命名**：模型可见名 `mcp__<server>__<tool>`；非法字符 → `_`、超 64 截断并追加短哈希防塌缩；server 名跨插件按 D-032 链去重（同层 id 字典序赢 + 告警）；同 server 内规范化后撞名 → 后者跳过 + 告警；
- **审批**：MCP 工具 `isConcurrencySafe` 缺省 false → 无规则命中走 `approval/request` 弹卡（外部 server 默认过目；D-039 判定链不变，无 MCP 特例）；
- **凭据与展开（D-030）**：`mcp/*.json` 的 env / headers 值支持 `${credential:名}` 引用——宿主从 `config/credentials.json` 展开后**内存传递**；缺失 → 该 server 跳过 + 告警、**不 spawn**（fail-closed）；`${HENIRA_PLUGIN_ROOT}` / `${HENIRA_PROJECT_DIR}` 与生态别名（plugins.md §4 模板变量）在 command / args / env / url / headers 展开；command 为含路径分隔符的相对路径时相对插件版本目录解析，裸命令名走 PATH；
- **stdio 环境**：父环境清洗（剔名称匹配 `KEY|PASSWORD|SECRET|TOKEN` 与 `HENIRA_*` 的变量）后合并声明 env（防环境侧信道，声明 env 显式项总赢）；
- **密钥不出服务**：plugin-mcp 不接触 credentials.json，不回显任何密钥；`type: "sse"` 声明 → 跳过 + 告警（挂账）。

## fs / shell（官方插件；对外形状 = FsService / ShellService，D-065）

> 契约定稿（2026-11-20，批 B）：能力服务化（D-049）的首两族——文件能力 + 路径围栏住 `fs` 服务（**围栏跟着能力走，注入者皆受**），命令执行能力住 `shell` 服务；工具件（fs-tools / fs-search / shell-tools）只是适配器，格式化归工具件、能力与守卫归服务。**第二实现思想实验**（D-049 契约要求）：FsService 进出全为字符串 / 结构化数据、零 Node 句柄零流 → 沙箱 fs 同槽替换时围栏从「区外问」变硬 containment，工具件与注入者零改动；ShellService 契约零 child_process 类型、env 显式 map、结果纯数据 → 远程 shell（SSH）同形可换。后台任务 / 持久会话属实现细节，不进 v1 契约。

```ts
// ── fs 槽（plugin-fs 提供；工具件与第三方件注入同一份）──────────────
/** 围栏放行通道：区外访问经判定链问（floor:"ask" 抬高默认放行层）——服务不绕链直问 interaction */
interface FsGate {
  /** 调用方工具名与原始 args（区外弹卡 PermissionRequest 用） */
  tool: string;
  args?: unknown;
  signal?: AbortSignal;
  requestPermission(req: PermissionRequest, opts?: ApprovalOptions): Promise<Decision>;
}

interface FsService {
  /** 解析相对路径（相对会话 cwd）+ 区内 / 区外判定（词法；win32 大小写不敏感；~ 展开到 home） */
  resolve(path: string): { absolute: string; inside: boolean };
  read(
    path: string,
    gate: FsGate,
    opts?: { offset?: number; limit?: number },
  ): Promise<FsReadResult>;
  /** 已存在的文件必须先 read（未见 / stale / 部分读三类守卫住服务层）；新建自动建父目录 */
  write(path: string, content: string, gate: FsGate): Promise<{ created: boolean; path: string }>;
  /** old_string 唯一性强制（>1 命中且未 replace_all → 抛错带计数）；LF 归一匹配、保留原换行符；
   *  混合换行文件只受理单行编辑（多行 old 报 mixed_line_endings） */
  edit(
    path: string,
    op: { old: string; new: string; replaceAll?: boolean },
    gate: FsGate,
  ): Promise<{ replacements: number; path: string }>;
  /** 跳 .git/.hg/.svn/node_modules；上限 100、mtime 降序、绝对路径返回、total 恒为命中全量 */
  glob(pattern: string, gate: FsGate, opts?: { path?: string }): Promise<FsGlobResult>;
  /** JS 引擎（零外部二进制）；path 可为目录或单文件；output_mode 三态；跳二进制与 >10MB 文件 */
  grep(pattern: string, gate: FsGate, opts?: FsGrepOptions): Promise<FsGrepResult>;
}
```

- **围栏语义（唯一强制点在服务层）**：区内直行——判定链照常（凭据 / 灾难硬拒不受影响，读类走默认放行层）；区外 → 服务调 `gate.requestPermission(req, { floor: "ask" })`，放行才继续、否则抛错。**区外 write / edit 会见两张卡**（工具链卡 + 区外卡）——有意为之：区外是显式二次确认，fail-closed 优先于卡片数量；词法围栏是给模型的护栏不是对抗恶意进程的沙箱（审批链才是闸；symlink 真实归属检查挂账）；
- **读态守卫**：服务按会话记忆读过的文件（mtime 快照）——write / edit 已存在文件前必须 read；文件在读后被外部改动（mtime 变）→ 拒并提示重读；部分读（从中间起读 / 未读到尾 / 字节帽截断）不满足覆盖条件——显式 limit 若实际覆盖到文件尾不算部分读；write / edit 成功后刷新读态（模型无需回读）；
- **read**：默认 / 上限 2000 行、每行 2000 字符截尾、选区 50KB、**整文件 >50MB 先帽后读直接拒**；二进制（NUL 探测）→ 报错；空文件提示；截断尾注带 `offset` 续读提示；
- **grep/glob 参数与帽**：见 D-065 决定 2/3；grep 的 `path` 可为目录或单个文件；regex 非法 → 报错（建议转义）；`No matches found` / `No files found` 空态固定英文。

```ts
// ── shell 槽（plugin-shell 提供）──────────────────────────────────
interface ShellRunSpec {
  command: string;
  shell: "bash" | "powershell";
  cwd?: string; // 缺省 = 会话 cwd；目录不存在 → 抛错
  timeout?: number; // ms；默认 120_000、上限 600_000（钳制）
  env?: Record<string, string>; // 显式覆盖（本地实现合并父环境之上；远程实现原样传递）
}
interface ShellRunResult {
  exitCode: number | null; // null = 被信号杀死
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
  signal?: string;
  stdoutTruncated?: boolean; // 服务层每流尾部保留 20KB——丢弃头部时置位
  stderrTruncated?: boolean;
}
interface ShellService {
  run(spec: ShellRunSpec, gate: FsGate): Promise<ShellRunResult>;
}
```

- **每次新 spawn**（无持久会话、无 cwd 持久化——挂账）；stdout / stderr 分开捕获（渲染分节归工具件）；
- **超时 / 中断都杀进程树**：win32 `taskkill /T /F`；posix detached + 负 pid（TERM → 3s → KILL——吞 SIGTERM 的进程不会让调用挂死）；超时结果 `timedOut: true` + 已有输出照返；
- **非零退出码不是 isError**：`[exit code: N]` 计入内容由模型判读；spawn 级失败（命令不存在等）→ isError；
- **env**：父环境 + 输出净化覆盖（`NO_COLOR/TERM/PAGER/GIT_PAGER`）+ `HENIRA_PROJECT_DIR`，spec.env 显式项总赢；**不洗敏感名**——shell 以用户身份跑（审批链是闸），与 MCP stdio 的清洗（防外部 server 侧信道）是两个场景。

## server —— HTTP + SSE 宿主（正式宿主，D-035；定稿 2026-11-17）

> 把引擎端成 HTTP：REST 命令面 + SSE 投影流。不含业务策略（packages.md）；宿主契约四样（hosts.md §3）在此全部落地——配置注入（每会话装配）、InteractionService 实现①（审批卡经 SSE 推给网页、答案经 HTTP 端点收回，web 页是呈现端不是实现者）、事件消费（SSE）、输入投递（prompt / steer / interrupt 端点）。

### 会话注册表（每会话一个 harness 实例，hosts.md §3 定稿语义）

```ts
interface SessionSummary {
  id: string;
  cwd: string;
  title?: string; // 首条非 breaker 用户消息派生（R188 已实装；列表/快照/SDK 三路同源，缺省 = 尚无用户消息）
  updatedAt: number; // 活动时间 = 账本文件 mtime（R189：追加即回顶列表；非目录 mtime）
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
GET  /api/sessions                                      → SessionSummary[] // title?: string —— 首条非 breaker 用户消息派生（R188；列表/左栏/header 同一真源）
DELETE /api/sessions/:id                                → { ok: true }     // busy → 409 { code: "session_busy" }；删账本目录整棵（data-directory §7）
GET  /api/sessions/:id/snapshot                         → SessionSnapshot（初始渲染与断档重拉共用一出口；长会话 = 尾窗 60——ZCode snapshotTailWindowRows 同档；title 随快照下发——R188）
GET  /api/sessions/:id/rows?before=&limit=              → RowsPage        // 行翻页（长会话历史：before = rowSeq 排他游标、页首补齐到轮边界、limit 钳 200——D-061）
POST /api/sessions/:id/prompt               { text, steer?, modelId?, reasoningEffort? }  → { queued: boolean; id: string | null }  // D-045 单口：闲直跑 / 忙入队（id = 排队条目）；steer=true 忙时直插（E1 发送模式 Ctrl+Enter）；模型/思考按次覆盖（每次提问绑定，骨架批）
POST /api/sessions/:id/steer                { entryId } → { ok: boolean }                         // 排队条目"立即发送"升格
DELETE /api/sessions/:id/queue/:entryId     → { ok } | 404                                        // 排队条目删除（E1 排队卡行级操作）
POST /api/sessions/:id/queue/resume                     → { ok: boolean }                         // 恢复中断冻结的队列冲刷（取队头开新回合；无事可做 ok:false）
POST /api/sessions/:id/queue/:entryId/promote           → { ok } | 404                            // 立即发送（抢占式）：停止当前回合并以该条开新回合（排队卡行级操作）
POST /api/sessions/:id/interrupt                        → { ok: true }
POST /api/sessions/:id/fork                 { atSeq? }  → { ok: true; id }   // 轮尾分叉（E4；session.md §6）：按账本 seq 前缀复制出新会话并装配入册，返回子会话 id（parentSession 指源；半回合切点补写 turn/end{forked}）；atSeq 缺省 = 复制到最新；越界切点 400
POST /api/sessions/:id/approvals/:requestId { decision: Decision, scope?: "session" } → { applied: boolean }  // settle 幂等，先答者赢（重复答 applied:false）；scope:'session' = 会话级允许（E6：decided{scope} 落账 → 同工具后续调用免 ask）；requestId 从不存在（服务重启收口/重启前死亡）→ 404 { error: "approval not found" }（R175——前端把 404 当已解决收卡不回滚）
POST /api/sessions/:id/questions/:requestId { answers: [{ id, selected: string[], custom? }] } | { cancelled: true } → { applied: boolean }  // 提问收答（R184）：answers 逐题（空 selected = 跳过）；cancelled = 取消整个请求（工具收 Error 结果、回合继续）；幂等先答者赢；body 不合规 400；custom 超 2000 字符（码点）400（R186）；requestId 从不存在 → 404 { error: "question not found" }（前端同款把 404 当已解决）
GET  /api/sessions/:id/files?path=                      → DirEntry[]   // UI 门面 listDir；只限会话工作区，隐藏项不返
GET  /api/sessions/:id/file?path=                       → WorkspaceFileContent  // 工作区文件读取（R190 预览缝）：相对 cwd 或 cwd 内绝对路径；cwd 围栏 + realpath 复核；文本 utf8（1 MiB 截断 truncated）、二进制 base64（超 1 MiB 400）；只读，正文不落盘
//  写路径懒挂载（重启续聊，✓ 2026-11-18）：prompt / steer / interrupt / approvals / files 对磁盘历史会话
//  （本进程未装配）首次调用按需重建运行体（定位目录 + 账本头核验 + 装配 + 投影从账本补账）——重启后不再
//  只读（读路径磁盘兜底照旧）；未知 id 仍 404；另一活进程持 session.lock → 409 { code: "session_busy" }
GET  /api/sessions/:id/ui-state                         → SessionUiState  // 界面绑定态文档（草稿 / 面板宽度 / 右栏 tab 引用；web 宿主所有形状，服务端不解释内容；折叠组不入档——本地态；D-063，✓ 界面持久化批）
PUT  /api/sessions/:id/ui-state             { doc }     → { ok: true }    // 整份原子重写（tmp+rename），后写者赢；64KB 上限（D-063）
GET  /api/dirs                                          → RegisteredDir[]  // 登记工作目录（data-directory §4 projects.json，可自愈；D-060）
POST /api/dirs                              { cwd }     → { ok: true; dir }  // 登记：绝对路径 + 存在 + 是目录（非法 400）
DELETE /api/dirs/:id                                    → { ok: true }     // busy → 200 { ok: false; blocked: [sessionId] }（批操作语义响应，与删会话 409 双轨——D-060）；
                                                        //   删 projects/<key>/ + checkpoints/<key>/ + 登记条目，盘上工作目录不动（data-directory §7）；未知 id 幂等；
                                                        //   fs 失败（Windows 目录被进程占用等）→ 500 { error: "delete failed"; detail }（rm 内置重试后仍败才返；登记条目未删可重试——D-060 后续）
GET  /api/dirs/browse?path=                             → DirBrowse        // 全局目录浏览一层（新增目录弹窗数据源；path 缺省 homedir、__drives__ = win32 盘符（非 win32 = / 单项）；
                                                        //   隐藏项不返、只回目录；信任边界 = 回环三件套之上，D-060）
GET  /api/server/info                                   → { version; startedAt; model }
GET  /api/settings                                      → settings.json 内容（凭据永不出现，D-030）
PUT  /api/settings                                      → 程序写 settings.json（data-directory §2.3；ui.preview 深合并——R188）
GET  /api/models                                        → 选择器清单（闸门分档——已知厂商 key+baseUrl 齐备、自定义厂商 baseUrl；断开即摘出清单；开关关的模型过滤；条目带显示名/上下文窗/视觉·思考徽章位/**reasoningOptions 档位真源**；无密钥——收敛批+思考档批 2026-11-19）
PUT  /api/credentials/:provider             { key }     → 写 credentials.json（0600）；GET 无对应端点（D-030）
// ── 模型管理面（✓ 模型管理批 2026-11-19）──
GET  /api/providers                                     → 管理分组（连接态/显示名/模型条目含开关+上下文窗；无密钥——D-030；数据全量含未连接，**主列表 UI 只渲染已连接组**——未连接不进组列表、连接态只在「＋ 连接提供商」挑选页显示，2026-11-19）
GET  /api/models.presets                                → 厂商选择页预设全表（config-loader 字典：快照+缓存；无密钥）
POST /api/models.presets/refresh                        → { ok }        // 在线刷新目录（models.dev；失败保留快照/缓存现状）
PUT  /api/providers/:id/connect             { key }     → 连接已知厂商（key 必填——无 env 兜底；D-030；缺 baseUrl 从目录快照 endpoint 自动种——连接即可跑，用户永不手写地址，收敛批 2026-11-19）
DELETE /api/providers/:id                               → 断开（credentials.json 摘键；models.json **分档**——已知厂商只清 hidden 显隐，baseUrl/label 承重配置永不碰；自定义厂商整条删；幂等——2026-11-19 教训：整条删毁过用户手写地址）
PUT  /api/providers/:id/models/:model/enabled { enabled } → 开关显隐（models.json hidden 清单；开=移出，关=加入）
POST /api/providers/custom                  { label?, baseUrl, key?, models[] } → 自定义 OpenAI 兼容厂商（显式清单；请求头不收——引擎不消费不造假配置）
GET  /api/ui-assets                                     → UiAssets        // 界面资产清单（D-059 语言包/主题包；扫描已装插件包）
GET  /api/ui-assets/:id/:version/:kind/:file → 资产文件伺服            // kind = locale | theme；SAFE_SEG + startsWith 双防线（D-059）
GET  /api/ui-assets/:id/:version/file/*path → 插件文件伺服              // 批 C：ui 入口 + 同目录相对依赖；逐段 SAFE_SEG + startsWith；MIME 表白名单；html/svg 带 CSP sandbox（§4 安全规则）
GET  /api/ui-shims/:file                                 → ESM shim        // 批 C：react / jsx-runtime / react-dom-client 三个 shim（从 window.__HENIRA_UI__ 表 re-export 宿主唯一实例；import map 指到这里）
GET  /api/plugins                                        → { plugins: PluginState[]; fingerprint: string }  // 批 C：插件清单（官方五件 + 目录件；状态模型见 plugins.md §5；指纹供 UI 2s 轮询重装）；无密钥（D-030）
POST /api/plugins/:id/confirm               { version }  → { ok: true }    // 确认卡放行（engine 件首次生效/版本升级；写 settings.plugins.<id>.confirmedVersion；未确认 = 不装载）
PUT  /api/plugins/:id/enabled               { enabled }  → { ok: true }    // 启停（settings.plugins.<id>.enabled；缺 key = 启用；官方五件拒绝 404）
PUT  /api/plugins/:id/version               { version }  → { ok: true }    // 版本钉（盘上须存在；官方件拒绝；新会话生效）
DELETE /api/plugins/:id                                  → { ok: true }    // 卸载（删 plugins/<id> 整目录；plugins-data 保留；官方件 403；不存在 404）
POST /api/plugins/:id/confirm-mcp                        → { ok: true }    // C5：MCP 变更确认放行（D-030：首次连接或 mcp/*.json 变更后须确认；写 settings.plugins.<id>.mcpFingerprint；未确认 = 不 spawn、工具不进注册表）
POST /api/sessions/:id/resource             { pluginId, address } → ResourceReply // C5：useResource 数据泵单跳（address = henira-data://<pluginId>/<server>/<tool>?args=<URL 编码 JSON>；所有权闸：pluginId 与声明双校验，越权 403；30s 超时、200 × 1024 字符截断；失败保上次数据由宿主泵负责——plugins.md §4）
GET  /api/ui-state                                       → GlobalUiState   // 全局"上次选中"（backing state/ui.json；启动还原：在列表则选中，否则回落最新更新 / 新建；D-063，✓ 界面持久化批）
PUT  /api/ui-state                           { doc }     → { ok: true }    // 选中变化时写（D-063）
GET  /api/events                                        → SSE 帧流        // 唯一订阅端点（帧序/心跳/有界队列见下「SSE 传输形状」）
```

```ts
// REST 面 DTO 形状（真源 = @henira/protocol server-events.ts 与 sdk facade——R127 批收口反向核对补全）
interface SettingsData {
  // GET/PUT /api/settings；凭据永不出现（D-030）
  version: 1;
  model?: string;
  ui?: { theme?: string; locale?: string; preview?: PreviewOpenSettings };
}
interface CatalogModel {
  // 选择器单模型条目（收敛批 2026-11-19 条目化——裸 string id 退场）
  id: string;
  name?: string; // 显示名（快照 name）
  contextWindow?: number;
  vision?: boolean; // 图片输入徽章「视觉」（models.dev modalities 派生）
  reasoning?: boolean; // 原生思考徽章（显示用）
  reasoningOptions?: ReasoningOption[]; // 思考档位集合真源（models.dev reasoning_options：
  //   toggle=关/开两档、effort=values 档位映射四档子集——思考档批 2026-11-19；UI 数据驱动）
}
interface ModelCatalog {
  // GET /api/models（选择器清单；闸门分档——已知厂商 key+baseUrl 齐备、自定义厂商 baseUrl；
  //   开关关的模型过滤；断开（摘 key）即从清单消失）
  providers: Record<
    string,
    { name?: string; baseUrl?: string; reasoning?: ReasoningCapability; models?: CatalogModel[] }
  >; // reasoning = 思考参数形状族（合同层形状表：effort/thinking/enable/template-enable/
  //   thinking-effort/none——只管「参数怎么写进请求体」；档位有无看模型条目 reasoningOptions）
}
interface ProviderCatalogEntry {
  // GET /api/providers（管理分组——模型管理页主视图数据源）
  id: string;
  name?: string; // label（用户显式命名）?? 快照 name ?? id
  baseUrl?: string;
  reasoning?: ReasoningCapability;
  connected: boolean; // credentials.json 在册；自定义厂商无 key 也算连接（目录条目即在册）
  models: Array<{
    id: string;
    name?: string; // 模型 label ?? 快照 name
    contextWindow?: number;
    vision?: boolean; // 模型级徽章（管理行 meta；收敛批透传）
    reasoning?: boolean;
    enabled: boolean; // models.json hidden 清单——开 = 不在清单
  }>;
}
interface ModelPresets {
  // GET /api/models.presets（厂商选择页——快照+缓存字典视图）
  presets: Record<
    string,
    { name?: string; models: Record<string, { name?: string; contextWindow?: number }> }
  >;
}
interface CustomProviderInput {
  // POST /api/providers/custom 入参（自定义 OpenAI 兼容厂商）
  label?: string;
  baseUrl: string;
  key?: string; // 可选——无 key 也算连接（既有语义）
  models: Array<{ model: string; label?: string }>; // 显式清单；请求头不收——引擎不消费不造假配置
}
interface UiAssets {
  locales: UiAssetLocale[];
  themes: UiAssetTheme[];
} // GET /api/ui-assets（D-059 语言包/主题包清单）
interface GlobalUiState {
  lastSessionId: string | null; // 全局"上次选中"（state/ui.json，运行态不进 settings.json；D-063）
}
interface SessionUiState {
  // 每会话界面绑定态文档——形状归 web 宿主，服务端不解释内容（整份收发 + 64KB 上限）；
  // 常用字段可选 + 开放索引签名随宿主加法生长；删会话随整树走（D-063；
  //   真源 = @henira/protocol server-events.ts，落码·界面持久化批；rightPanel/rightWidth
  //   已随三栏骨架批接线）
  // 折叠组不入档（用户裁决 2026-11-18）：刷新/重启只展开选中会话所在组、其余收起，平时折叠纯本地
  draft?: string;
  layout?: { leftWidth?: number; rightWidth?: number };
  rightPanel?: {
    open?: boolean;
    active?: string | null;
    // kind = blank | preview-file | preview-image | 插件 tab；preview-* 只存引用
    // （path+rowId 或 URL src+alt），正文由行数据/地址现场解析（R188）；
    // data: 内联图 tab 只活在本页内存（内容不是引用，宿主落盘前剔除——R189）
    tabs?: Array<{
      id: string;
      kind: string;
      title?: string;
      path?: string;
      rowId?: string;
      src?: string;
      alt?: string;
    }>;
  };
  model?: string; // 会话级模型记忆（composer 回填；权威在每次请求携带，引擎无会话态——骨架批）
  reasoningEffort?: ReasoningEffort; // 会话级思考档记忆（同上）
  [key: string]: unknown;
}
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
//   rowId 形态：`a:{turn}:{step}` / `t:{turn}:{step}:{callId}` / `u:{seq}` / `p:{requestId}` / `e:{seq}`

interface UserRow {
  kind: "user";
  rowId: RowId;
  rowSeq: number; // 产生该行的账本事件 seq（翻页游标基座——会话内单调，同事件多行同 seq）
  turn: string;
  text: string;
  source: string; // 账本 user/message.source 原样（send / steer / veto / …开放词表，投影器不筛选）
  time?: number; // 消息时刻（账本 user/message 事件 time，epoch ms——用户行操作行时间戳，E4）
}
interface AssistantRow {
  kind: "assistant";
  rowId: RowId;
  rowSeq: number;
  turn: string;
  step: number;
  text: string;
  reasoning?: string;
  streaming: boolean; // true = 流式中（后续还有 row.delta / row.upserted）；false = 账本权威已落定
  model?: string;
  finishReason?: string;
  usage?: TokenUsage; // 步级用量（step/end 落账投影；词表同 llm 槽位 TokenUsage）
  interrupted?: boolean; // true = 该步被中断掐停（turn/end{reason:"aborted"|"interrupted"} 投影；部分文本定格，无权威落定）。回合从未产生流式碎片时合成零文本中断行（rowId 从账本事实派生，回放同形；只进投影不落账）；重放路径对死亡步落定行（finishReason:"tool-calls"）补标——"stop" 权威完成不诬
  interruptedKind?: "restart"; // 中断来源分型（R175）：restart = turn/end{reason:"interrupted"}（开档/启动收口补写——进程死亡掐停），徽章「已中断（服务重启）」；aborted（用户中止）不带此字段
  reasoningEffort?: ReasoningEffort; // 本步实际生效思考档（request/header.params 投影——行上档位可见性，骨架批）
  time?: number; // 消息时刻（账本 assistant/message 事件 time，epoch ms——轮尾操作行时间戳，E4；流式行与中止冻结行无权威落定故缺此字段）
}
interface ToolRowOutput {
  content: string;
  isError: boolean;
  durationMs: number;
  truncated?: { path: string; preview: string }; // 输出超限截断（preview 供 UI 展示头部，path 指完整输出落盘文件）
  meta?: Record<string, unknown>; // 工具结果带外元数据（ToolResult.__meta 原样透传，账本 tool/result.meta 同源；不进模型上下文——E5；出口尺寸闸：序列化超 256KB 或不可序列化整体丢弃）
}
interface ToolRow {
  kind: "tool";
  rowId: RowId;
  rowSeq: number;
  turn: string;
  step: number;
  callId: string;
  name: string;
  status: "running" | "done" | "error";
  input: string; // 模型原始 argsText（P3-1）
  output?: ToolRowOutput;
}
// output.meta 的 kind 标记（开放集——第三方工具可带自己的 kind，官方卡不认识就回落通用渲染）：
// "shell"（exitCode/stdout/stderr/timedOut/signal/stdoutTruncated/stderrTruncated——终端卡分色、
//   退出码徽章与流截断徽章，plugins/shell-tools）
// "read"（path/startLine/endLine/totalLines/truncatedByBytes——读取卡行窗与窗口注，plugins/fs-tools）
// "write"（path/created——新建卡徽章与全文预览）/ "edit"（path/replacements——diff 卡计数，同上）
// "glob"（files/total）/ "grep"（mode/matches/files/counts/totalSeen/totalFiles——搜索卡分组，plugins/fs-search）
// "mcp"（server/tool 原始名——MCP 卡拆名，plugins/mcp）
// "ask_user"（questions/answers/cancelled——提问痕迹卡问答对，plugins/ask-user，R184）
interface ApprovalRow {
  kind: "approval";
  rowId: RowId;
  rowSeq: number;
  turn: string;
  step: number;
  requestId: string;
  toolName: string;
  argsSummary?: string; // argsDigest（关联指纹——同参同摘要；chain.test 锁定）
  args?: unknown; // 审批载荷 args 完整原样（E6，D-046「审计事件对照记全文」落码归位——挂起卡自足可渲染，per-tool 预览体唯一数据源；凭据经架构保证不进 args，approval/* 不进 derive）
  reason?: string; // 引擎判定链解释原样（围栏区外访问等；仅呈现）
  status: "pending" | "settled";
  decision?: Decision | "invalidated"; // "invalidated" 仅由修理事件 approval/invalidated 投影（R175 重启收口）——客户端不可提交（settle 端点 z.enum(DECISIONS) 不含它）
  scope?: "session"; // 会话级允许标记（decided{scope:'session'} 投影——settled「· 本会话」）
}
interface QuestionRow {
  kind: "question"; // 提问（R184）：question/asked 投影 pending 行；settled 原位 upsert
  rowId: RowId; // q:<requestId>
  rowSeq: number;
  turn: string;
  step: number;
  requestId: string;
  questions: QuestionSpec[]; // 题面全文自足（挂起卡与痕迹行共数据源；断线/多窗口重放同一张卡）
  status: "pending" | "settled";
  answers?: QuestionAnswer[]; // outcome = answered 时在场（逐题；空 selected = 跳过）
  outcome?: "answered" | "cancelled" | "invalidated"; // invalidated 仅由修理事件投影（重启收口）
}
interface ErrorRow {
  kind: "error";
  rowId: RowId;
  rowSeq: number;
  turn?: string;
  code?: string;
  message: string;
}
type Row = UserRow | AssistantRow | ToolRow | ApprovalRow | QuestionRow | ErrorRow;

interface SessionState {
  busy: boolean;
  lastTurnId?: string;
  queue?: QueuedPrompt[]; // 排队条目快照（E1 排队卡数据源；投影态非账本——loop 活态经发布口并线，queue/changed → state.updated；快照同带。loop 不在册 = 键缺省）
  queuePaused?: boolean; // 中断冻结（队列非空时中断不冲刷等 resume；投影态非账本事实，与 queue 键同批并线）
  busySince?: number; // 当前 busy 段真实起点（R173：turn/start 事件 time；turn/end 清除；重放重建自愈——刷新/重连计时续表，前端无此字段兜底本地起表）
  turnTimings?: Record<string, { durationMs: number; endedAt: number; forkSeq: number }>; // 回合耗时（E3 回合头：turn/start·turn/end 事件 time 差）+ endedAt = turn/end 时刻（E4 轮尾时间戳）+ forkSeq = turn/end 事件 seq（E4 轮尾 fork 的账本切点——前缀复制 inclusive；事件时间戳取数，重放重建/重载后仍在；保留最近 50 轮）
} // turn/start…turn/end 之间 = busy（账本事实派生）
interface SessionSnapshot {
  sessionId: string;
  title?: string; // 会话标题（R188：首条非 breaker 用户消息；缺省 = 尚无用户消息）
  seq: number; // 该会话当前水位（此后增量帧 seq 单调 +1）——增量帧只动尾部窗口内的行
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

// SSE 帧信封（GET /api/events；帧序 = connected → 逐会话快照帧 → 增量帧 / 列表信号混排）
type ServerFrame =
  | { kind: "connected"; server: { version: string; startedAt: number } }
  | { kind: "snapshot"; sessionId: string; snapshot: SessionSnapshot }
  | { kind: "delta"; sessionId: string; seq: number; delta: Delta }
  // 列表信号（R176）：会话/目录列表事实变了（新建 / 删除 / fork / 懒挂载 / 目录增删）——
  // 全局帧，无 sessionId、无 seq；消费者自行去抖重载。流式 token 增量绝不发此帧。
  | { kind: "sessions.changed" };
```

**客户端纪律（断档不猜）**：每会话记 `lastSeq`；增量帧仅当 `seq === lastSeq + 1` 时应用，否则调 snapshot 端点整体替换并重置水位——客户端永不猜中间态。

### 投影器（实现住 `@henira/protocol`——server 与 sdk 双形态共用的事件→行唯一组装处）

- **唯一权威输入 = 会话账本**：历史与断线重建都从账本回放——快照永远从真相重建，实时路径任何漂移都被账本兜底（自愈）；
- 实时两路：①**账本追加**（宿主装饰组合接 `SessionHandle.append`——user / tool / result / approval / turn 生命周期等有身份的事实）；②**总线 loop/event 流式增量**（text / reasoning delta——刻意不落账的打字机碎片，挂到当前流式 assistant 行）；
- 行构造纯函数共享：快照 = 从空投影顺序 apply 全部账本事件；增量 = 逐追加 apply；两路同一套行构造逻辑（一个词表，无第二 reducer）；
- **步边界自愈**：`assistant/message` / `tool/result` / `approval/decided` / `question/settled` 落账即 `row.upserted` 整行替换，冲掉流式累积的任何漂移；**孤儿 `approval/decided`（无 asked 配对——默认放行层 / 规则层 / 会话折叠的审计）不投影行**：自动放行的工具调用不在对话流里留「权限请求 allowed-once」噪音行（E3 实锤——幽灵行既污染流又切断相邻聚合组），审计住账本不丢；**孤儿 `approval/invalidated` 与 `question/settled`（无 asked 配对）同款抑制**；
- **重启收口**（R175；R184 扩提问）：serve 启动扫描全部账本（registry.repairLedgers，监听前）+ 开档（SessionStore.create）双路径执行同一修理——①seq 外科重排（append 串行化之前写者竞态留下的共享 seq 伤——保事件保行序只修 seq，删行会丢 decided 事实）②孤儿挂起审批补写 `approval/invalidated`、孤儿挂起提问补写 `question/settled{outcome:"invalidated"}`（修理专用，loop 与客户端都不发；事件自带 ignorable——旧读者透明跳过）③开回合补写 `turn/end{interrupted}`（time = 账本最后真实事件时间——轮耗时定格死亡时刻）。投影侧：invalidated → settled 痕迹行「已失效（服务重启）」；reason:"interrupted" 与 aborted 同享中断徽章 + interruptedKind:"restart" 分型 + 死亡步悬挂工具行（tool/call 无 result）收口为 error——幽灵审批卡 / 幽灵提问卡 / 假在跑工具卡 / 跨重启 busy 计时四族幽灵在结构上不可能从账本重放出来；
- **回合耗时**（E3 回合头）：`turn/start` 记账本 time、`turn/end` 结算 `durationMs` 入 `state.turnTimings`，E4 扩 `endedAt`（轮尾时间戳）与 `forkSeq`（turn/end 事件 seq——轮尾 fork 的账本切点）（事件时间戳取数——重放重建/重载后仍在；保留最近 50 轮）；**busy 段计时起点**（R173）：`state.busySince` 同取 turn/start time、turn/end 清除，前端「思考中」秒数优先此值——刷新/重连/换窗口续同一块表；
- **行时间**（E4 轮尾/用户行操作行时间戳）：`user/message` / `assistant/message` 落账投影带 `time`（事件 time，epoch ms）——流式行与中止冻结行无权威落定故缺字段；
- seq 在扇出层按会话编发（快照帧携带当前水位，增量帧 +1 单调）；
- 队列状态不投影（D-045：队列不是对话事实，不进账本）；busy/lastTurnId 由账本 turn/start…turn/end 派生；
- rowId + seq 游标为将来留口：per-session 订阅与 rowsRange 分页是加法不是重构（见文末备考）。

### SSE 传输形状

- 单端点 `GET /api/events`；首帧 `connected`，随后**逐会话快照帧**，之后增量帧按会话混排；
- **列表信号帧**（R176）：`sessions.changed` 是全局帧（无 sessionId / 无 seq），只在列表事实变化时发（建 / 删 / fork / 懒挂载 / 目录增删）——**流式增量绝不发**；消费者（侧栏列表）按「装载一次 + 信号驱动重载」消费，服务端不推送列表内容本体；
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
  prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptReceipt>; // D-045 单口；opts = 模型/思考按次覆盖（每次提问绑定，骨架批）
  steer(sessionId: string, entryId: string): Promise<boolean>;
  interrupt(sessionId: string): Promise<void>;
  fork(sessionId: string, atSeq?: number): Promise<string>; // 轮尾分叉（E4）：seq 前缀复制出新会话并装配入册，返回子会话 id；双形态同测锁
  settleApproval(
    sessionId: string,
    requestId: string,
    decision: Decision,
    scope?: "session",
  ): Promise<boolean>; // scope:'session' = 会话级允许（E6）
  settleQuestion(
    sessionId: string,
    requestId: string,
    answer: readonly QuestionAnswer[] | { cancelled: true },
  ): Promise<boolean>; // 提问收答（R184）：逐题答案或取消；双形态同测锁
  snapshot(sessionId: string): Promise<SessionSnapshot>; // 初始渲染 + 断档重拉（长会话 = 尾窗 60）
  sessionRows(sessionId: string, opts?: { before?: number; limit?: number }): Promise<RowsPage>; // 行翻页（D-061：before = rowSeq 排他游标；hasOlder=false = 已到顶）
  getSettings(): Promise<SettingsData>; // 设置读（settings.json；凭据永不出现，D-030）
  putSettings(patch: {
    model?: string;
    ui?: { theme?: string; locale?: string; preview?: PreviewOpenSettings };
  }): Promise<SettingsData>; // 设置写（程序写，data-directory §2.3）
  listModels(): Promise<ModelCatalog>; // 选择器清单（闸门分档——已知厂商 key+baseUrl、自定义 baseUrl；条目化 CatalogModel；无密钥）
  putCredential(providerId: string, key: string): Promise<void>; // 密钥写入（credentials.json 0600；无读取面——D-030 永不回读）
  // ── 模型管理面七方法（✓ 模型管理批 2026-11-19 + 收敛批语义；REST 同名端点同语义，双形态同测锁）──
  listProviders(): Promise<{ providers: ProviderCatalogEntry[] }>; // 管理分组（连接态/显示名/模型条目含开关与徽章位）
  listModelPresets(): Promise<ModelPresets>; // 厂商选择页预设全表（快照 + 本地缓存字典视图）
  refreshModelPresets(): Promise<{ ok: boolean }>; // 在线刷新目录（models.dev；失败保留快照/缓存现状）
  connectProvider(providerId: string, key: string): Promise<void>; // 连接已知厂商（key 必填；缺 baseUrl 从快照 endpoint 自动种）
  disconnectProvider(providerId: string): Promise<void>; // 断开（摘键；models.json 分档——已知厂商只清显隐保 baseUrl/label，自定义整条删）
  setModelEnabled(providerId: string, model: string, enabled: boolean): Promise<void>; // 开关显隐（models.json hidden 清单——开 = 移出，关 = 加入）
  putCustomProvider(input: CustomProviderInput): Promise<{ id: string }>; // 自定义 OpenAI 兼容厂商（显式清单；返回生成的 user- 前缀 id）
  listUiAssets(): Promise<UiAssets>; // 界面资产清单（D-059 语言包/主题包）
  listDir(sessionId: string, dirPath?: string): Promise<DirEntry[]>; // 会话工作区文件列表（只限会话 cwd；隐藏项不返）
  readWorkspaceFile(sessionId: string, path: string): Promise<WorkspaceFileContent>; // 工作区文件读取（R190；cwd 围栏 + realpath；文本 1 MiB 截断 / 二进制 base64；双形态同语义）
  listDirs(): Promise<RegisteredDir[]>; // 登记工作目录（data-directory §4 projects.json；D-060）
  addDir(cwd: string): Promise<RegisteredDir>; // 登记（绝对路径 + 存在 + 是目录；非法抛错）
  deleteDir(id: string): Promise<void>; // 删登记目录（该 cwd 全部会话 + 登记条目；盘上工作目录不动；busy 抛错——D-060）
  browseDirs(path?: string): Promise<DirBrowse>; // 全局目录浏览一层（新增目录弹窗数据源；D-060）
  deleteSession(id: string): Promise<void>; // 删单个会话（账本目录整棵；busy 抛错——D-060）
  // 界面绑定状态四方法（✓ 界面持久化批——D-063；写时机 = 客户端防抖 + 关页 / 切会话冲刷）
  getUiState(): Promise<GlobalUiState>; // 全局"上次选中"（backing state/ui.json）
  putUiState(doc: GlobalUiState): Promise<void>;
  getSessionUiState(sessionId: string): Promise<SessionUiState>; // 选中会话时拉取回填
  putSessionUiState(sessionId: string, doc: SessionUiState): Promise<void>; // 整份原子重写，后写者赢
  events(): AsyncIterable<ServerFrame>; // 全局帧流（connected / 快照 / 增量 / sessions.changed），
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

// ── 官方件承重缝（件 + 会话上下文一起给；M4 批 A 扩定——D-057 slots / D-059 主题字符串 id；
//    三栏骨架批扩宿主级关注面——全部可选，宿主缺省 = 对应 UI 不渲染，feature-detect 先例）──
interface WebPartContext {
  client: HeniraFacade;
  sessionId: string | null; // 当前会话（null = 未选中）
  selectSession(id: string | null): void; // 会话切换（承重缝：SessionList → 宿主单源）
  t: (key: string) => string; // D-050 locale 取字（缺 key fail-loud；D-059 语言包覆盖优先、回落 zh）
  theme: string; // 主题 id：官方 light/dark 或已装主题包名（D-059）
  locale?: string; // 生效语言 id（宿主 boot 还原后的实际值——语言页显示生效值不读磁盘旧值；旧宿主缺省 = 官方 zh，审查三修 2026-11-19）
  store: RowStoreLike; // 流式增量从哪来
  host: PluginUiHost; // 宿主门面（14 方法；另含可选 tokenizeCode?）
  slots: ReadonlyMap<string, readonly SlotPart[]>; // 槽位只读视图（结构性 / 区域 + 行级，D-057 / D-062）
  chains: ReadonlyMap<string, readonly ChainEntry[]>; // chain 槽只读视图（R182；priority 升序，消费侧 electChain）
  composer?: ComposerApi; // 输入座位 API（R183）：仅 composer.* 子树由 ComposerDock 注入——草稿/焦点/按次模型绑定/审批回调
  preview?: PreviewApi; // R188 预览：open(target) 按 settings.ui.preview 路由到右栏 tab / 弹窗；设置页用 settings/setMode
  uiState?: SessionUiState; // 每会话界面绑定态（D-063，宿主加载好的文档）
  updateUiState?(patch: SessionUiState): void; // 部件只交 patch，宿主合并防抖落盘
  layout?: "full" | "center" | "composer" | { parts: Partial<Record<WebSlotName, WebPart>> }; // D-043 挑件（缺席按 full）
  safeMode?: boolean; // 安全模式徽标（双击 Alt 由宿主管）
  sessionCwd?: string | null; // 中列 header 目录名
  onTheme?(next: string, cssUrl?: string): void; // 设置弹窗主题页（D-059 <link> 注入在宿主）
  onLocale?(dict: Record<string, string> | undefined, localeId: string): void; // 设置弹窗语言页
  openSettings?(section?: "theme" | "locale" | "models" | "plugins"): void; // 设置弹窗开（宿主持有开合状态）
  closeSettings?(): void;
  settingsSection?: "theme" | "locale" | "models" | "plugins" | null; // 当前开着的分区（null = 关闭）
}
type WebPart = (ctx: WebPartContext) => ReactNode;

// ── 预览 API（R188）：官方件与第三方件共用；文件只存行引用，正文现场解析 ──
type PreviewTarget =
  | { kind: "file"; path: string; rowId: string } // 行在窗 = 该 tool 行 input/output；行出窗 = 工作区路径读取（R190）
  | { kind: "image"; src: string; alt?: string }; // src = URL（引用，可持久化）或 data:（本页内存，落盘剔除）
interface PreviewApi {
  settings: Readonly<Required<PreviewOpenSettings>>; // { file: "panel"|"modal", image: ... }（只读快照；写入走 setMode）
  open(target: PreviewTarget): void; // panel = 当前会话 rightPanel 加/激活 tab；modal = 框架件渲染弹窗
  setMode(kind: "file" | "image", mode: "panel" | "modal"): void; // 内存即时 + settings.json 深合并落盘
  modal: PreviewTarget | null; // 弹窗模式当前目标（框架件渲染）
  close(): void;
}

// ── 预览缝（R190，D-076）：sidebar.right.preview.<后缀> 的件形状。官方兜底体注册在通配 *
//    （与第三方同一注册路径）；解析 = 最长后缀（复合后缀支持）→ * → 代码兜底；预览键全族 single 占用；
//    注册口归一（R191）：后缀小写、去前导点、空后缀→*，占用判据与解析键空间一致 ──
interface PreviewViewArgs {
  ctx: WebPartContext;
  target: PreviewTabPayload; // { kind: "preview-file"|"preview-image"; path?; rowId?; src?; alt? }
  ext: string; // 归一化扩展名（小写、去点、取最后一段；无扩展名 = ""；图片 = ""）
  row?: ToolRow; // store 中按 rowId 找到的 tool 行；行已翻页出窗 = undefined（正文走 read()）
  read(): Promise<WorkspaceFileContent>; // 会话 + 路径的 workspace 文件读取（不锚定工具行）
}
type PreviewView = (args: PreviewViewArgs) => ReactNode;
interface WorkspaceFileContent {
  path: string; // 实际读取的绝对路径（会话 cwd 围栏内）
  encoding: "utf8" | "base64"; // utf8 = 文本（可能截断）；base64 = 二进制（完整）
  content: string;
  size: number; // 磁盘文件总字节数（截断前）
  truncated?: boolean; // 文本超过 1 MiB 上限
}

// ── 输入座位 API（R183，dsh owner props 行为层）：ComposerDock 构造、注入 composer.* 子树。
//    草稿/焦点/按次模型绑定/审批回调的唯一真源——座位件与 bar 不各自私存状态 ──
interface ComposerApi {
  sessionId: string | null;
  draft: string; // 当前草稿（会话级，持久化走 updateUiState）
  setDraft(text: string): void; // 本地态 + uiState 双写
  focus(): void; // 焦点回输入框（bar 已挂载）
  busy: boolean;
  isEmpty: boolean; // 无历史（占位三态/空态判定）
  sendFailed: boolean;
  model: string; // 按次模型绑定（会话级记忆）
  setModel(next: string): void;
  effort: ReasoningEffort | null;
  setEffort(next: ReasoningEffort): void;
  catalog: ModelCatalog; // 目录快照（composer.model 席消费）
  settingsReady: boolean; // 宿主 getSettings/listModels 齐备
  submit(text?: string, opts?: { steer?: boolean }): void; // 缺省用草稿；steer=忙时插话
  stop(): void;
  pendingApproval: ApprovalRow | undefined; // 队首待审批（接管面）
  approvalQueueTotal: number;
  onApprovalDecided(requestId: string): void; // 点击即退场（乐观）
  onApprovalFailed(requestId: string): void; // settle 失败回滚
  pendingQuestion: QuestionRow | undefined; // 队首待提问（R184；priority 5 压过审批）
  questionQueueTotal: number;
  onQuestionDecided(requestId: string): void; // 提交/取消即退场（乐观）
  onQuestionFailed(requestId: string): void; // settle 失败回滚
  registerInput(el: HTMLTextAreaElement | null): void; // bar 登记焦点目标
}
```

- **plugin-web-ui = 真插件**（D-043）：id-only 条目进 defaultPreset（无引擎 definition），web 宿主经**公共注册路径**装载其 UI 模块，件经 `UiModuleContext.registerSlot / replaceSlot` 挂载；可整只替换；安全模式（双击 Alt / `?ui=safe`）= 不激活任何 UI 模块、只渲染官方默认组合（web 宿主实现，web-ui 供默认组合）；未装件的槽位**收起**（不渲染不占宽）；
- **编译期出口**（D-043 第 7 条定稿）：`@henira/plugin-web-ui` 同时导出布局 + 官方件（会话列表 / 对话面板 / 输入框 / 审批卡）+ `locales/zh` 字典——web 宿主 import 同版本件，官方件与插件用件同一零件库；**不 eval 插件源码（模块加载，D-021）**；
- **组织约束（D-043 第 8 条，首发生效）**：web 界面自第一行代码起按"可拆组件 + 槽位组合"组织，默认组合只是一种排列；
- **挂载点词表 v1 十七个（D-057 行级四缝 2026-11-17 ＋ D-062 结构性 / 右栏 tab / 词表正名 2026-11-18 ＋ E6 审批卡缝 2026-11-21 ＋ R182 输入座位 / chain 2026-11-22 ＋ R183 输入座位四席 2026-11-22）**：结构性一个 `layout`——**整页框架槽**（官方框架件默认占用并在占槽的同一注册里声明子槽——槽套槽，声明 = 独占渲染权；`replaceSlot("layout")` = 整页重排，风险标注同 dsh root 槽：影子化官方 UI，安全模式回落官方框架）＋ 区域级四个 `sidebar`（左栏）/ `conversation`（中柱）/ `composer`（**输入座位**——官方默认件 ComposerDock，chain 接管路由）/ `sidebar.right`（右栏，官方默认件 = tab 框架——ZCode 式 tab 条 + 加号 / 下拉列已注册面板；`sidebar.right.tab` 追加位一件 = 一个插件 tab 面板，多件共存 order 排序）＋ **输入座位子槽六个（R182 两名 ＋ R183 四席）**：`composer.bar`（**常驻输入栏**，single；官方默认件 = Composer，chain fallback——接管时保持挂载、`display:none`，草稿 / DOM 态不丢）· `composer.takeover`（**接管 chain**：条目 = `id + priority + select(owner) + Component`；priority 升序、select 首个非 null 当选；官方条目 = 提问（priority 5，R184 已落码）与审批（priority 10）——提问压过审批；消费件负责 fallback 挂载与 overlay 隐藏；官方条目同走公共注册路径，第三方 `replaceChainSlot` 顶替、卸载按登记回落）· `composer.model`（**模型席**，single——模型 + 思考档同一席，官方默认件 = ModelSeat；第三方 `replaceSlot` 顶替）· `composer.left` / `composer.right`（**工具排左 / 右追加位**，list——官方空，只给插件加按钮）· `composer.dock`（**输入卡外通栏条目**，list——官方默认件 = QueueDock 排队面板，审批接管时仍可见）＋ 行级六个 `tool.call.view.<工具名>`（工具卡 keyed；官方默认占用、插件顶替、卸载回落。E5 起**官方自己也走 keyed 注册**——八键 `tool.call.view.{bash,powershell,edit,write,read,glob,grep,ask_user}` 官方 per-tool 卡经 `webUiModule` 注册进缝（安全模式同灌），插件 `replaceSlot` 顶替、卸载回落官方；MCP 工具是动态 wire 名无法逐个注册，ToolRowView 前缀路由：精确 key 缺 → 查 `tool.call.view.mcp` **总缝**（渲染总缝槽内件本身；官方 MCP 卡默认注册在此，插件可整类顶替）→ 通用卡兜底；`tool.call.view.mcp` 为总缝保留键——字面名 `mcp` 的工具不进总缝、直接落通用卡）· `approval.view.<工具名>`（**审批卡 keyed**，E6：官方 per-tool 审批卡注册进缝——edit/write diff 预览、bash/powershell 命令行、read/glob/grep 路径摘要、未知工具 JSON 预览；数据源 = ApprovalRow.args 完整原样（D-046「挂起自足可渲染」）；插件 `replaceSlot` 顶替、卸载回落通用卡）· `conversation.images`（图片画廊单槽）· `turn.tail`（回合尾追加位，registerSlot 多件共存按 order——最终回复富结果呈现挂此处，追加不改写回复正文）· `sidebar.right.preview.<后缀>`（文件预览 tab 的 body 实现缝，keyed；官方兜底体注册在通配 `*`——插件按后缀（含 `tar.gz` 复合）注册或 `replaceSlot` 顶替、卸载与渲染崩溃回落官方；预览键全族 single 占用；件形状 `PreviewView`，R190）。词表名以宿主代码三名正名（原 D-033 名 session.top / composer.above 作废，D-062——按文档写插件从"静默忽略"变"直接生效"）。**markdown 正文本体不可插**：`renderMarkdown` 保持宿主门面方法，正文渲染永远是官方实现——可插的是容器（框架 / 区域 / 工具卡 / 画廊 / 回合尾 / 右栏）不是内容；`chat.node` 式整行替换不进 v1（绕过宿主渲染管线，与界面统一视觉系统冲突，有真需求再议）。**落码随批 C**（第三方 UI 装载通道同批，D-062）：`layout` / `sidebar.right` 区域槽 / `sidebar.right.tab` 此前不被宿主读取、`sidebar.right.preview.` 前缀已接受但渲染挂点缺（D-059 先例；R190 已补）；行级三缝已生效（M4 批 A）；**三栏骨架批已生效（2026-11-18，先行于批 C）**：`layout` 槽（官方框架件 = plugin-web-ui `LayoutFrame`，宿主 root 只挂 layout——宿主零界面 JSX）· `sidebar.right` 槽（官方默认件 `RightPanel` tab 框架；`rightPanel{open,active,tabs}` + `layout.rightWidth` 进 ui-state 按会话持久化）· `sidebar.right.tab` 追加位（注册件各成一 tab）；**R182 输入座位 / chain 已生效（2026-11-22）**：`composer` = ComposerDock（消费 `composer.takeover` chain）· `composer.bar` = 常驻输入栏（fallback，接管时 display:none 保持挂载）· 宿主 chain 登记簿与 `WebPartContext.chains`；**R183 输入座位四席已生效（2026-11-22）**：`composer.model`（single，官方 ModelSeat）· `composer.left` / `composer.right`（list，官方空）· `composer.dock`（list，官方 QueueDock——排队面板移出 bar，接管时仍可见）· single 语义（`registerSlot` 认领/顶替、卸载回落）· `WebPartContext.composer`（ComposerApi）；**R184 提问已生效（2026-11-23）**：`ask_user` 专用工具（插件 `plugin-ask-user`——与审批分离，答案即工具结果）· `composer.takeover` 第二条官方条目 `question`（priority 5 压过审批）· `question/*` 账本对 + `QuestionRow` 投影 + `POST /questions/:requestId` · `tool.call.view.ask_user` 痕迹卡 · ComposerApi 提问面；**R190 预览缝已生效（2026-11-23）**：`sidebar.right.preview.<后缀>` 渲染挂点接线——官方兜底体注册通配 `*`、插件按后缀顶替、预览键 single 占用、`PreviewView` props `{ctx,target,ext,row?,read()}`、工作区文件读取 `GET /api/sessions/:id/file`（文本截断/二进制 base64）；
- **视觉语言（设计基线）**：
  - 过程纪律 = 项目内 skill `.agents/skills/frontend-design/`（设计计划先行 + 俗套自查 + 截图自审，Anthropic 官方，Apache 2.0）；质量闸 = `.agents/skills/no-ai-design-slop/`（紧凑闸门 + 移除测试，MIT）——web 步开工先 load，写码期间照办；
  - 配色 = CSS 变量 token（暖单色基底 + 语义粉彩点缀思路自 minimalist-ui 蒸馏），**明暗双主题**（theme 切换 = 换变量组，判据③）；嵌入方零样式依赖（token 随组件注入）；M4 批 A 视觉二轮起层次机制 = **前景色派生透明度档**（surface 5% / hover 8% / selected 10% / border 10-16%，color-mix 自 --henira-text——ZCode 行为层参照 2026-11-17），行内淡面用派生档、浮层面板用实色 `--henira-panel`（透明档不作浮层）；运行态 = 文字扫光（`.henira-sweep`）不用转圈 spinner；
  - 布局与部件基线（批 A3，2026-11-17 用户拍板照 ZCode 形态；**输入座位 R182 按 D-072 修订**）：**会话列表按工作目录分组**（折叠组头 = caret + 目录名 + 会话数徽标，活跃会话所在组自动展开——ZCode projects view 行为层）；**设置齿轮住侧栏左下**固定行（ZCode WorkspaceSidebarFooter 行为层）；**输入座位（R182）**：`composer` = 接管座位（官方件 ComposerDock，chain 路由 `composer.takeover`），`composer.bar` = 常驻输入栏（chain fallback；审批/提问接管时保持挂载、`display:none`，草稿 / DOM 态不丢，焦点移入接管卡、决定后回输入栏）。输入卡视觉照 ZCode：`--henira-card-bg` 白底 + 10% 细边 + 16px 圆角 + 两层轻影（`--henira-shadow-composer`），hover / focus-within 只把边框加深到 16%（不再黑边聚焦），内部无独立焦点环；编辑区最小 40px / 最大 160px / 行高 20px / 占位最弱档；工具排 = 28px 高 / 14px 字 / hover 浅底不描边，左 = 模型席（`composer.model`，官方 ModelSeat：模型选择器 + 思考档；触发钮只显示模型显示名——厂商 id 不进按钮，绑定值目录里失效即回落清单首个，2026-11-19）+ 左追加位（`composer.left`，官方空）、弹簧、右追加位（`composer.right`，官方空）+ 28px 圆形发送/停止钮；占位三态 = 空会话「向 Henira 提问」/ 有历史「提出后续修改要求」/ 忙「继续输入以排队后续修改」（键盘教学与忙态常驻提示退场，修饰键提示由发送钮 tooltip 承担）；排队卡 = 上圆角 + 负底边距 + 半透明底 + 毛玻璃，贴输入卡后沿；**R183 起排队卡住 `composer.dock`（bar 外），审批接管时仍可见**；**发送/停止语义 = ZCode**（忙+有草稿 = 发送排队、忙+空草稿 = 停止——有字时圆钮恒为发送）；prompt 失败回填草稿 + 行内错误提示（不静默）；**对话列宽三档**（列含内衬默认 808px → 视口 ≥1124px 896 → ≥1540px 1152，对话列与输入 dock 同档——ZCode conversationLayout 672/896/1152 行为层）；**滚动条细圆条**（14px 槽 / thumb 3px 透明边 padding-box 胶囊 / track 透明 / 色=border 派生档，对话列 `scrollbar-gutter: stable`——ZCode styles.css 数值档行为层，实现自家写法）；usage 不进对话区（数据仍在行上，R178）；
  - **长会话渲染（批 A'，2026-11-18——D-061）**：对话时间线虚拟滚动（tanstack react-virtual——ZCode 同款；虚拟单位 = 轮，turn 相同行不拆散；measureElement 动态测高、estimateSize 一屏兜底、overscan 2；会话切换以 sessionId 为内层 React key 重挂换测高缓存）；**bottom-follow**（上滚手势 wheel/touchmove/方向键 capture 解除 + 落点贴底 48px 恢复 + 回底按钮——dsh 显式按钮不取）；**滚顶翻页**（scrollTop < 64 且 hasOlder → `sessionRows(before=窗口首行 rowSeq)` → store 前插合并（只收窗口首行之前 + rowId 去重）+ scrollTop 补位防跳顶；宿主缺 sessionRows = 静态窗口）；**行引用契约**（store：未变行同引用、变化行新对象）+ RowView/SessionRow memo（比较函数拆稳定子集 row+t+host+slots——ctx 本体每渲染新对象不可比）；jsdom 无 ResizeObserver 降级全量渲染；
  - **侧栏目录区（R127，2026-11-18 用户三拍板——D-060）**：分组数据 = 登记工作目录表（`client.listDirs` 驱动——空目录也显示、未登记 cwd 补组、无 cwd 归「其他」）；宿主**五可选方法齐备才渲染目录交互**（缺任一退化纯 cwd 分组）；区头 hover 显「＋目录」（服务端目录树弹窗：此电脑 → 盘符 → 目录逐级懒展开 + 路径输入框双通道，浏览器拿完整路径）；目录行 hover 显 ＋ = 在该目录新建会话（`createSession({cwd})` 服务端自动登记）；右键组头/会话行出非模态菜单（目录 = 新建会话/复制路径/删除目录；会话 = 删除——busy 项 disabled「运行中，请先中断」）；删除一律模态确认（硬删不可恢复，不学 ZCode 软删两击——确认弹窗 + busy 前置守卫）；
  - **会话列表刷新契约（R176，2026-11-22——五家 0/5 铁律落码）**：列表**装载一次 + `sessions.changed` 信号驱动**（建 / 删 / fork / 懒挂载 / 目录增删）——250ms 去抖 + 单飞（在飞只标脏、落定恰补一枪）+ 失败保旧列表**不自动重试**（下个信号再来）；`state.updated` 帧就地翻 busy 点（零请求）；重连快照对未知会话补一次重载。**流式 token 增量绝不触发列表请求**（行 store 通知不再接列表刷新）；e2e 以网络面板计数断言「流式回合列表零请求」；
  - **中间对话区输出组织契约（R178，2026-11-22——按参照实现逐行修正，D-069；D-068 的旧描述以本节为准）**：视觉层级 = 正文 / subtle 类别与摘要 / subtlest 状态；**行本身无边框无底色，结果才用卡片**，hover 才提亮显箭头。**工具行** = 工具身份图标（read/search 放大镜、bash/powershell 终端、edit/write 铅笔、MCP 插头、兜底扳手，16px 弱色）+ 类别词（正在读取 / 已读取、正在搜索 / 已搜索、正在执行 / 已执行、正在编辑 / 已编辑、正在写入 / 已更新、MCP）+ 主信息 + diff 计数 + **仅失败时**的状态词（虚线下划线 + 原因 title）；成功行不显示状态词 / 单次耗时；错误不自动展开；展开状态按 `sessionId:callId` 记忆。**read / search / glob 是静态行**（`canToggle=false`，无按钮语义 / 箭头）：read 主信息 = 文件图标 + 文件名（点击弹窗看账本已捕获 content；不显示行号范围 / 耗时）；search / glob 只有一句「查找 \<query\>」/「列出 \<path\>」，不展开结果列表 / 文件 chip。**思考块**：默认收起；「正在思考」/「思考 持续了 N 秒」（历史无起点「持续了几秒」）；流式摘要在同一行右侧；展开 14px/1.75 纯文本、左导线、max-h 240。**完成轮过程折叠**：最终回答之前的思考 / 工具 / 中间文本收进「已工作 3 分 44 秒」（无「用时」、无工具计数；底边细分隔线；箭头常显），最终回答留在外面；运行中不显示轮级折叠头（过程直接展开 + 末尾「工作中 + 时长」加载行）；中断「已停止」、无时长「已处理」；异常轮默认展开；用户手动开合优先；最终回答行自带 reasoning 收进折叠体。**轮内过程分组**：连续「思考 + 有类别的工具」**项数 ≥2** 折叠（思考也算一项）；未知工具 / MCP 是边界不分组；组头统计「已查阅 N 项，已执行 N 命令，已修改 N 文件」（运行中未完成措辞；中文逗号；change 按去重文件数，路径未知单列）；**收起态修改组显示去重文件名（basename；展开回统计）**；运行中组头显示当前活动项摘要，**展开后显示统计**；组内左导线 + 16lh + 120px 上限，**子行不重复工具图标、思考块不叠二级导线（组导线唯一）**。**审批**：pending 在输入区 dock；**settled 痕迹不进官方对话流**（行模型无 approval 行；数据仍在 store，自定义 conversation 区域可消费）。**不上屏**：usage / 思考档行徽章、assistant 下「已中断」胶囊。**结果卡**：兜底扁平参数 = 两列键值表（不露花括号；空对象显「无参数」），嵌套对象才用 JSON；MCP 结果优先（短结果小卡 / 长结果代码块 288px）+ 参数收进二级「查看调用详情」；execute 命令 3lh 可展开到 10lh、输出 5lh；diff 上限 240px。正文 markdown：14px / 1.75 / 0.025em；strong 500；ul 各级 disc、ol inside、li 内 p margin 0；行内 code 12px 无边框；标题 mt 24 / mb 16；引用 pl 12；链接蓝色点线；外链新标签、相对链接不导航。**不改协议 / 行投影 / 存储 / 槽语义**；`conversation` 区域槽、`tool.call.view.*` / `tool.call.view.mcp`、`approval.view.*` 顶替与卸载回落、公共出口与 `ToolCallView` / `ApprovalCardView` props 原样保留；JSX 结构变化只发生在官方默认件内部；
  - **CSS / 组件组织（R177 初拆 / R178 对话区 / R187 二次拆分 / R188 设置重排）**：样式拆 `plugins/web-ui/src/styles/` 分区文件，对话区再拆 `styles/conversation/` 六个功能文件（`00-motion` / `10-markdown` / `20-actions` / `30-rows` / `40-turn` / `50-empty`），输入区拆 `composer/`（shell / model-select / queue / approval / question / trace）与 `controls/`（HeniraSelect 基础弹层，保持原级联位置），三栏/弹窗/设置拆 `sidebar/` / `dialogs/` / `layout/` / `settings/`；入口 `tokens.css` 只做 `@import` 汇总（包出口 `./tokens.css` 不变，宿主 import 零改动；构建 copy 脚本递归复制 styles/）；组件按职责拆 `parts/conversation/`、`parts/tool-cards/`、`parts/settings/`（模型管理四视图 = `models/` 下 index/list/picker/connect/custom + shared）、`parts/session-list/`，旧路径保留 re-export 薄壳；中间区布局样式出组件、走 CSS 类；
  - **界面收口（R188，2026-11-23）**：左栏会话行 = 服务端派生 `title`（首条非 breaker user/message，40 码点截断；空 → 目录名回落）+ 相对时间（刚刚/N 分钟/N 小时/昨天/N 天/日期）；busy 只留前置 spinner，无 idle 灰点；「＋新会话」= 图标+文字安静行；中列 header = 目录弱前缀（Folder 图标）+ 标题强（真实 title，缺省「新会话」），不再用「·」点串；空会话草稿态 = 按时段问候 + 品牌水印 + 一句真实能力提示（无 suggestion 假卡片）；设置「外观」= 页标题/说明/行卡（主题 select + 文件/图片预览分段），语言页同版式；文件预览默认右侧 tab、图片默认弹窗（`ui.preview` 按类型可改；文件 tab 只存 rowId/path 引用，正文现场解析），`ctx.preview` 为官方/第三方共用入口；工具行失败状态固定贴右、开合 300ms（reduced-motion 直卸）、edit old===new 显示「无变更」行；diff 按扩展名 shiki 高亮（异步、120k 上限、失败降纯文本）；插件页按内置/可管理分段、统一 switch、卸载 hover 浮现；模型管理加厂商标记、meta 去点串、加载/错误态；
  - **审批卡 / 排队卡（R180，2026-11-22——按参照重排；D-071）**：审批卡 = **中性弹层卡**（border + radius-xl + panel 底，无黄底 / 无状态徽章）+「权限请求」标题 + 工具预览块（图标 + 等待审批 + 工具身份 + 内容卡：diff / 命令 / JSON）+ **编号选项行**（主文案 + 说明，首行默认底；点击即决定；Enter=允许一次、Esc=拒绝，焦点在可编辑控件时不抢键）+ 键盘提示行；队列计数仅 >1 时以弱色尾注显示。排队卡 = 贴在输入卡上沿的**静音列表**（无标题 / 计数头）：14px 主文字行、steer 徽章、行动作 hover/focus 浮现；暂停态 = 中性提示条 + 继续发送。keyed 缝 `approval.view.*` 与 `composer.queue.*` 词表不变；
  - **输入座位 / chain（R182，2026-11-22——D-072）**：`composer` = 官方件 **ComposerDock**（chain 接管路由），`composer.bar` = 常驻输入栏（单槽 fallback），`composer.takeover` = chain（条目 = `id + priority + select(owner) + Component`；升序、first non-null wins；官方条目 = 提问（priority 5，R184 已落码）与审批（priority 10））。待审批 / 待提问时输入栏 `display:none` 但保持挂载（草稿不丢），接管卡占同一座位；焦点移入接管座位（提问卡落卡本体、其余落容器——R185 审查修夺焦）、决定或提交后回输入栏（仅当焦点没被用户移走）。点击即决定 / 乐观摘卡与回滚 / Enter=允许一次 / Esc=拒绝 / 可编辑控件守卫全部不变；提问卡语义：无预选、Space 多选、Enter 单选推进 / 末题提交、Ctrl+Enter 随时提交、Esc 首题取消整个请求 / 后续题回退、IME 组合不提交（R184）。应用侧兜底：**未答**审批或提问在位时输入栏 submit 直接返回——乐观已答不计：卡已离场、输入栏已回来，不吞发送（审查修复）。chain 登记簿 = `registerChainSlot` / `replaceChainSlot`（官方条目同走公共注册路径，第三方顶替、卸载按登记回落；同槽同 id 冲突 D-022 同款）。**四个座位与 Composer API（R183，2026-11-22——D-073）**：`composer.model`（**single**——模型 + 思考档同一席，官方件 ModelSeat；`registerSlot` 认领、卸载回落、第二家第三方冲突）· `composer.left` / `composer.right`（**list**——工具排左 / 右追加位，官方空）· `composer.dock`（**list**——输入卡外通栏条目，官方件 QueueDock 排队面板；R182 前排队面板在 bar 内，接管时随 bar 隐藏，R183 移出后接管期间仍可见）。四席与 `composer.bar` 共用 `ComposerApi`（`WebPartContext.composer`，ComposerDock 注入）：草稿 `draft/setDraft`（会话级 uiState 双写）· `focus/registerInput`（bar 登记输入框）· 按次模型绑定 `model/setModel/effort/setEffort/catalog/settingsReady` · 发送 `submit/stop` · 审批面 `pendingApproval/approvalQueueTotal/onApprovalDecided/onApprovalFailed`（乐观摘卡/回滚）· 提问面 `pendingQuestion/questionQueueTotal/onQuestionDecided/onQuestionFailed`（R184，同款乐观/回滚）。状态唯一真源 = `useComposerRuntime`（ComposerDock 内），bar 与座位件不私存；`Composer` 单独渲染 = fail-loud（须经 ComposerDock 整座装配）。`composer.bar` 与 `composer.model` 按 dsh single 槽语义落码（同一时刻一位占用）；dsh 的 `input.dock`（卡上）/`composer.dock`（卡下）两缝在本表合并为一个 `composer.dock`（卡上，装第一个真实消费者排队面板），卡下缝等第二个消费者再拆；提问（第二条 chain entry）R184 已落码（ask_user 专用工具 + 提问卡 + 痕迹行）**；
  - 图标 = **Phosphor**（`@phosphor-icons/react`，MIT），统一经内部 `Icon` 收口组件使用（库可换：换集只动一处）；**字重规范（基础件批 2026-11-20）= UI chrome 静态图标 bold + 操作钮 14px**（regular 细笔画在 ≤14px 操作钮尺寸糊成「小点/空方块」——用户实拍根因；Horse 用 fill、Spinner 保持 regular）；小图标操作钮统一 `.henira-iconbtn` 基类（透明重置全局按钮基线，muted 常态 hover 升 strong + surface-hover）；**统一下拉弹层件 `HeniraSelect`**（`parts/dropdown.tsx`，原生 `<select>` 系统菜单退场——受控单选 + 键盘 ↑↓/Home/End/Enter + `useDismiss` 统一外点/Esc 收，思考档 / 设置主题 / 设置语言三处已换装；复合面板 ModelSelect 保留自研但接 useDismiss + 键盘导航）；排队卡行操作钮 / 右栏 tab 关闭钮 hover·focus-within 浮现（opacity-only）；品牌标 / favicon 自绘缓建，M3 用文字词标占位；
  - 文案纪律按 frontend-design 的 writing 节（用户视角命名 / 动词一致 / 错误消息具体不道歉）+ D-050（一切用户可见文案经 `t(key)`，缺 key fail-loud）；
  - 界面资产缝（D-059，**已落码，M4 批 A**）：插件包可带 `locales/<lang>.json` 语言包（缺 key 回落官方 zh，不 fail-loud）与 `themes/<名>.css` 主题包（变量组追加进设置下拉，官方 light / dark 两档永在不可覆盖）；读者 = 官方界面件；`settings.ui.theme` / `ui.locale` 扩为任意已装 id；安全模式回落官方默认组合；清单与伺服走 `GET /api/ui-assets` 两端点（scanUiAssets 住 config-loader）。

## 插件 UI 宿主门面（web 系宿主实现，D-028）

> **不属于 `SlotMap`，不是引擎协议**；只存在于 web / desktop / 云端网页 / 手机网页。TUI 与 headless 没有插件 UI，不实现该门面。UI 模块与宿主同源，**不是安全边界**（D-021）。

```ts
interface UiModuleContext {
  registerSlot(name: string, component: unknown, opts?: { order?: number }): Disposable; // 追挂（append）；name 按当前宿主词表校验（D-033）；
  //   keyed 词表按前缀识别（tool.call.view. / sidebar.right.preview. 前缀合法、后缀自由，D-057）；
  //   single 槽（composer.bar / composer.model / sidebar.right.preview.* 全族）registerSlot 也走认领/顶替
  replaceSlot(name: string, component: unknown): Disposable; // 替换该区域 / keyed 槽的官方默认件（D-043 / D-057）；同 key 冲突报错（D-022 同款）；
  //   卸载 / 停用自动回落官方（D-048 同语义）；安全模式下行级缝全部收起回落默认渲染
  host: PluginUiHost;
}

interface PluginUiHost {
  // 对话：发起仍单口 sendPrompt；接收 = 双向事件流（D-042：订阅 opt-in、增量可并、终局必达）
  sendPrompt(text: string): Promise<TurnReceipt>; // ✓ M3
  subscribe(filter: EventFilter, cb: (e: ServerFrame) => void): Disposable; // ✓ M3
  //   EventFilter = { sessionId?: string; types?: string[] } —— 行词表帧流（ServerFrame）；
  //   M3 实装 = sessionId 过滤（帧级客户端过滤，无背压队列）；types 过滤随插件批补；
  //   R176：全局列表信号 sessions.changed 只投给不带 sessionId 过滤的订阅者（不属于任何会话）
  onTurnFinished(receipt: TurnReceipt, cb: (result: TurnResult) => void): Disposable; // ✓ M3（终局便捷回调）
  //   M3 实装 = 简版：会话 busy 沿（true→false）即通知、恒 {ok:true}、无 own-receipt 过滤——
  //   receipt 形（恰一次/终局映射 interrupted|error|submit_failed）随插件批升级（现无消费者）
  prefill(input: { chip?: string; text: string }): void; // ✓ M3 只回填不发送（web 宿主现空实现——官方输入框自管草稿，接线随命令进输入框批）
  renderMarkdown(text: string, opts?: { streaming?: boolean }): unknown; // ✓ M3 web 宿主返回 React 元素；M4 批 A 起 shiki 高亮（预装 js/ts/python/bash/json，流式中不高亮——delta 高频重渲下高亮留到回合完成）；E2 起 streaming=true 走增量臂（streaming-markdown：冻结已完成顶层块——元素按源偏移 key 只建一次引用复用、每帧只解析重渲尾段 2 块；非前缀输入整体重置），settled 全文单实例一次成型；已知取舍 = 跨冻结边界的链接引用定义流式期渲染为字面文本、settled 自愈，settle 时全文重渲一次（选区丢失一次）；R177 起外链新标签打开、相对链接不导航（`preventDefault`）、GFM 任务列表只读主题化；R188 起内联图片可点开预览（宿主按 ui.preview.image 路由）
  tokenizeCode?(
    code: string,
    lang: string,
  ): Promise<Array<Array<{ content: string; color?: string }>> | undefined>; // ✓ R188 web 宿主（shiki 整段 token 化；差异卡按行取 token——120k 字符上限、未知语言 undefined 降纯文本；可选方法，旧宿主缺 = 差异卡纯文本）

  // 数据
  useResource(address: string): ResourceSnapshot; // ✓ C5（plugin-mcp 数据泵：2s 共享轮询 / 越权地址返回 failed 快照、不订阅）；React hook 语义：仅 render 期调用
  listPlugins(filter?: { category?: string }): Promise<PluginInfo[]>; // ✓ 批 C（GET /api/plugins；管理面数据源；category 过滤预留）
  listDir(path: string): Promise<DirEntry[]>; // ✓ M3（经 server files 端点）；只限会话工作区；隐藏项不返
  readWorkspaceFile(path: string): Promise<WorkspaceFileContent>; // ✓ R190（预览缝 read() 的宿主实现；经 GET /api/sessions/:id/file；旧宿主缺 = 预览仅行快照）
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

// POST /api/sessions/:id/resource 回复（useResource 泵单跳；C5）
interface ResourceReply {
  ok: boolean;
  text?: string; // 工具返回文本（≤200 × 1024 字符，出口限量已应用）
  error?: string; // ok = false 时的可行动提示（未确认 / 未连接 / 越权 403 由状态码区分）
  updatedAt: number;
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
  mcp?: { name: string; target: string; confirmed: boolean }[]; // command 或 url 的展示串 + D-030 确认态（C5）
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
- `useResource` 地址格式 `henira-data://<pluginId>/<mcpServer>/<tool>?args=<URL 编码 JSON>`；只允许同一插件 `mcp/` 里声明过的 server（越权 403）；2 秒共享轮询、30 秒超时、200 × 1024 字符截断；失败保留上次数据；
- `onTurnFinished` 只收该 UI 模块自己发起那一轮的终稿；终局映射见 [plugins.md](./plugins.md) §4；
- `openInExplorer` 是能力查询：非桌面宿主返回 `false`，UI 模块应自行降级；
- `renderMarkdown` 的返回类型由宿主决定（protocol 不依赖 React）；非 web 宿主不实现 UI 门面。

## loop（官方插件；对外形状 = LoopService）

- **定稿形状全部在 protocol 段**（2026-11-16）：LoopService / LoopEvent / TurnEndReason / QueuedPrompt；
- 中断纪律五条 + 16ms 合并 = 官方 loop 的实现纪律（P6，测试锁定；16ms = 一帧间隔，UI 工程通行做法）；
- 三缝载荷（[loop.md](./loop.md) §4 定稿）：`loop/pre-step` → PreStepValue / `loop/request` → RequestValue / `loop/turn-stopping` → TurnStoppingValue。

---

_实施时：每个包落码前先把本文件对应小节改成"定稿"并补全签名；发现形状问题就地改此文件（改动记入 ADR 仅当涉及原则层）。_
