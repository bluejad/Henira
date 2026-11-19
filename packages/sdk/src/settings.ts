// settings.json 读取（装配三步③：enabled 过滤；与 server 各自实现——规则 3 禁宿主互依）。
// 缺失 / 损坏按缺省走（配置不是事实源）。

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
      /** 确认卡记录（批 C：engine 件首次生效 / 版本升级需用户确认） */
      confirmedVersion?: string;
      /** MCP 变更确认记录（D-030/D-064：mcp/*.json 内容指纹，不符 = 不 spawn） */
      mcpFingerprint?: string;
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
    return undefined;
  }
}

export async function writeSettings(
  globalDir: string,
  patch: {
    model?: string;
    ui?: { theme?: string; locale?: string };
    plugins?: SettingsFile["plugins"];
  },
): Promise<SettingsFile> {
  const current = (await readSettings(globalDir)) ?? { version: 1 as const };
  const next: SettingsFile = {
    ...current,
    ...patch,
    version: 1, // 恒为 1：调用方改不动版本位
    plugins: patch.plugins ?? current.plugins,
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

/** 已连接厂商 id 清单（模型管理分组依据）。D-030：只出 id——key 值永不离开本进程 */
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
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ providers }, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

/** 手写覆盖字典（models.json）——与 server settings-store.ts 同形（规则 3 禁宿主互依，各自实现） */
export interface ModelsFile {
  providers?: Record<
    string,
    {
      label?: string;
      baseUrl?: string;
      models?: Record<string, { label?: string }>;
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
  const target = path.join(globalDir, "models.json");
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await fs.rename(tmp, target);
}

/** 深合并单个插件设置（enabled/version/confirmedVersion；与 server 同构各自实现——规则 3） */
export async function setPluginSetting(
  globalDir: string,
  id: string,
  patch: {
    enabled?: boolean;
    version?: string;
    confirmedVersion?: string;
    mcpFingerprint?: string;
    options?: Record<string, unknown>;
  },
): Promise<void> {
  const current = (await readSettings(globalDir)) ?? { version: 1 as const };
  const plugins = { ...current.plugins, [id]: { ...current.plugins?.[id], ...patch } };
  await writeSettings(globalDir, { plugins });
}

/** 凭据值表（进程内消费：MCP 声明 `${credential:名}` 展开的唯一来源，D-064；与 server 同语义）。
 *  D-030：返回值只进内存、只进 spawn env / 远程 headers——永不进日志 / 响应体 / 账本。 */
export async function readCredentialValues(globalDir: string): Promise<Record<string, string>> {
  try {
    const file = JSON.parse(
      await fs.readFile(path.join(globalDir, "credentials.json"), "utf8"),
    ) as { providers?: Record<string, string> };
    return { ...(file.providers ?? {}) };
  } catch {
    return {};
  }
}
