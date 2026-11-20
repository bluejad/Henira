// UI 模块入口（真插件的公共注册路径形态，D-043）：web 宿主装载本模块 → 本模块经
// UiModuleContext 把官方件挂进槽位。安全模式 = 宿主不装载本模块、直接用编译期出口的件
// 渲染默认组合（同一零件库，两条通道）。替换语义：其他 UI 模块可 replaceSlot 顶掉官方件。
// 框架件（D-062）：LayoutFrame 占 layout 整页框架槽、同一注册声明子槽（声明 = 独占渲染权，
// dsh AppFrame 行为层）；RightPanel 为 sidebar.right 官方默认件（tab 框架）。
// per-tool 卡（E5）：官方自己也走 keyed 注册（dsh ui-tool 行为层）——defaultToolViews 的
// 键 = 完整 keyed 名，插件 replaceSlot("tool.call.view.<工具名>") 顶替、卸载回落官方；
// "tool.call.view.mcp" 是 MCP 工具总缝（动态 wire 名无法逐个注册，ToolRowView 前缀路由）。

import type { Disposable } from "@henira/kernel";
import { Composer } from "./parts/composer.js";
import { Conversation } from "./parts/conversation.js";
import { LayoutFrame } from "./parts/layout-frame.js";
import { RightPanel } from "./parts/right-panel.js";
import { SessionList } from "./parts/session-list.js";
import {
  EditCard,
  GlobCard,
  GrepCard,
  McpCard,
  ReadCard,
  TerminalCard,
  WriteCard,
} from "./parts/tool-cards.js";
import type { SlotPart, ToolCallView, UiModuleContext, WebPart, WebSlotName } from "./types.js";

/** 槽位 → 官方件映射（默认组合只是一种排列——D-043 第 8 条；区域级五名各有官方默认件） */
export const defaultParts: Record<WebSlotName, WebPart> = {
  layout: LayoutFrame,
  sidebar: SessionList,
  conversation: Conversation,
  composer: Composer,
  "sidebar.right": RightPanel,
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
  "tool.call.view.mcp": McpCard,
};

/** UI 模块装载入口：把官方件注册进宿主槽位；返回卸载函数 */
export function webUiModule(ctx: UiModuleContext): Disposable {
  const disposables: Disposable[] = [];
  for (const [name, part] of Object.entries(defaultParts) as [WebSlotName, WebPart][]) {
    disposables.push(ctx.registerSlot(name, part));
  }
  for (const [name, view] of Object.entries(defaultToolViews)) {
    disposables.push(ctx.registerSlot(name, view as SlotPart));
  }
  return () => {
    for (const dispose of disposables) dispose();
  };
}
