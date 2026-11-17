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
}

/** 行 store 最小结构面（哑渲染器的数据源：快照整体替换 + 增量；断档不猜纪律在 client） */
export interface RowStoreLike {
  /** 当前会话的行与状态；引用稳定（未变化时返回同一对象——useSyncExternalStore 语义） */
  getSession(sessionId: string | null): { rows: readonly Row[]; state: SessionState };
  subscribe(cb: () => void): Disposable;
}

/** 官方件承重缝（interfaces.md web 段定稿）：件 + 会话上下文一起给 */
export interface WebPartContext {
  client: HeniraClientLike;
  sessionId: string | null; // 当前会话（null = 未选中）
  selectSession(sessionId: string | null): void; // 切会话（会话列表 → 宿主状态）
  t: (key: string) => string; // D-050 locale 取字（缺 key fail-loud）
  theme: "light" | "dark";
  store: RowStoreLike; // 流式增量从哪来
  host: PluginUiHost;
}

export type WebPart = (ctx: WebPartContext) => ReactNode;

/** 宿主槽位词表（D-033：name 按当前宿主词表校验）；未装件的槽位收起 */
export type WebSlotName = "sidebar" | "conversation" | "composer";

export interface UiModuleContext {
  /** 追挂（append）到该槽位 */
  registerSlot(name: WebSlotName, part: WebPart, opts?: { order?: number }): Disposable;
  /** 替换该槽位默认件（D-043）；同区冲突报错（D-022 同款） */
  replaceSlot(name: WebSlotName, part: WebPart): Disposable;
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
  listDir(path: string): Promise<{ name: string; kind: "file" | "dir"; size?: number; mtime?: number }[]>;
  listSessionsByCwd(cwd: string): Promise<{ id: string; cwd: string; title?: string; updatedAt: number }[]>;
  useResource(address: string): { status: "failed"; error: string }; // ⏳ M4 占位（plugin-mcp）
  listPlugins(filter?: { category?: string }): Promise<never[]>; // ⏳ M4 占位（插件管理面随 M4）
}
