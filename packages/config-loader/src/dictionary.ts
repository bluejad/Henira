// 模型参数字典（D-040）：models.dev 快照兜底（构建时修剪入库）+ 运行时拉取 + 本地缓存 +
// 手写覆盖字典（config 目录 models.json）。引擎零网络零厂商表（P9-4）——同步只住本层。

import { promises as fs } from "node:fs";
import path from "node:path";
import snapshotJson from "./models-dev-snapshot.json" with { type: "json" };

const MODELS_DEV_URL = "https://models.dev/api.json";

/** 修剪后的快照条目（快照即形状；运行时拉取按同形收录） */
export interface DictionaryProvider {
  id: string;
  name?: string;
  models: Record<string, { name?: string; contextWindow?: number; maxOutputTokens?: number }>;
}

/** 手写覆盖字典（config 目录 models.json；用户可编辑，优先于快照 / 缓存） */
export interface ModelsOverrideFile {
  providers?: Record<
    string,
    {
      baseUrl?: string;
      models?: Record<
        string,
        { contextWindow?: number; maxOutputTokens?: number; baseUrl?: string }
      >;
    }
  >;
}

/** 构建时修剪入库的兜底快照（models.dev api.json，字段收敛到所需三项） */
export const SNAPSHOT: Record<string, DictionaryProvider> = snapshotJson as unknown as Record<
  string,
  DictionaryProvider
>;

export class Dictionary {
  #providers: Record<string, DictionaryProvider>;
  readonly #cacheFile: string;
  readonly #fetchImpl: typeof fetch | undefined;

  constructor(cacheDir: string | undefined, fetchImpl?: typeof fetch) {
    this.#providers = { ...SNAPSHOT };
    this.#cacheFile = cacheDir === undefined ? "" : path.join(cacheDir, "models-dev-cache.json");
    this.#fetchImpl = fetchImpl;
  }

  /** 启动装载：本地缓存（上次拉取成功的结果）覆盖快照 */
  async loadCache(): Promise<void> {
    if (this.#cacheFile === "") return;
    try {
      const raw = await fs.readFile(this.#cacheFile, "utf8");
      const cached = JSON.parse(raw) as Record<string, DictionaryProvider>;
      this.#providers = { ...this.#providers, ...cached };
    } catch {
      // 无缓存 = 首次运行，快照兜底（D-040：断网可用）
    }
  }

  /** 运行时拉取（成功 → 更新内存 + 写缓存；失败 → 静默保持现状——快照/缓存兜底，不打扰会话） */
  async refresh(): Promise<boolean> {
    if (this.#fetchImpl === undefined) return false;
    try {
      const response = await this.#fetchImpl(MODELS_DEV_URL);
      if (!response.ok) return false;
      const raw = (await response.json()) as Record<string, Record<string, unknown>>;
      const fresh: Record<string, DictionaryProvider> = {};
      for (const [providerId, provider] of Object.entries(raw)) {
        const models = (provider.models ?? {}) as Record<
          string,
          { limit?: { context?: number; output?: number }; name?: string }
        >;
        const collected: DictionaryProvider["models"] = {};
        for (const [modelId, model] of Object.entries(models)) {
          collected[modelId] = {
            name: model.name,
            contextWindow: model.limit?.context,
            maxOutputTokens: model.limit?.output,
          };
        }
        if (Object.keys(collected).length > 0) {
          fresh[providerId] = { id: providerId, models: collected };
        }
      }
      this.#providers = { ...this.#providers, ...fresh };
      if (this.#cacheFile !== "") {
        await fs.mkdir(path.dirname(this.#cacheFile), { recursive: true });
        await fs.writeFile(this.#cacheFile, JSON.stringify(fresh));
      }
      return true;
    } catch {
      return false; // 断网 / 限流：静默回落（P2 观测由调用方决定是否记事件）
    }
  }

  /** 查询：<provider> 的模型能力（含手写覆盖前的字典视图） */
  lookup(provider: string, model: string): { contextWindow?: number; maxOutputTokens?: number } {
    const entry = this.#providers[provider]?.models[model];
    return {
      contextWindow: entry?.contextWindow,
      maxOutputTokens: entry?.maxOutputTokens,
    };
  }
}
