// UI 模块入口（真插件的公共注册路径形态，D-043）：web 宿主装载本模块 → 本模块经
// UiModuleContext 把官方件挂进槽位。安全模式 = 宿主不装载本模块、直接用编译期出口的件
// 渲染默认组合（同一零件库，两条通道）。替换语义：其他 UI 模块可 replaceSlot 顶掉官方件。

import type { Disposable } from "@henira/kernel";
import { Composer } from "./parts/composer.js";
import { Conversation } from "./parts/conversation.js";
import { SessionList } from "./parts/session-list.js";
import type { UiModuleContext, WebPart, WebSlotName } from "./types.js";

/** 槽位 → 官方件映射（默认组合只是一种排列——D-043 第 8 条） */
export const defaultParts: Record<WebSlotName, WebPart> = {
  sidebar: SessionList,
  conversation: Conversation,
  composer: Composer,
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
