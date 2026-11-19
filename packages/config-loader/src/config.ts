// ConfigService 实现（D-013②：宿主实现；llm / approval 不直接读 env 或文件）。
// 三文件：settings.json（界面写）/ permissions.json（规则，D-030 可手改）/ credentials.json
// （0600，D-030：凭据只住这里，永不进事件 / 日志 / 模型上下文）；models.json = 手写覆盖字典（D-040）。

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ConfigService,
  ModelConfig,
  PermissionRule,
  SessionAttachment,
} from "@henira/protocol";
import { Dictionary, type ModelsOverrideFile } from "./dictionary.js";

export class CredentialMissingError extends Error {
  constructor(providerId: string) {
    super(
      `no credential for provider "${providerId}" (add it to config/credentials.json, mode 0600)`,
    );
    this.name = "CredentialMissingError";
  }
}

export class NoDefaultModelError extends Error {
  constructor() {
    super("no default model configured (set model in settings.json or pass an explicit id)");
    this.name = "NoDefaultModelError";
  }
}

export interface ConfigLoaderOptions {
  /** 项目 cwd（会话工作区） */
  cwd: string;
  /** 全局配置目录（缺省 ~/.henira/config；测试注入临时目录） */
  globalDir: string;
  /** 测试注入 fetch（undefined = 不拉取，快照/缓存兜底） */
  fetchImpl?: typeof fetch;
}

interface SettingsFile {
  version?: number;
  model?: string;
  plugins?: Record<
    string,
    {
      enabled?: boolean;
      version?: string;
      /** 确认卡记录（批 C：engine 件首次生效 / 版本升级需用户确认） */
      confirmedVersion?: string;
      options?: Record<string, unknown>;
    }
  >;
  ui?: { theme?: string };
}

interface CredentialsFile {
  providers?: Record<string, string>;
}

function splitModelId(id: string): { provider: string; model: string } {
  const idx = id.indexOf("/");
  if (idx <= 0) throw new Error(`model id "${id}" must be "<provider>/<model>"`);
  return { provider: id.slice(0, idx), model: id.slice(idx + 1) };
}

export interface HeniraConfigService extends ConfigService {
  /** 运行时拉取 models.dev（成功写缓存；失败静默回落快照/缓存，D-040） */
  refreshDictionary(): Promise<boolean>;
}

export function createConfigService(opts: ConfigLoaderOptions): HeniraConfigService {
  const dictionary = new Dictionary(opts.globalDir, opts.fetchImpl);
  let loaded = false;

  async function readJson<T>(file: string): Promise<T | undefined> {
    try {
      return JSON.parse(await fs.readFile(path.join(opts.globalDir, file), "utf8")) as T;
    } catch {
      return undefined; // 文件缺失 / 损坏按缺省走（配置不是事实源）
    }
  }

  const load = async (): Promise<void> => {
    if (loaded) return;
    await dictionary.loadCache();
    loaded = true;
  };

  const service: HeniraConfigService = {
    cwd: opts.cwd,

    async model(id?: string): Promise<ModelConfig> {
      await load();
      const settings = await readJson<SettingsFile>("settings.json");
      const modelId = id ?? settings?.model;
      if (modelId === undefined) throw new NoDefaultModelError();
      const { provider, model } = splitModelId(modelId);
      const overrides = await readJson<ModelsOverrideFile>("models.json");
      const providerOverride = overrides?.providers?.[provider];
      const modelOverride = providerOverride?.models?.[model];
      const capabilities = dictionary.lookup(provider, model);
      return {
        provider,
        model,
        baseUrl: modelOverride?.baseUrl ?? providerOverride?.baseUrl,
        contextWindow: modelOverride?.contextWindow ?? capabilities.contextWindow,
        maxOutputTokens: modelOverride?.maxOutputTokens ?? capabilities.maxOutputTokens,
        reasoningOptions: capabilities.reasoningOptions,
        interleaved: capabilities.interleaved,
      };
    },

    async credential(providerId) {
      const credentials = await readJson<CredentialsFile>("credentials.json");
      const key = credentials?.providers?.[providerId];
      if (key === undefined) throw new CredentialMissingError(providerId);
      return key;
    },

    async get<T>(key: string): Promise<T | undefined> {
      const settings = await readJson<SettingsFile>("settings.json");
      return settings?.plugins?.[key]?.options as T | undefined;
    },

    async permissionRules(): Promise<readonly PermissionRule[]> {
      const file = await readJson<{ rules?: unknown[] }>("permissions.json");
      const rules = file?.rules ?? [];
      const valid: PermissionRule[] = [];
      for (const rule of rules) {
        const r = rule as Partial<PermissionRule>;
        if (
          typeof r.match?.tool === "string" &&
          (r.decision === "allow" || r.decision === "deny")
        ) {
          valid.push({ match: r.match, decision: r.decision });
        }
        // 非法条目静默跳过（可手改文件——坏行不该炸会话；规则错了补审计没有意义）
      }
      return valid;
    },

    async refreshDictionary() {
      await load();
      return dictionary.refresh();
    },
  };
  return service;
}

/** attachments 校验入口（session.md §2.2 宿主入口统一校验：单文件 20MB / 图片 5MB / 总量 50MB / 个数 ≤100） */
export const ATTACHMENT_LIMITS = {
  fileBytes: 20_000_000,
  imageBytes: 5_000_000,
  totalBytes: 50_000_000,
  count: 100,
};

export function validateAttachments(
  attachments: readonly SessionAttachment[],
  sizes: readonly number[],
): void {
  if (attachments.length > ATTACHMENT_LIMITS.count)
    throw new Error(`attachments exceed ${ATTACHMENT_LIMITS.count}`);
  let total = 0;
  attachments.forEach((a, i) => {
    const size = sizes[i] ?? 0;
    total += size;
    const cap =
      a.mime?.startsWith("image/") === true
        ? ATTACHMENT_LIMITS.imageBytes
        : ATTACHMENT_LIMITS.fileBytes;
    if (size > cap) throw new Error(`attachment "${a.path}" exceeds ${cap} bytes`);
  });
  if (total > ATTACHMENT_LIMITS.totalBytes)
    throw new Error(`attachments exceed ${ATTACHMENT_LIMITS.totalBytes} bytes total`);
}
