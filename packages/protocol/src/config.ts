// config 槽位契约（interfaces.md protocol 段，2026-11-16 定稿）。
// 宿主实现（config-loader）；llm / approval 不直接读 env 或文件（D-013②）。

import type { PermissionRule } from "./approval.js";
import type { ModelConfig } from "./llm.js";

export interface ConfigService {
  readonly cwd: string;
  /** 只含能力字段（contextWindow 等），不含密钥；字典预填、手写覆盖（D-040）；settings 为异步文件读 → Promise */
  model(id?: string): Promise<ModelConfig>;
  /** 仅 llm 适配器调用（D-013②） */
  credential(providerId: string): Promise<string>;
  /** 插件自有配置段（settings.json plugins.<id>.options 与项目合并，项目优先） */
  get<T>(key: string): Promise<T | undefined>;
  /** permissions.json 规则（approval 经此读，tools-approval §3.1） */
  permissionRules(): Promise<readonly PermissionRule[]>;
}
