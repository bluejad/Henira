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
    {
      enabled?: boolean;
      version?: string;
      /** 确认卡记录（批 C：engine 件首次生效 / 版本升级需用户确认，未确认 = 不装载） */
      confirmedVersion?: string;
      options?: Record<string, unknown>;
    }
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

/** 深合并单个插件设置（enabled/version/confirmedVersion）——管理面与确认卡写入口 */
export async function setPluginSetting(
  globalDir: string,
  id: string,
  patch: {
    enabled?: boolean;
    version?: string;
    confirmedVersion?: string;
    options?: Record<string, unknown>;
  },
): Promise<SettingsFile> {
  const current = (await readSettings(globalDir)) ?? { version: 1 as const };
  const plugins = { ...current.plugins, [id]: { ...current.plugins?.[id], ...patch } };
  return writeSettings(globalDir, { plugins });
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

/** 已连接厂商 id 清单（模型管理页分组依据）。D-030：只出 id——key 值永不离开本进程 */
export async function listCredentialProviders(globalDir: string): Promise<string[]> {
  try {
    const file = JSON.parse(
      await fs.readFile(path.join(globalDir, "credentials.json"), "utf8"),
    ) as { providers?: Record<string, string> };
    return Object.keys(file.providers ?? {});
  } catch {
    return [];
  }
}

/** 断开厂商：credentials.json 摘除条目（值从不回读，只摘键）；无该条目 = 幂等 */
export async function removeCredential(globalDir: string, providerId: string): Promise<void> {
  const file = path.join(globalDir, "credentials.json");
  let current: { providers?: Record<string, string> } = {};
  try {
    current = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return; // 文件不存在 = 无可摘
  }
  if (current.providers?.[providerId] === undefined) return;
  const providers = { ...current.providers };
  delete providers[providerId];
  await atomicWrite(file, `${JSON.stringify({ providers }, null, 2)}\n`);
}

/** 手写覆盖字典（models.json）宿主侧读写——模型管理面（连接/开关/自定义厂商）落盘处 */
export interface ModelsFile {
  providers?: Record<
    string,
    {
      label?: string;
      baseUrl?: string;
      /** 显式模型清单（自定义厂商；快照厂商缺省 = 走快照全表） */
      models?: Record<string, { label?: string }>;
      /** 选择器隐藏清单（开关关 = 进这里；缺 = 全显） */
      hidden?: string[];
    }
  >;
}

export async function readModelsFile(globalDir: string): Promise<ModelsFile> {
  try {
    return JSON.parse(await fs.readFile(path.join(globalDir, "models.json"), "utf8")) as ModelsFile;
  } catch {
    return {};
  }
}

export async function writeModelsFile(globalDir: string, file: ModelsFile): Promise<void> {
  await atomicWrite(path.join(globalDir, "models.json"), `${JSON.stringify(file, null, 2)}\n`);
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
}
