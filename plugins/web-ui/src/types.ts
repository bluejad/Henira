// 插件 UI 宿主门面的类型真源（interfaces.md 插件 UI 门面段——D-028：不属于 SlotMap、不是
// 引擎协议；只存在于 web 系宿主）。web 宿主实现之；UI 模块（本包 module）消费之。
// M3 实装子集 + M4 占位语义逐条标注见 interfaces.md。

import type { Disposable } from "@henira/kernel";
import type {
  Decision,
  DirBrowse,
  PromptReceipt,
  ReasoningCapability,
  ReasoningEffort,
  RegisteredDir,
  Row,
  RowsPage,
  ServerFrame,
  SessionState,
  SessionSummary,
  SessionUiState,
  ToolRow,
} from "@henira/protocol";
import type { ReactNode } from "react";

/** 件消费的 client 最小结构面（@henira/sdk 门面的结构子集——插件不依赖宿主包，结构化声明） */
export interface HeniraClientLike {
  createSession(opts?: { cwd?: string }): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  /** opts = 模型/思考按次覆盖（BC 每次提问绑定；缺省回落全局默认） */
  prompt(
    sessionId: string,
    text: string,
    opts?: { modelId?: string; reasoningEffort?: ReasoningEffort },
  ): Promise<PromptReceipt>;
  steer(sessionId: string, entryId: string): Promise<boolean>;
  interrupt(sessionId: string): Promise<void>;
  settleApproval(sessionId: string, requestId: string, decision: Decision): Promise<boolean>;
  events(): AsyncIterable<ServerFrame>;
  /** 界面资产清单（D-059：已装语言包/主题包） */
  listUiAssets(): Promise<UiAssets>;
  /** 设置读（可选——结构同形 sdk SettingsData；凭据永不出现，D-030） */
  getSettings?(): Promise<{ version: 1; model?: string; ui?: { theme?: string; locale?: string } }>;
  /** 设置写（可选——输入卡模型选择器消费；程序写面） */
  putSettings?(patch: {
    model?: string;
    ui?: { theme?: string; locale?: string };
  }): Promise<{ version: 1 }>;
  /** 模型目录（可选——手写覆盖 + models.dev 快照清单；无密钥；reasoning=思考能力提示） */
  listModels?(): Promise<{
    providers: Record<
      string,
      { baseUrl?: string; models?: string[]; reasoning?: ReasoningCapability }
    >;
  }>;
  /** 服务商密钥写（可选——设置弹窗·模型管理页消费；D-030：只进 credentials.json，永不回读） */
  putCredential?(provider: string, key: string): Promise<void>;
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
}

/** 行 store 最小结构面（哑渲染器的数据源：快照整体替换 + 增量；断档不猜纪律在 client） */
export interface RowStoreLike {
  /** 当前会话的行与状态；引用稳定（未变化时返回同一对象——useSyncExternalStore 语义）；
   *  hasOlder/totalRows = 快照窗口字段（长会话翻页依据，老宿主缺省 false） */
  getSession(sessionId: string | null): {
    rows: readonly Row[];
    state: SessionState;
    hasOlder?: boolean;
    totalRows?: number;
  };
  subscribe(cb: () => void): Disposable;
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

/** 官方件承重缝（interfaces.md web 段定稿）：件 + 会话上下文一起给 */
export interface WebPartContext {
  client: HeniraClientLike;
  sessionId: string | null; // 当前会话（null = 未选中）
  selectSession(sessionId: string | null): void; // 切会话（会话列表 → 宿主状态）
  t: (key: string) => string; // D-050 locale 取字（缺 key fail-loud；D-059 语言包覆盖优先、回落 zh）
  /** 主题 id：官方 light/dark 或已装主题包名（D-059） */
  theme: string;
  store: RowStoreLike; // 流式增量从哪来
  host: PluginUiHost;
  /** 槽位只读视图（区域槽 + 行级 keyed 槽，D-057）：官方默认件不在表内——未被顶替时生效 */
  slots: ReadonlyMap<string, readonly SlotPart[]>;
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
  /** 主题切换（设置弹窗主题页；第三方主题包带 cssUrl 由宿主注入 <link>，D-059） */
  onTheme?(next: string, cssUrl?: string): void;
  /** 语言包切换（设置弹窗语言页；undefined 字典 = 回官方 zh） */
  onLocale?(dict: Record<string, string> | undefined, localeId: string): void;
  /** 设置弹窗开合：宿主持有状态——openSettings 请求开（指定分区，缺省主题页），
   * settingsSection 为当前开着的分区（null = 关闭）；两者缺席 = 宿主未实装弹窗 */
  openSettings?(section?: SettingsSection): void;
  closeSettings?(): void;
  settingsSection?: SettingsSection | null;
}

export type WebPart = (ctx: WebPartContext) => ReactNode;

/** keyed 工具卡视图（tool.call.view.<工具名>，D-057）：件拿得到行数据（工具名/参数/输出/状态） */
export type ToolCallView = (args: { ctx: WebPartContext; row: ToolRow }) => ReactNode;

/** 槽位件联合：区域槽/追加位 = WebPart；keyed 工具卡 = ToolCallView（消费侧按槽种收窄） */
export type SlotPart = WebPart | ToolCallView;

/** 宿主槽位词表·区域级（D-033 三名 + D-062 结构性两名：layout 整页框架槽 / sidebar.right 右栏；
 * 追加位与行级槽走开放 string 名，不在此联合里）；未装件的槽位收起 */
export type WebSlotName = "layout" | "sidebar" | "conversation" | "composer" | "sidebar.right";

/** 设置弹窗分区（弹窗只列现有三项——用户裁定 2026-11-18：主题/语言/模型管理） */
export type SettingsSection = "theme" | "locale" | "models";

/** 整页布局选项（D-043 挑件语义，宿主 createWebApp opts.layout 同形）：
 * 预置三态（full=三栏 / center=对话+输入 / composer=只输入）或显式零件表 */
export type LayoutOption =
  | "full"
  | "center"
  | "composer"
  | { parts: Partial<Record<WebSlotName, WebPart>> };

export interface UiModuleContext {
  /** 追挂（append）到该槽位；name 按宿主词表校验（D-033 区域词表 + D-057 keyed 前缀词表） */
  registerSlot(name: string, part: SlotPart, opts?: { order?: number }): Disposable;
  /** 替换该区域 / keyed 槽的官方默认件（D-043 / D-057）；同 key 冲突报错（D-022 同款） */
  replaceSlot(name: string, part: SlotPart): Disposable;
  host: PluginUiHost;
}

/** UI 模块拿到的宿主门面（M3 实装子集；useResource / listPlugins 为 M4 占位——返回 M4 语义值） */
export interface PluginUiHost {
  sendPrompt(text: string): Promise<{ messageId: string | null; sessionId: string }>;
  /** 行词表帧流（ServerFrame，D-042 双向事件流：opt-in、有界队列背压） */
  subscribe(filter: { sessionId?: string }, cb: (e: ServerFrame) => void): Disposable;
  onTurnFinished(cb: (result: { ok: boolean; text?: string; reason?: string }) => void): Disposable;
  prefill(input: { text: string }): void;
  renderMarkdown(text: string, opts?: { streaming?: boolean }): ReactNode;
  getSession(): { sessionId: string; cwd: string } | null;
  openInExplorer(path: string): Promise<boolean>; // 仅桌面宿主；其他宿主恒 false
  openPlugin(id: string, view?: unknown): void;
  getInitialView(): unknown;
  listDir(
    path: string,
  ): Promise<{ name: string; kind: "file" | "dir"; size?: number; mtime?: number }[]>;
  listSessionsByCwd(
    cwd: string,
  ): Promise<{ id: string; cwd: string; title?: string; updatedAt: number }[]>;
  useResource(address: string): { status: "failed"; error: string }; // ⏳ M4 占位（plugin-mcp）
  listPlugins(filter?: { category?: string }): Promise<never[]>; // ⏳ M4 占位（插件管理面随 M4）
}
