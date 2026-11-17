// settings.json 读取（装配三步③：enabled 过滤；与 server 各自实现——规则 3 禁宿主互依）。
// 缺失 / 损坏按缺省走（配置不是事实源）。

import { promises as fs } from "node:fs";
import path from "node:path";

export interface SettingsFile {
  version: 1;
  model?: string;
  plugins?: Record<
    string,
    { enabled?: boolean; version?: string; options?: Record<string, unknown> }
  >;
  ui?: { theme?: string; locale?: string };
}

export function isPluginEnabled(settings: SettingsFile | undefined, id: string): boolean {
  // 缺 key = 启用，显式 false 才停用（data-directory §2.3）
  return settings?.plugins?.[id]?.enabled !== false;
}

export async function readSettings(globalDir: string): Promise<SettingsFile | undefined> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(globalDir, "settings.json"), "utf8"),
    ) as SettingsFile;
  } catch {
    return undefined;
  }
}
