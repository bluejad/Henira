// UI 模块入口（真插件的公共注册路径形态，D-043）：web 宿主装载本模块 → 本模块经
// UiModuleContext 把官方件挂进槽位。安全模式 = 宿主不装载本模块、直接用编译期出口的件
// 渲染默认组合（同一零件库，两条通道）。替换语义：其他 UI 模块可 replaceSlot 顶掉官方件。
// 框架件（D-062）：LayoutFrame 占 layout 整页框架槽、同一注册声明子槽（声明 = 独占渲染权，
// dsh AppFrame 行为层）；RightPanel 为 sidebar.right 官方默认件（tab 框架）。
// per-tool 卡（E5）：官方自己也走 keyed 注册（dsh ui-tool 行为层）——defaultToolViews 的
// 键 = 完整 keyed 名，插件 replaceSlot("tool.call.view.<工具名>") 顶替、卸载回落官方；
// "tool.call.view.mcp" 是 MCP 工具总缝（动态 wire 名无法逐个注册，ToolRowView 前缀路由）。

import type { Disposable } from "@henira/kernel";
import { ApprovalCard } from "./parts/approval-card.js";
import { Composer } from "./parts/composer.js";
import { approvalTakeover, ComposerDock, questionTakeover } from "./parts/composer-dock.js";
import { Conversation } from "./parts/conversation.js";
import { LayoutFrame } from "./parts/layout-frame.js";
import { ModelSeat } from "./parts/model-seat.js";
import { QueueDock } from "./parts/queue-dock.js";
import { RightPanel } from "./parts/right-panel.js";
import { SessionList } from "./parts/session-list.js";
import {
  AskUserCard,
  EditCard,
  GlobCard,
  GrepCard,
  McpCard,
  ReadCard,
  TerminalCard,
  WriteCard,
} from "./parts/tool-cards.js";
import type {
  ApprovalCardView,
  ChainEntry,
  SlotPart,
  ToolCallView,
  UiModuleContext,
  WebPart,
  WebSlotName,
} from "./types.js";

/** 槽位 → 官方件映射（默认组合只是一种排列——D-043 第 8 条；区域级五名各有官方默认件）
 * R182：composer 座位 = ComposerDock（chain 接管路由 + fallback composer.bar）。 */
export const defaultParts: Record<WebSlotName, WebPart> = {
  layout: LayoutFrame,
  sidebar: SessionList,
  conversation: Conversation,
  composer: ComposerDock,
  "sidebar.right": RightPanel,
};

/** 输入座位子槽（R182）：composer.bar = 常驻输入栏（chain fallback；接管时保持挂载） */
export const defaultComposerBar: WebPart = Composer;

/** 输入座位四席（R183）：model 单槽（官方模型+思考席）、dock 列表（官方排队面板）。
 *  left/right 官方空——只给插件追加。 */
export const defaultComposerSeats: Record<string, WebPart> = {
  "composer.model": ModelSeat,
  "composer.dock": QueueDock,
};

/** chain 槽官方条目（R182）：composer.takeover = 接管选举；审批与提问（R184）两个官方条目 */
export const defaultChainEntries: Record<string, ChainEntry[]> = {
  "composer.takeover": [questionTakeover, approvalTakeover],
};

/** keyed 工具卡 → 官方默认件（E5，D-057 全语义闭环：官方自己消费自己开的缝）。
 * 键 = 完整 keyed 名；官方注册后可被插件 replaceSlot 顶替、卸载自动回落（同 D-048）。 */
export const defaultToolViews: Record<string, ToolCallView> = {
  "tool.call.view.bash": TerminalCard,
  "tool.call.view.powershell": TerminalCard,
  "tool.call.view.edit": EditCard,
  "tool.call.view.write": WriteCard,
  "tool.call.view.read": ReadCard,
  "tool.call.view.glob": GlobCard,
  "tool.call.view.grep": GrepCard,
  "tool.call.view.ask_user": AskUserCard,
  "tool.call.view.mcp": McpCard,
};

/** keyed 审批卡 → 官方默认件（E6，D-057 延伸：词表 10→11，approval.view.<工具名>）。
 * 同一通用卡组件（内部 per-tool 预览路由）真实注册进八键——非代码级 fallback；插件
 * replaceSlot 顶替、卸载回落通用卡（R163 slot-registry 语义直接复用）。 */
export const defaultApprovalViews: Record<string, ApprovalCardView> = Object.fromEntries(
  ["bash", "powershell", "edit", "write", "read", "glob", "grep", "mcp"].map((n) => [
    `approval.view.${n}`,
    ApprovalCard as ApprovalCardView,
  ]),
);

/** UI 模块装载入口：把官方件注册进宿主槽位；返回卸载函数 */
export function webUiModule(ctx: UiModuleContext): Disposable {
  const disposables: Disposable[] = [];
  for (const [name, part] of Object.entries(defaultParts) as [WebSlotName, WebPart][]) {
    disposables.push(ctx.registerSlot(name, part));
  }
  for (const [name, view] of Object.entries(defaultToolViews)) {
    disposables.push(ctx.registerSlot(name, view as SlotPart));
  }
  for (const [name, view] of Object.entries(defaultApprovalViews)) {
    disposables.push(ctx.registerSlot(name, view as SlotPart));
  }
  // R182：输入座位子槽 + 接管 chain 条目（官方同走公共注册路径；第三方顶替/卸载回落）
  disposables.push(ctx.registerSlot("composer.bar", defaultComposerBar));
  // R183：四席官方默认件（model 单槽认领、dock 列表；left/right 官方空）
  for (const [name, part] of Object.entries(defaultComposerSeats)) {
    disposables.push(ctx.registerSlot(name, part));
  }
  for (const [name, entries] of Object.entries(defaultChainEntries)) {
    for (const entry of entries) {
      disposables.push(ctx.registerChainSlot(name, entry));
    }
  }
  return () => {
    for (const dispose of disposables) dispose();
  };
}
