// settings.json / credentials.json 的宿主侧读写（data-directory §2 / §8）：
// settings 程序写（界面点出来的落这里）；credentials 只写不读出（D-030——GET 永不回明文，
// 唯一读者是 config-loader 的 ConfigService.credential）。原子重写（tmp+rename，与 session
// 账本同一纪律）；credentials 写后尽力 0600（Windows 无 chmod 语义，尽力而为）。

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
    return undefined; // 缺失 / 损坏按缺省走（配置不是事实源）
  }
}

export async function writeSettings(
  globalDir: string,
  patch: Partial<SettingsFile>,
): Promise<SettingsFile> {
  const current = (await readSettings(globalDir)) ?? { version: 1 as const };
  const next: SettingsFile = {
    ...current,
    ...patch,
    version: 1, // 恒为 1：spread 后钉住，调用方改不动版本位
    plugins: patch.plugins ?? current.plugins,
    ui: { ...current.ui, ...patch.ui },
  };
  await atomicWrite(path.join(globalDir, "settings.json"), `${JSON.stringify(next, null, 2)}\n`);
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
  await atomicWrite(file, `${JSON.stringify(next, null, 2)}\n`);
  await fs.chmod(file, 0o600).catch(() => {}); // Windows 尽力而为
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
}
