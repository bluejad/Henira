// 类型化门面（interfaces.md kernel 段"类型化门面在 protocol"）：插件作者用这个，
// 不直接用未类型化的 HarnessContext.get。kernel 不认识任何业务接口（D-012②），
// 本文件仅以类型引用 kernel 机制形状（依赖规则 1，packages.md）。

import type { HarnessContext } from "@reins/kernel";
import type { ApprovalService } from "./approval.js";
import type { ConfigService } from "./config.js";
import type { InteractionService } from "./interaction.js";
import type { LlmService } from "./llm.js";
import type { LoopService } from "./loop.js";
import type { SessionService } from "./services.js";
import type { ToolsService } from "./tools.js";

/** 槽位名 → 服务类型。commands 槽随 plugin-commands 落码（M6）进入（D-025） */
export interface SlotMap {
  session: SessionService;
  llm: LlmService;
  tools: ToolsService;
  approval: ApprovalService;
  loop: LoopService;
  interaction: InteractionService;
  config: ConfigService;
}

export type ReinsContext = Omit<HarnessContext, "get"> & {
  get<K extends keyof SlotMap>(slot: K): SlotMap[K];
};

/** 未类型化 → 类型化：运行时零开销（同一对象，类型收窄） */
export function asReinsContext(ctx: HarnessContext): ReinsContext {
  return ctx as ReinsContext;
}
