// plugin-fs：fs 服务件（interfaces.md §fs 契约小节 / D-065）。
// 文件能力 + 路径围栏（D-049 围栏跟着能力走）：围栏强制点唯一住本服务——
// 注入者（官方工具件 / 第三方引擎件）一律经同一份守卫；不注册任何工具（工具件在
// fs-tools / fs-search）。读态（read-before-mutate 守卫）按会话内存持有，随服务生命周期消亡。

import type { ServiceDefinition } from "@henira/kernel";
import { asHeniraContext, type FsService } from "@henira/protocol";
import { createCapabilities, ReadState } from "./capabilities.js";
import { createFence } from "./fence.js";
import { createSearch } from "./search.js";

export { FsError } from "./fence.js";

/** 官方 plugin-fs 工厂（占 'fs' 槽；inject config 取会话 cwd 作围栏根——D-049 服务件形状） */
export function fsPlugin(): ServiceDefinition<FsService> {
  return {
    name: "fs",
    inject: ["config"],
    start(ctx) {
      const config = asHeniraContext(ctx).get("config");
      const fence = createFence(config.cwd);
      const readState = new ReadState();
      const capabilities = createCapabilities({ fence, readState });
      const search = createSearch({ fence });
      const service: FsService = {
        resolve: (p) => fence.resolve(p),
        read: capabilities.read,
        write: capabilities.write,
        edit: capabilities.edit,
        glob: search.glob,
        grep: search.grep,
      };
      return service;
    },
  };
}
