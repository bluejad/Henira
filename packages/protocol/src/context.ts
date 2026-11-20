// 类型化门面（interfaces.md kernel 段"类型化门面在 protocol"）：插件作者用这个，
// 不直接用未类型化的 HarnessContext.get。kernel 不认识任何业务接口（D-012②），
// 本文件仅以类型引用 kernel 机制形状（依赖规则 1，packages.md）。

import type { HarnessContext } from "@henira/kernel";
import type { ApprovalService } from "./approval.js";
import type { ConfigService } from "./config.js";
import type { FsService } from "./fs.js";
import type { InteractionService } from "./interaction.js";
import type { LlmService } from "./llm.js";
import type { LoopService } from "./loop.js";
import type { McpService, SessionService } from "./services.js";
import type { ShellService } from "./shell.js";
import type { ToolsService } from "./tools.js";

/** 槽位名 → 服务类型。commands 槽随 plugin-commands 落码（M6）进入（D-025）；
 *  mcp 槽随 plugin-mcp 落码进入（D-064）；fs / shell 槽随批 B 落码进入（D-065） */
export interface SlotMap {
  session: SessionService;
  llm: LlmService;
  tools: ToolsService;
  approval: ApprovalService;
  loop: LoopService;
  interaction: InteractionService;
  config: ConfigService;
  mcp: McpService;
  fs: FsService;
  shell: ShellService;
}

export type HeniraContext = Omit<HarnessContext, "get"> & {
  get<K extends keyof SlotMap>(slot: K): SlotMap[K];
};

/** 未类型化 → 类型化：运行时零开销（同一对象，类型收窄） */
export function asHeniraContext(ctx: HarnessContext): HeniraContext {
  return ctx as HeniraContext;
}
