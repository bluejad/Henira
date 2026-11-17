// 插件 UI 宿主门面的类型真源（interfaces.md 插件 UI 门面段——D-028：不属于 SlotMap、不是
// 引擎协议；只存在于 web 系宿主）。web 宿主实现之；UI 模块（本包 module）消费之。
// M3 实装子集 + M4 占位语义逐条标注见 interfaces.md。

import type { Disposable } from "@henira/kernel";
import type {
  Decision,
  PromptReceipt,
  Row,
  ServerFrame,
  SessionState,
  SessionSummary,
  ToolRow,
} from "@henira/protocol";
import type { ReactNode } from "react";

/** 件消费的 client 最小结构面（@henira/sdk 门面的结构子集——插件不依赖宿主包，结构化声明） */
export interface HeniraClientLike {
  createSession(opts?: { cwd?: string }): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  prompt(sessionId: string, text: string): Promise<PromptReceipt>;
  steer(sessionId: string, entryId: string): Promise<boolean>;
  interrupt(sessionId: string): Promise<void>;
  settleApproval(sessionId: string, requestId: string, decision: Decision): Promise<boolean>;
  events(): AsyncIterable<ServerFrame>;
  /** 界面资产清单（D-059：已装语言包/主题包） */
  listUiAssets(): Promise<UiAssets>;
}

/** 行 store 最小结构面（哑渲染器的数据源：快照整体替换 + 增量；断档不猜纪律在 client） */
export interface RowStoreLike {
  /** 当前会话的行与状态；引用稳定（未变化时返回同一对象——useSyncExternalStore 语义） */
  getSession(sessionId: string | null): { rows: readonly Row[]; state: SessionState };
  subscribe(cb: () => void): Disposable;
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
}

export type WebPart = (ctx: WebPartContext) => ReactNode;

/** keyed 工具卡视图（tool.call.view.<工具名>，D-057）：件拿得到行数据（工具名/参数/输出/状态） */
export type ToolCallView = (args: { ctx: WebPartContext; row: ToolRow }) => ReactNode;

/** 槽位件联合：区域槽/追加位 = WebPart；keyed 工具卡 = ToolCallView（消费侧按槽种收窄） */
export type SlotPart = WebPart | ToolCallView;

/** 宿主槽位词表（D-033：name 按当前宿主词表校验）；未装件的槽位收起 */
export type WebSlotName = "sidebar" | "conversation" | "composer";

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
  renderMarkdown(text: string): ReactNode;
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
