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

export async function writeSettings(
  globalDir: string,
  patch: { model?: string; ui?: { theme?: string; locale?: string } },
): Promise<SettingsFile> {
  const current = (await readSettings(globalDir)) ?? { version: 1 as const };
  const next: SettingsFile = {
    ...current,
    ...patch,
    version: 1, // 恒为 1：调用方改不动版本位
    ui: { ...current.ui, ...patch.ui },
  };
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
  return next;
}

export async function writeCredential(
  globalDir: string,
  providerId: string,
  key: string,
): Promise<void> {
  const file = path.join(globalDir, "credentials.json");
  let current: { providers?: Record<string, string> } = {};
  try {
    current = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    // 首次写入
  }
  const next = { providers: { ...current.providers, [providerId]: key } };
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600).catch(() => {}); // Windows 尽力而为
}
