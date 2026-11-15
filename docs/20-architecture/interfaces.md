# 关键接口形状（TS 签名草案）

> 各包对外 API 的**形状级草案**——定方向不锁细节，实施时在此文件同步演进。
> 状态：**kernel 段、config-loader 段与插件 UI 门面已定稿**（2026-11-12）；其余小节仍为形状级草案。

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
    fn: (value: T, next: (v: T) => Promise<T>) => Promise<T>,
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
  commands: CommandService;
  interaction: InteractionService;
  config: ConfigService;
}
type ReinsContext = Omit<HarnessContext, "get"> & {
  get<K extends keyof SlotMap>(slot: K): SlotMap[K];
};
function asReinsContext(ctx: HarnessContext): ReinsContext;
```

## protocol —— 契约（槽位接口 + 事件词表 + DTO）

> **最小化规则（D-013③）**：protocol 只放"两个插件必须达成一致的东西"——槽位接口、事件信封与词表、跨插件 DTO；不放便利类型、不放单插件内部类型、不放产品概念。新增类型先回答"谁和谁必须一致？"，答不出就不进。

```ts
// 槽位接口（D-012②：全部在 protocol，kernel 不认识它们）
type SessionEventInput = { type: string; data: unknown; ignorable?: boolean };

interface SessionService {
  header(): SessionHeader;                                  // 文件第 1 行的不可变身份（含 version）
  append(input: SessionEventInput): Promise<SessionEvent>;   // 校验 → 分配 seq → 追加 → fsync
  events(): readonly SessionEvent[];
  deriveMessages(): ModelMessage[];                          // 应用 surfaceOp 后的模型历史
  fork(atSeq?: number): Promise<SessionService>;             // 复制前缀；半回合切点补 turn/end{forked}
  replay(visitor: (e: SessionEvent) => void | Promise<void>): Promise<void>;
}

interface LlmService {
  prepareCall(config: ModelConfig): PreparedCall;   // 能力探测产物：contextWindow 等
  stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

interface ToolsService {
  register(tool: ToolDefinition): Disposable;
  project(filter?: ToolFilter): WireToolSchema[];   // 模型可见清单（声明式过滤）
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolOutcome>;
}

type Decision = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

// 审批策略（D-013①：只管规则与 fail-closed，不碰 UI）
interface ApprovalService {
  requestPermission(req: PermissionRequest, signal?: AbortSignal): Promise<Decision>;
}

// 交互通道（D-013①）：引擎所在进程的宿主实现（①=server；③=cli / sdk 嵌入方，sdk 自带缺省实现；测试用 mock），approval 与工具经它触达用户
type InteractionRequest =
  | { kind: 'approval'; requestId: string; toolName: string; args: unknown; reason?: string }
  | { kind: 'question'; requestId: string; questions: Question[] };

type InteractionAnswer =
  | { kind: 'approval'; requestId: string; decision: Decision }
  | { kind: 'question'; requestId: string; answers: string[][] };

interface InteractionService {
  ask(req: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer>;
  settle(requestId: string, answer: InteractionAnswer): boolean;  // 幂等，先答者赢
  listPending(): readonly InteractionRequest[];                    // 断线 / 刷新重放
}

// 配置面（D-013②）：宿主实现；llm / approval 不直接读 env 或文件
interface ConfigService {
  readonly cwd: string;
  model(id?: string): ModelConfig;                 // 只含能力字段（contextWindow 等），不含密钥
  credential(providerId: string): Promise<string>; // 仅 llm 适配器调用
  get<T>(key: string): T | undefined;              // 插件自有配置段（settings.json plugins.<id>.options
                                                   //  与项目 reins.config.ts options 合并，项目优先）
}

interface LoopService {
  run(prompt: string, signal?: AbortSignal): AsyncIterable<LoopEvent>;
  send(prompt: string): Promise<void>;          // 排队（回合运行中）
  interrupt(signal?: AbortSignal): Promise<void>;
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

// StreamEvent：封闭判别联合（不变量见 P3）
type StreamEvent =
  | { type: 'text-delta';      text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call';       callId: string; name: string; argsText: string }  // 恒为原始 JSON
  | { type: 'usage';           usage: TokenUsage }                               // 先于 finish
  | { type: 'finish';          reason: FinishReason };

// 事件注册表：开放 map（P1）
const SessionEventRegistry: Map<string, ZodSchema>;   // 官方注册基础变体，插件可追加
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
export const defaultPreset: PluginEntry[];   // 官方 21 个插件；想基于默认改 = import 后 spread,
                                             // 不设 add/remove 补丁语法（TS 代码即补丁机制）
export const bundledSkillDirs: string[];     // 官方随包技能目录清单（D-026，读者按清单扫）

// ── 项目根目录 reins.config.ts（开发者手写，进 git；普通用户不碰）──
//   import { defaultPreset } from '@reins/config-loader';
//   export default defineConfig({ plugins: [...defaultPreset, myPlugin] })
defineConfig(cfg: ReinsConfig): ReinsConfig;   // 纯类型辅助，零运行时逻辑

interface ReinsConfig {
  model?: string;                      // 本项目固定模型（缺省听全局 settings.json）
  plugins?: PluginEntry[];             // 基础插件清单；缺省 = defaultPreset
  options?: Record<string, unknown>;   // 本项目插件参数（键 = 插件 id）；项目优先于全局
}

// ── 全局 ~/.reins/config/settings.json（界面上点、程序写、不进 git，见 data-directory.md §2.3）──
//   { version, model?, plugins?: { <id>: { enabled?, version?, options? } }, ui?: { theme? } }
//
// 装配三步（每个新会话执行，D-016）：
//   ① 基础清单 = cfg.plugins ?? defaultPreset
//   ② 加已装目录里的插件（~/.reins/plugins/ 与项目 .reins/plugins/；同 id 不重复算，同名项目盖用户级；
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

loadConfig(root: string): Promise<ReinsConfig>;          // 读 reins.config.ts + settings.json + 最小校验
applyConfig(harness: Harness, cfg: ReinsConfig): void;   // 翻译成 .use() 调用
```

## tools / approval（官方插件实现，签名经槽位接口暴露）

```ts
function defineTool(def: ToolDefinition): ToolDefinition;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema; // 裸 JSON Schema（D-044：协议唯一形状——模型投影 / MCP tools/list / AI 创建同形零转换；装载期校验，非法 → 插件跳过 + 告警）
  isConcurrencySafe?: boolean;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
// ToolResult 带 __ 前缀带外通道（P4）：__meta 等由 loop 路由，不进模型上下文
// 官方插件直写 JSON Schema（dsh 同款），不建转换糖；execute 入参不靠 schema 推导 TS 类型（松散 args + 引擎校验 + 工具测试钉）
```

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

## sdk —— 双形态客户端

```ts
// 形态一：进程内（CLI / 测试 / 嵌入）——聚合插件后暴露统一门面
function createRuntime(opts: RuntimeOptions): Promise<ReinsRuntime>;

// 形态二：远程（Web / 跨进程）
class ReinsClient {
  constructor(baseUrl: string);
  sessions(): SessionCollection;
  watch(sessionId: string): AsyncIterable<ServerEvent>; // SSE
  settleApproval(sessionId: string, requestId: string, d: Decision): Promise<void>;
}
```

## web —— 正式宿主（可嵌入界面，D-037 / D-038）

```ts
// 界面从外部注入 client；web 自身的宿主用法 = 注入同源（本地 server）client 的特例。
// npm 用户 = @reins/sdk（client）+ @reins/web（界面）两包组合；所有 web 系宿主都说 server 协议（D-034①）。
// layout 挑件（D-043 第 7 条概要，落码时定稿）：完全体（缺省）/ 只中间对话区 / 只输入框 / 自定义组合——
// 零件 = plugin-web-ui 的件（会话列表 / 对话面板 / 输入框 / 审批卡…），与插件用件同一零件库（编译期出口）。
function createWebApp(opts: {
  client: ReinsClient;
  layout?: "full" | "center" | "composer" | ComponentSpec[]; // 不传 = 完全体
}): WebApp;

interface WebApp {
  mount(el: HTMLElement): void;
  dispose(): Promise<void>;
}
```

形状级草案，落码前定稿；不 eval（D-021）。**web 界面自第一行代码起按"可拆组件 + 槽位组合"组织，默认组合只是一种排列（D-043 第 8 条，首发约束）**。插件界面挂载与宿主门面（13 方法）见下节。

## 插件 UI 宿主门面（web 系宿主实现，D-028）

> **不属于 `SlotMap`，不是引擎协议**；只存在于 web / desktop / 云端网页 / 手机网页。TUI 与 headless 没有插件 UI，不实现该门面。UI 模块与宿主同源，**不是安全边界**（D-021）。

```ts
interface UiModuleContext {
  registerSlot(name: string, component: unknown, opts?: { order?: number }): Disposable; // 追挂（append）；name 按当前宿主词表校验（D-033）
  replaceSlot(name: string, component: unknown): Disposable; // 替换该区域默认件（D-043）；同区冲突报错（D-022 同款）
  host: PluginUiHost;
}

interface PluginUiHost {
  // 对话：发起仍单口 sendPrompt；接收 = 双向事件流（D-042：订阅 opt-in、增量可并、终局必达）
  sendPrompt(text: string): Promise<TurnReceipt>;
  subscribe(filter: EventFilter, cb: (e: SessionEvent) => void): Disposable;
  //   EventFilter = { types?: string[]; turnId?: string } —— 本会话事件流，有界队列背压
  onTurnFinished(receipt: TurnReceipt, cb: (result: TurnResult) => void): Disposable; // 恰一次（自己发起回合的便捷终局）
  prefill(input: { chip?: string; text: string }): void; // 只回填不发送
  renderMarkdown(text: string, opts?: { highlight?: boolean }): unknown; // web 宿主返回 React 元素

  // 数据
  useResource(address: string): ResourceSnapshot; // React hook 语义：仅 render 期调用
  listPlugins(filter?: { category?: string }): Promise<PluginInfo[]>;
  listDir(path: string): Promise<DirEntry[]>; // 只限会话工作区；隐藏项不返
  listSessionsByCwd(cwd: string): Promise<SessionRef[]>;

  // 宿主
  getSession(): { sessionId: string; cwd: string } | null;
  openInExplorer(path: string): Promise<boolean>; // 仅桌面宿主；其他宿主返回 false
  openPlugin(id: string, view?: unknown): void;
  getInitialView(): unknown; // 读后即焚、按插件隔离
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
  slotKinds?: string[]; // 已识别槽位类型（skills / commands / hooks / mcp / agents / ui）
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

- 官方界面件（会话列表 / 对话面板 / 输入框 / 审批卡…）经**宿主标准件出口**供插件 import（import map，与 react 同口子，D-043）；件与**会话上下文**一起给——连着哪个会话、往哪发、流式增量从哪来（承重缝，形状 M3 定稿）；没装东西的区域槽**收起**（不渲染不占宽）；
- `useResource` 地址格式 `reins-data://<pluginId>/<mcpServer>/<tool>?args=<URL 编码 JSON>`；只允许同一插件 `mcp/` 里声明过的 server（越权 403）；2 秒共享轮询、30 秒超时、200 KB 截断；失败保留上次数据；
- `onTurnFinished` 只收该 UI 模块自己发起那一轮的终稿；终局映射见 [plugins.md](./plugins.md) §4；
- `openInExplorer` 是能力查询：非桌面宿主返回 `false`，UI 模块应自行降级；
- `renderMarkdown` 的返回类型由宿主决定（protocol 不依赖 React）；非 web 宿主不实现 UI 门面。

## loop（官方插件；对外形状 = LoopService）

```ts
// run() 产出的 LoopEvent（经 16ms 合并后发出）：
type LoopEvent =
  | { type: 'text-delta'; … }
  | { type: 'tool-started'; … }
  | { type: 'tool-finished'; … }
  | { type: 'approval-requested'; … }
  | { type: 'turn-ended'; reason: TurnEndReason }
  | { type: 'error'; … };
// 中断纪律五条 + 16ms 合并 = 官方 loop 的实现纪律（P6，测试锁定）
```

---

_实施时：每个包落码前先把本文件对应小节改成"定稿"并补全签名；发现形状问题就地改此文件（改动记入 ADR 仅当涉及原则层）。_
