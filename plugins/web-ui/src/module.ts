// UI 模块入口（真插件的公共注册路径形态，D-043）：web 宿主装载本模块 → 本模块经
// UiModuleContext 把官方件挂进槽位。安全模式 = 宿主不装载本模块、直接用编译期出口的件
// 渲染默认组合（同一零件库，两条通道）。替换语义：其他 UI 模块可 replaceSlot 顶掉官方件。
// 框架件（D-062）：LayoutFrame 占 layout 整页框架槽、同一注册声明子槽（声明 = 独占渲染权，
// dsh AppFrame 行为层）；RightPanel 为 sidebar.right 官方默认件（tab 框架）。

import type { Disposable } from "@henira/kernel";
import { Composer } from "./parts/composer.js";
import { Conversation } from "./parts/conversation.js";
import { LayoutFrame } from "./parts/layout-frame.js";
import { RightPanel } from "./parts/right-panel.js";
import { SessionList } from "./parts/session-list.js";
import type { UiModuleContext, WebPart, WebSlotName } from "./types.js";

/** 槽位 → 官方件映射（默认组合只是一种排列——D-043 第 8 条；区域级五名各有官方默认件） */
export const defaultParts: Record<WebSlotName, WebPart> = {
  layout: LayoutFrame,
  sidebar: SessionList,
  conversation: Conversation,
  composer: Composer,
  "sidebar.right": RightPanel,
};

/** UI 模块装载入口：把官方件注册进宿主槽位；返回卸载函数 */
export function webUiModule(ctx: UiModuleContext): Disposable {
  const disposables: Disposable[] = [];
  for (const [name, part] of Object.entries(defaultParts) as [WebSlotName, WebPart][]) {
    disposables.push(ctx.registerSlot(name, part));
  }
  return () => {
    for (const dispose of disposables) dispose();
  };
}
