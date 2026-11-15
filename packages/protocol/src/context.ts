// 类型化门面（interfaces.md kernel 段"类型化门面在 protocol"）：插件作者用这个，
// 不直接用未类型化的 HarnessContext.get。kernel 不认识任何业务接口（D-012②），
// 本文件仅以类型引用 kernel 机制形状（依赖规则 1，packages.md）。

import type { HarnessContext } from "@reins/kernel";
import type { SessionService } from "./services.js";

/** 槽位名 → 服务类型。随各服务契约定稿扩项（packages.md 能力服务表），不封顶 */
export interface SlotMap {
  session: SessionService;
}

export type ReinsContext = Omit<HarnessContext, "get"> & {
  get<K extends keyof SlotMap>(slot: K): SlotMap[K];
};

/** 未类型化 → 类型化：运行时零开销（同一对象，类型收窄） */
export function asReinsContext(ctx: HarnessContext): ReinsContext {
  return ctx as ReinsContext;
}
