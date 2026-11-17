// 官方 session 插件的 ServiceDefinition 壳（packages.md plugins/session：占 'session' 槽）。
// 实现本体 = 本包 store / derive / fork / service（契约与实现同包，D-049）；
// 目录布局归宿主 / data-directory.md（D-014），插件只认显式目录。
// 校验器注册随包导入生效（index.ts 顶部对 validators.js 的副作用导入，session.md §3）。

import type { ServiceDefinition } from "@henira/kernel";
import "./validators.js"; // 官方 15 变体随本包装载注册进开放注册表（session.md §3）——插件自足，不走 index 也在场
import { createSession, type SessionHandle } from "./service.js";

export interface SessionPluginOptions {
  /** 会话目录（data-directory.md 布局；装配方决定，宿主 / 示例各自传入） */
  directory: string;
  /** 会话 cwd（SessionHeader.cwd） */
  cwd: string;
  /** 会话 id（宿主指定身份——目录名 / 账本 header.id / 注册表键三方一致；缺省 store 自生成） */
  id?: string;
  /** 云端归属（D-036）：部署时写入的用户标识，本地缺省 */
  user?: string;
}

/** 占 'session' 槽的官方插件定义（官方预设条目；与社区插件同一条公共注册路径，P8） */
export function sessionPlugin(options: SessionPluginOptions): ServiceDefinition<SessionHandle> {
  return {
    name: "session",
    async start() {
      // kernel 在 start 返回后把返回值发布为槽位值（interfaces.md kernel 段）
      return createSession({
        dir: options.directory,
        cwd: options.cwd,
        id: options.id,
        user: options.user,
      });
    },
    async stop(svc) {
      // stop 只收服务自身资源：文件锁与句柄（interfaces.md kernel 段两条约定）
      await svc.close();
    },
  };
}
