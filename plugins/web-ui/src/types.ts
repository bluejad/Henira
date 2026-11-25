// 插件 UI 宿主门面的类型真源（interfaces.md 插件 UI 门面段——D-028：不属于 SlotMap、不是
// 引擎协议；只存在于 web 系宿主）。web 宿主实现之；UI 模块（本包 module）消费之。
// M3 实装子集 + M4 占位语义逐条标注见 interfaces.md。

import type { Disposable } from "@henira/kernel";
import type {
  ApprovalRow,
  Decision,
  DirBrowse,
  PermissionMode,
  PermissionProjectsView,
  PermissionProjectView,
  PermissionRule,
  PermissionRulesView,
  PermissionSnapshot,
  PreviewKind,
  PreviewOpenMode,
  PreviewOpenSettings,
  PromptReceipt,
  QuestionAnswer,
  QuestionRow,
  ReasoningCapability,
  ReasoningEffort,
  ReasoningOption,
  RegisteredDir,
  Row,
  RowsPage,
  ServerFrame,
  SessionState,
  SessionSummary,
  SessionUiState,
  ToolRow,
  WorkspaceFileContent,
} from "@henira/protocol";
import type { ReactNode } from "react";

/** 件消费的 client 最小结构面（@henira/sdk 门面的结构子集——插件不依赖宿主包，结构化声明） */
export interface HeniraClientLike {
  createSession(opts?: { cwd?: string }): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  /** opts = 模型/思考/权限按次覆盖（每次提问绑定；缺省回落全局默认）+ steer=true 忙时插话入队 */
  prompt(
    sessionId: string,
    text: string,
    opts?: {
      steer?: boolean;
      modelId?: string;
      reasoningEffort?: ReasoningEffort;
      permissionMode?: PermissionMode;
    },
  ): Promise<PromptReceipt>;
  steer(sessionId: string, entryId: string): Promise<boolean>;
  /** 立即发送（抢占式：停止当前回合并以该条开新回合；可选——旧嵌入方缺省时面板立即发送钮禁用） */
  promoteQueueEntry?(sessionId: string, entryId: string): Promise<boolean>;
  /** 删除排队条目（排队卡行级操作；可选——旧嵌入方缺省时面板删除钮禁用） */
  removeQueueEntry?(sessionId: string, entryId: string): Promise<boolean>;
  /** 恢复中断冻结的队列冲刷（可选——旧嵌入方缺省时「继续发送」钮禁用） */
  resumeQueue?(sessionId: string): Promise<boolean>;
  interrupt(sessionId: string): Promise<void>;
  /** 轮尾分叉（可选，E4）：按账本 seq 前缀复制出新会话，返回子会话 id；宿主缺方法 = 轮尾 fork 钮不渲染 */
  fork?(sessionId: string, atSeq?: number): Promise<string>;
  /** scope:'session'/'project' = 允许范围（E6/R198：decided{scope,rule} 落账 → 同命令免 ask）；
   *  feedback（D-087）= 拒绝说明，仅 decision:"rejected" 时有效 */
  settleApproval(
    sessionId: string,
    requestId: string,
    decision: Decision,
    scope?: "session" | "project",
    feedback?: string,
  ): Promise<boolean>;
  /** 权限规则快照（可选，R198——旧宿主缺省时权限菜单不显示允许区） */
  sessionPermissions?(sessionId: string): Promise<PermissionSnapshot>;
  /** 撤销本会话允许（可选，R198/R199；回合之外也可；opts 缺省 = 清空） */
  revokeSessionApprovals?(
    sessionId: string,
    opts?: { tool?: string; rule?: PermissionRule },
  ): Promise<void>;
  /** 项目清单（可选，R199——旧宿主缺省时设置页隐藏规则管理区） */
  permissionProjects?(sessionId?: string): Promise<PermissionProjectsView>;
  /** 单项目规则文件视图（可选，R199） */
  projectPermissions?(id: string): Promise<PermissionProjectView>;
  /** 删除项目规则（可选，R199；返回删除条数） */
  removeProjectPermissionRule?(id: string, rule: PermissionRule): Promise<number>;
  /** 全局规则文件视图（可选，R199） */
  globalPermissions?(): Promise<PermissionRulesView>;
  /** 删除全局规则（可选，R199；返回删除条数） */
  removeGlobalPermissionRule?(rule: PermissionRule): Promise<number>;
  /** 提问收答（可选，R184）：answers 逐题或 {cancelled:true}；宿主缺方法 = 提问卡提交禁用
   *  （旧嵌入方） */
  settleQuestion?(
    sessionId: string,
    requestId: string,
    answer: readonly QuestionAnswer[] | { cancelled: true },
  ): Promise<boolean>;
  events(): AsyncIterable<ServerFrame>;
  /** 界面资产清单（D-059：已装语言包/主题包） */
  listUiAssets(): Promise<UiAssets>;
  /** 设置读（可选——结构同形 sdk SettingsData；凭据永不出现，D-030） */
  getSettings?(): Promise<{
    version: 1;
    model?: string;
    /** 新会话默认权限模式（D-080） */
    permissionMode?: PermissionMode;
    ui?: { theme?: string; locale?: string; preview?: PreviewOpenSettings };
  }>;
  /** 设置写（可选——输入卡模型选择器/外观页/权限页消费；程序写面） */
  putSettings?(patch: {
    model?: string;
    permissionMode?: PermissionMode;
    ui?: { theme?: string; locale?: string; preview?: PreviewOpenSettings };
  }): Promise<{ version: 1 }>;
  /** 模型目录（可选——key+baseUrl 齐备的厂商才出现；条目带显示名/徽章位，模型目录收敛批） */
  listModels?(): Promise<{ providers: ModelCatalog }>;
  /** 服务商密钥写（可选——设置弹窗·模型管理页消费；D-030：只进 credentials.json，永不回读） */
  putCredential?(provider: string, key: string): Promise<void>;
  /** 模型管理分组（可选——连接态/显隐开关/上下文窗；宿主缺方法 = 管理分组不渲染，留默认模型页） */
  listProviders?(): Promise<{
    providers: Array<{
      id: string;
      name?: string;
      baseUrl?: string;
      reasoning?: ReasoningCapability;
      connected: boolean;
      models: Array<{ id: string; name?: string; contextWindow?: number; enabled: boolean }>;
    }>;
  }>;
  /** 厂商选择页预设全表（可选——快照+缓存字典视图；无密钥） */
  listModelPresets?(): Promise<{
    presets: Record<
      string,
      { name?: string; models: Record<string, { name?: string; contextWindow?: number }> }
    >;
  }>;
  /** 在线刷新模型目录（可选——失败保留快照/缓存现状） */
  refreshModelPresets?(): Promise<{ ok: boolean }>;
  /** 连接已知厂商（可选——key 必填；D-030 只进 credentials.json） */
  connectProvider?(providerId: string, key: string): Promise<void>;
  /** 断开厂商（可选——摘凭据 + models.json 目录条目；幂等） */
  disconnectProvider?(providerId: string): Promise<void>;
  /** 模型显隐开关（可选——开 = 移出 hidden 清单，关 = 加入） */
  setModelEnabled?(providerId: string, model: string, enabled: boolean): Promise<void>;
  /** 自定义 OpenAI 兼容厂商（可选——显式 models 清单 + baseUrl；返回生成 id） */
  putCustomProvider?(input: {
    label?: string;
    baseUrl: string;
    key?: string;
    models: Array<{ model: string; label?: string }>;
  }): Promise<{ id: string }>;
  /** 登记工作目录列表（可选——侧栏目录区消费，data-directory §4；宿主缺方法 = 目录登记交互不渲染） */
  listDirs?(): Promise<RegisteredDir[]>;
  /** 登记工作目录（可选——校验：绝对路径+存在+是目录；非法抛错） */
  addDir?(cwd: string): Promise<RegisteredDir>;
  /** 删登记目录（可选——该 cwd 全部会话+登记条目；盘上工作目录不动；busy 抛错） */
  deleteDir?(id: string): Promise<void>;
  /** 全局目录浏览一层（可选——新增目录弹窗数据源；path 缺省 homedir，__drives__ = 盘符根） */
  browseDirs?(path?: string): Promise<DirBrowse>;
  /** 删单个会话（可选——账本目录整棵；busy 抛错） */
  deleteSession?(id: string): Promise<void>;
  /** 行翻页（可选——长会话历史前插；宿主缺方法 = 不渲染「加载更早」，静态窗口） */
  sessionRows?(sessionId: string, opts?: { before?: number; limit?: number }): Promise<RowsPage>;
  /** 插件清单（可选——设置弹窗插件页数据源；批 C：状态 enabled≠loaded + 指纹；C5 起 mcp 槽信息） */
  listPlugins?(): Promise<{
    plugins: Array<{
      id: string;
      version: string;
      name: string;
      /** 来源（R188 起；旧服务器缺省 = 按内核五件 id 表回落判定） */
      source?: "official" | "managed";
      description?: string;
      forms: Array<"engine" | "ui" | "content">;
      enabled: boolean;
      state: "loaded" | "disabled" | "failed" | "awaiting-confirm";
      reason?: string;
      mcp?: Array<{ name: string; target: string; confirmed: boolean }>;
      warnings: string[];
    }>;
    fingerprint: string;
  }>;
  /** 确认卡放行（可选——engine 件首次生效/版本升级） */
  confirmPlugin?(id: string, version: string): Promise<void>;
  /** MCP 变更确认放行（可选——D-030/D-064：mcp/*.json 首次连接或变更后） */
  confirmPluginMcp?(id: string): Promise<void>;
  /** 插件启停（可选——官方件拒绝；新会话生效） */
  setPluginEnabled?(id: string, enabled: boolean): Promise<void>;
  /** 插件版本钉（可选——官方件拒绝；新会话生效） */
  setPluginVersion?(id: string, version: string): Promise<void>;
  /** 卸载插件（可选——删 plugins/<id>；plugins-data 保留；官方件拒绝） */
  removePlugin?(id: string): Promise<void>;
}

/** 行 store 最小结构面（哑渲染器的数据源：快照整体替换 + 增量；断档不猜纪律在 client） */
export interface RowStoreLike {
  /** 当前会话的行与状态；引用稳定（未变化时返回同一对象——useSyncExternalStore 语义）；
   *  hasOlder/totalRows = 快照窗口字段（长会话翻页依据，老宿主缺省 false） */
  getSession(sessionId: string | null): {
    rows: readonly Row[];
    state: SessionState;
    /** 会话标题（服务端快照派生，缺省 = 尚无用户消息） */
    title?: string;
    hasOlder?: boolean;
    totalRows?: number;
  };
  subscribe(cb: () => void): Disposable;
  /** 会话是否已有已投影数据（宿主可选；缺省按 rows 非空推断——空态首帧不闪） */
  has?(sessionId: string): boolean;
  /** 历史前插（loadOlder）：页行按 rowSeq 过滤+去重后前插；无新行返回 false（可选——宿主缺 = 不翻页） */
  mergeOlderRows?(sessionId: string, page: readonly Row[]): boolean;
}

/** 界面资产（D-059 语言包/主题包清单）——与 sdk/config-loader 的 UiAssets 结构同形（结构化声明，
 *  插件不依赖宿主层包） */
export interface UiAssetLocale {
  pluginId: string;
  version: string;
  lang: string;
  url: string;
}
export interface UiAssetTheme {
  pluginId: string;
  version: string;
  name: string;
  url: string;
}
export interface UiAssets {
  locales: UiAssetLocale[];
  themes: UiAssetTheme[];
}

/** 目录模型条目（listModels 的 providers[p].models[]；模型选择器与设置页共用，R186 去重） */
export interface CatalogModel {
  id: string;
  name?: string;
  contextWindow?: number;
  vision?: boolean;
  reasoning?: boolean;
  /** 思考档位集合真源（models.dev reasoning_options：toggle/effort 值——2026-11-19 思考档批） */
  reasoningOptions?: ReasoningOption[];
}

/** 目录厂商条目（provider 级 reasoning = 厂商能力表；选择器只消费 name/baseUrl/models） */
export interface CatalogProvider {
  name?: string;
  baseUrl?: string;
  reasoning?: ReasoningCapability;
  models?: CatalogModel[];
}

/** 模型目录快照（listModels 的 providers 面，types 与件共用命名；R183 从内联形状提出） */
export type ModelCatalog = Record<string, CatalogProvider>;

/** 输入座位 API（R183，dsh owner props 行为层）：ComposerDock 构造、注入 composer.* 子树。
 *  草稿/焦点/按次模型绑定/审批回调的唯一真源——座位件（model/left/right/dock）不各自私存，
 *  第三方件同一入口拿同一份语义。草稿持久化走 ctx.updateUiState（D-063 会话级）。 */
export interface ComposerApi {
  readonly sessionId: string | null;
  readonly draft: string;
  /** 写草稿：本地态 + 会话级 uiState 双写（宿主持有） */
  setDraft(text: string): void;
  /** 焦点回输入框（bar 已挂载时；接管/座位按钮用） */
  focus(): void;
  readonly busy: boolean;
  /** 无历史（占位/空态判定；座位件可用） */
  readonly isEmpty: boolean;
  readonly sendFailed: boolean;
  readonly model: string;
  /** 按次模型绑定（会话级记忆；全局默认归设置弹窗·模型管理页） */
  setModel(next: string): void;
  readonly effort: ReasoningEffort | null;
  setEffort(next: ReasoningEffort): void;
  /** 生效的权限模式（D-080：显式会话记忆优先，缺省 = settings 新会话默认，兜底 ask）。
   *  权限 chip 显示与发送携带都用它 */
  readonly permission: PermissionMode;
  /** 切换权限模式：本地态 + 会话级 uiState 记忆（D-080；完全访问确认卡由 chip 件负责） */
  setPermission(next: PermissionMode): void;
  /** 目录快照（composer.model 席消费；设置内写操作广播后由运行时重拉） */
  readonly catalog: ModelCatalog;
  /** 宿主模型/设置方法齐备（缺 = 模型席不渲染控件） */
  readonly settingsReady: boolean;
  /** 发送：缺省用当前草稿；steer=true 忙时插话入队（E1）。失败回填草稿并置 sendFailed */
  submit(text?: string, opts?: { steer?: boolean }): void;
  stop(): void;
  readonly pendingApproval: ApprovalRow | undefined;
  /** 审批队列计数（接管卡「1/N」；第三方 takeover 条目同源 owner 字段） */
  readonly approvalQueueTotal: number;
  /** 提问面（R184）：未答提问队首（chain owner 同源；提问压过审批显示） */
  readonly pendingQuestion: QuestionRow | undefined;
  /** 提问队列计数（同 approvalQueueTotal 口径） */
  readonly questionQueueTotal: number;
  /** 审批乐观回调（点击即退场 / settle 失败回滚；R171 行为层） */
  onApprovalDecided(requestId: string): void;
  onApprovalFailed(requestId: string): void;
  /** 提问乐观回调（提交/取消即摘卡；settle 失败回滚） */
  onQuestionDecided(requestId: string): void;
  onQuestionFailed(requestId: string): void;
  /** 输入框挂载点登记（bar 调用；focus() 目标）——座位件不必直接调用 */
  registerInput(el: HTMLTextAreaElement | null): void;
}

/** 预览目标（R188）：文件 = 会话行引用（右栏/弹窗共用同一 resolver）；图片 = src。 */
export interface PreviewFileTarget {
  kind: "file";
  /** 绝对路径（弹窗标题/右栏 tab 标签） */
  path: string;
  /** 来源工具行（内容按行 input/output 现场解析，不把文件正文塞进 ui-state） */
  rowId: string;
}
export interface PreviewImageTarget {
  kind: "image";
  src: string;
  alt?: string;
}
export type PreviewTarget = PreviewFileTarget | PreviewImageTarget;

/** 右栏预览 tab / 弹窗目标的载荷形状（R188；R190 起同时是预览缝件的 target）。
 *  kind 前缀固定；文件只存引用（path+rowId），图片存 src+alt。 */
export interface PreviewTabPayload {
  kind: "preview-file" | "preview-image";
  path?: string;
  rowId?: string;
  src?: string;
  alt?: string;
}

/** keyed 预览体参数（sidebar.right.preview.<后缀>，D-057/R190）：件拿得到目标与行数据，
 *  正文按需读取（read() = 会话 + 路径的 workspace 文件读取，不锚定工具行）。 */
export interface PreviewViewArgs {
  ctx: WebPartContext;
  target: PreviewTabPayload;
  /** 归一化扩展名（小写、去点、取最后一段；无扩展名 = ""） */
  ext: string;
  /** store 中按 rowId 找到的事件行（行已翻页出窗 = undefined，正文走 read()） */
  row?: ToolRow;
  read(): Promise<WorkspaceFileContent>;
}

/** keyed 预览体（sidebar.right.preview.<后缀>）：官方兜底体与第三方实现同缝。 */
export type PreviewView = (args: PreviewViewArgs) => ReactNode;

/** 预览 API（宿主注入；官方件与第三方件共用）：open 按设置路由到右栏 tab 或弹窗。 */
export interface PreviewApi {
  readonly settings: Readonly<Required<PreviewOpenSettings>>;
  open(target: PreviewTarget): void;
  setMode(kind: PreviewKind, mode: PreviewOpenMode): void;
  /** 弹窗模式的当前目标（框架件渲染；null = 无弹窗） */
  readonly modal: PreviewTarget | null;
  close(): void;
}

/** 官方件承重缝（interfaces.md web 段定稿）：件 + 会话上下文一起给 */
export interface WebPartContext {
  client: HeniraClientLike;
  sessionId: string | null; // 当前会话（null = 未选中）
  selectSession(sessionId: string | null): void; // 切会话（会话列表 → 宿主状态）
  t: (key: string) => string; // D-050 locale 取字（缺 key fail-loud；D-059 语言包覆盖优先、回落 zh）
  /** 主题 id：官方 light/dark 或已装主题包名（D-059） */
  theme: string;
  /** 当前生效语言 id（官方 zh 或已装语言包 lang，D-059）：显示值跟实际生效走，不读磁盘
   * （磁盘上装不上的旧值不漂移显示——审查 P3-b）；缺席 = 官方 zh */
  locale?: string;
  store: RowStoreLike; // 流式增量从哪来
  host: PluginUiHost;
  /** 槽位只读视图（区域槽 + 行级 keyed 槽，D-057）：官方默认件不在表内——未被顶替时生效 */
  slots: ReadonlyMap<string, readonly SlotPart[]>;
  /** chain 槽只读视图（R182，dsh SlotKind 行为层）：条目按 priority 升序，select 首个命中者当选；
   * 消费侧用 electChain 选举，fallback 保持挂载（overlay 语义由消费件实现） */
  chains: ReadonlyMap<string, readonly ChainEntry[]>;
  /** 输入座位 API（R183）：仅 composer.* 子树由 ComposerDock 注入；其它槽位 undefined。
   *  座位件（composer.model / left / right / dock）经此共享草稿/焦点/按次模型绑定/审批回调 */
  composer?: ComposerApi;
  /** 每会话界面绑定态（D-063）：宿主加载好的当前会话文档；undefined = 未加载 / 宿主未实装 */
  uiState?: SessionUiState;
  /** 界面态写（D-063）：部件只交 patch，宿主顶层合并 + 统一防抖落盘（部件不自己 PUT）；
   * 缺席 = 宿主未实装（件退化为纯内存态） */
  updateUiState?(patch: SessionUiState): void;
  // ── 以下为宿主级关注面（框架件消费；全部可选——宿主缺省 = 对应 UI 不渲染，沿
  //    getSettings feature-detect 先例；packages/web 宿主 createWebApp 全量提供）──
  /** 整页布局选项（D-043 挑件；缺席按 full） */
  layout?: LayoutOption;
  /** 安全模式（徽标显示；双击 Alt 切换由宿主管） */
  safeMode?: boolean;
  /** 当前会话工作目录（中列 header 目录名；null/缺席 = 只显标题占位） */
  sessionCwd?: string | null;
  /** 传输层链路状态（R193；宿主从 client.onLinkState 转接）：reconnecting 持续超过阈值
   *  才显示横幅——模型慢是引擎层另一件事，不在这里表达。缺席 = 宿主未实装（不渲染） */
  linkState?: "connected" | "reconnecting";
  /** 主题切换（设置弹窗主题页；第三方主题包带 cssUrl 由宿主注入 <link>，D-059） */
  onTheme?(next: string, cssUrl?: string): void;
  /** 语言包切换（设置弹窗语言页；undefined 字典 = 回官方 zh） */
  onLocale?(dict: Record<string, string> | undefined, localeId: string): void;
  /** 设置弹窗开合：宿主持有状态——openSettings 请求开（指定分区，缺省主题页），
   * settingsSection 为当前开着的分区（null = 关闭）；两者缺席 = 宿主未实装弹窗 */
  openSettings?(section?: SettingsSection): void;
  closeSettings?(): void;
  settingsSection?: SettingsSection | null;
  /** 模型目录变更广播：设置弹窗内写操作（连接/断开/开关/自定义/目录刷新）成功后调用——
   * 宿主自增 modelCatalogVersion 并重渲，composer 据此**即时**重拉 listModels
   *（断开当场回落，不等设置关闭）。两者缺席 = 宿主无目录缓存语义 */
  notifyModelCatalogChanged?(): void;
  modelCatalogVersion?: number;
  /** 预览打开方式（R188）：缺席 = 旧宿主，官方件保留本地弹窗回退，设置页不显示预览分区 */
  preview?: PreviewApi;
}

export type WebPart = (ctx: WebPartContext) => ReactNode;

/** keyed 工具卡视图（tool.call.view.<工具名>，D-057）：件拿得到行数据（工具名/参数/输出/状态） */
export type ToolCallView = (args: { ctx: WebPartContext; row: ToolRow }) => ReactNode;

/** keyed 审批卡视图（approval.view.<工具名>，E6/D-057 延伸）：件拿得到审批行（toolName/args
 * 完整原样/reason）与队列计数；官方默认件经 module.ts defaultApprovalViews 注册进缝，插件
 * replaceSlot 顶替、卸载回落通用卡 */
export type ApprovalCardView = (args: {
  ctx: WebPartContext;
  row: ApprovalRow;
  queueTotal?: number;
  /** 点击决定发起即调（乐观摘卡——点击即走不等 SSE，R171）。顶替件应接线以与官方件
   * 同行为；settle 失败时调 onDecideFailed 回滚（卡回 dock 可重试）。缺省不接 = 回落
   * 「等 SSE settled」旧行为（不破坏既有顶替件）。 */
  onDecided?: (requestId: string) => void;
  onDecideFailed?: (requestId: string) => void;
}) => ReactNode;

/** 槽位件联合：区域槽/追加位 = WebPart；keyed 工具卡 = ToolCallView；keyed 审批卡 =
 * ApprovalCardView；keyed 预览体 = PreviewView（消费侧按槽种收窄） */
export type SlotPart = WebPart | ToolCallView | ApprovalCardView | PreviewView;

/** chain 槽条目（R182，dsh SlotKind 行为层）：select 纯函数按 owner 判定是否当选
 *（null = 让给下一条）；priority 升序、同值按注册顺序；Component 以组件方式渲染（hooks 合法）。
 * 消费件负责 fallback 挂载与 overlay 隐藏——官方 composer.takeover 的第一个消费者是
 * ComposerDock（审批/提问接管输入座位）。 */
export interface ChainEntry<Owner = unknown, Matched = unknown> {
  /** 条目 id（replaceChainSlot 顶替键；同槽同 id 第三方冲突 D-022 同款） */
  id: string;
  /** 选举优先级：升序、越小越先试；缺省 0 */
  priority?: number;
  select(owner: Owner): Matched | null;
  Component: (props: { ctx: WebPartContext; matched: Matched; owner: Owner }) => ReactNode;
}

/** 宿主槽位词表·区域级（D-033 三名 + D-062 结构性两名：layout 整页框架槽 / sidebar.right 右栏；
 * 追加位与行级槽走开放 string 名，不在此联合里）；未装件的槽位收起 */
export type WebSlotName = "layout" | "sidebar" | "conversation" | "composer" | "sidebar.right";

/** 设置弹窗分区（用户裁定 2026-11-18 四页；D-080 追加权限页） */
export type SettingsSection = "theme" | "locale" | "permission" | "models" | "plugins";

/** 整页布局选项（D-043 挑件语义，宿主 createWebApp opts.layout 同形）：
 * 预置三态（full=三栏 / center=对话+输入 / composer=只输入）或显式零件表 */
export type LayoutOption =
  | "full"
  | "center"
  | "composer"
  | { parts: Partial<Record<WebSlotName, WebPart>> };

export interface UiModuleContext {
  /** 追挂（append）到该槽位；name 按宿主词表校验（D-033 区域词表 + D-057 keyed 前缀词表）。
   *  **single 槽**（R183：`composer.bar` / `composer.model`）= 认领/顶替语义——同一时刻只
   *  一位占用者，卸载回落前件；第二家第三方报冲突。list 槽保持追加（order 排序）。 */
  registerSlot(name: string, part: SlotPart, opts?: { order?: number }): Disposable;
  /** 替换该区域 / keyed 槽的官方默认件（D-043 / D-057）；同 key 已有**其他第三方件**才报错
   * 不装载 ＋ 告警（D-022 同款）——官方默认件可顶替、卸载按登记回落官方 */
  replaceSlot(name: string, part: SlotPart): Disposable;
  /** 追挂 chain 槽条目（R182，dsh SlotKind 行为层）：同槽同 id 已有**其他第三方件**才报错；
   * 官方条目可顶替、卸载按登记回落（replaceChainSlot） */
  registerChainSlot(name: string, entry: ChainEntry, opts?: { priority?: number }): Disposable;
  /** 顶替 chain 槽里指定 id 的条目（官方默认件或空位认领）；卸载按登记回落 */
  replaceChainSlot(
    name: string,
    id: string,
    entry: ChainEntry,
    opts?: { priority?: number },
  ): Disposable;
  host: PluginUiHost;
}

/** 插件清单元信息（PluginUiHost.listPlugins 成功面；批 C） */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
}

/** useResource 数据泵快照（plugins.md §4 / D-064：2s 共享泵；失败保留上次 data） */
export interface ResourceSnapshot {
  status: "loading" | "live" | "failed";
  /** 工具返回文本的 JSON 解析结果（对象/数组；标量不进 data——原文走 text） */
  data?: unknown;
  /** 原文；JSON 解析失败时保留 */
  text?: string;
  error?: string;
  updatedAt?: number;
}

/** UI 门面事件过滤（D-042 / D-085）：types = 行 kind 白名单；turnId 只过滤行帧与 state.updated */
export interface EventFilter {
  sessionId?: string;
  types?: Row["kind"][];
  turnId?: string;
}

/** onTurnFinished 终局（D-028 映射；R202 起只投自己发起回合） */
export type TurnResult =
  | { ok: true; text: string }
  | { ok: false; reason: "interrupted" | "error" | "submit_failed" };

/** UI 模块拿到的宿主门面（M3 实装子集 → C5 起 useResource 实装） */
export interface PluginUiHost {
  sendPrompt(text: string): Promise<{ messageId: string | null; sessionId: string }>;
  /** 行词表帧流（ServerFrame，D-042 双向事件流：opt-in、有界队列背压、终局必达） */
  subscribe(filter: EventFilter, cb: (e: ServerFrame) => void): Disposable;
  onTurnFinished(cb: (result: TurnResult) => void): Disposable;
  prefill(input: { text: string }): void;
  renderMarkdown(text: string, opts?: { streaming?: boolean }): ReactNode;
  /** 代码整段 token 化（差异卡高亮；可选——旧宿主缺 = 纯文本）。返回每行 token */
  tokenizeCode?(
    code: string,
    lang: string,
  ): Promise<Array<Array<{ content: string; color?: string }>> | undefined>;
  getSession(): { sessionId: string; cwd: string } | null;
  openInExplorer(path: string): Promise<boolean>; // 仅桌面宿主；其他宿主恒 false
  openPlugin(id: string, view?: unknown): void;
  getInitialView(): unknown;
  listDir(
    path: string,
  ): Promise<{ name: string; kind: "file" | "dir"; size?: number; mtime?: number }[]>;
  /** 工作区文件读取（R190 预览缝；可选——旧宿主缺 = 预览只能走行快照）。
   *  path 相对当前会话 cwd 或 cwd 内绝对路径。 */
  readWorkspaceFile?(path: string): Promise<WorkspaceFileContent>;
  listSessionsByCwd(
    cwd: string,
  ): Promise<{ id: string; cwd: string; title?: string; updatedAt: number }[]>;
  /** 数据泵（D-064）：地址 henira-data://<pluginId>/<server>/<tool>?args=…；仅限本插件
   *  mcp/ 里声明过的 server（所有权闸，越权返回 failed）；React hook 语义，仅 render 期调用 */
  useResource(address: string): ResourceSnapshot;
  listPlugins(filter?: { category?: string }): Promise<PluginInfo[]>; // 批 C 实装（GET /api/plugins）
}
