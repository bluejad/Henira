// 模型参数字典（D-040）：models.dev 快照兜底（构建时修剪入库）+ 运行时拉取 + 本地缓存 +
// 手写覆盖字典（config 目录 models.json）。引擎零网络零厂商表（P9-4）——同步只住本层。
// 2026-11-19 模型目录收敛批：厂商层补 endpoint（models.dev 原始 api 字段——旧管线裁掉它
// 逼用户手写 baseUrl）+ 模型层补 vision/reasoning 徽章位；缓存改自有形状 model-presets.json
//（{fetchedAt, providers} 信封 + 2 空格缩进——用户目录文件必须人眼可读）；旧 models-dev-cache
// .json 无 endpoint，读到即删不迁移（refresh 会带回全量）。
// 2026-11-19 思考档批：模型层再补 reasoningOptions（models.dev reasoning_options——档位集合
// 真源）与 interleaved（思维链回传字段）——上次这两字段被剪掉是继 endpoint 之后第二次「最后一米」。

import { promises as fs } from "node:fs";
import path from "node:path";
import type { InterleavedSpec, ReasoningOption } from "@henira/protocol";
import snapshotJson from "./models-dev-snapshot.json" with { type: "json" };

const MODELS_DEV_URL = "https://models.dev/api.json";

/** 修剪后的快照条目（快照即形状；运行时拉取按同形收录） */
export interface DictionaryModel {
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** 图片输入（输入框徽章「视觉」；派生自原始 modalities.input） */
  vision?: boolean;
  /** 原生思考（思考图标；显示用——思考档置灰判据仍走 protocol 厂商前缀表） */
  reasoning?: boolean;
  /** 思考参数形态（models.dev reasoning_options：toggle / effort+values——档位集合真源） */
  reasoningOptions?: ReasoningOption[];
  /** 思维链回传声明（models.dev interleaved：{field:"reasoning_content"} 或布尔） */
  interleaved?: InterleavedSpec;
}

export interface DictionaryProvider {
  id: string;
  name?: string;
  /** 厂商 API 地址（models.dev 原始 api 字段）：连接已知厂商时种子进 models.json baseUrl */
  endpoint?: string;
  models: Record<string, DictionaryModel>;
}

/** 缓存信封（model-presets.json）：元数据与数据顶层分家——文件自我说明新鲜度 */
export interface DictionaryCache {
  fetchedAt: string;
  providers: Record<string, DictionaryProvider>;
}

/** 手写覆盖字典（config 目录 models.json；用户可编辑，优先于快照 / 缓存） */
export interface ModelsOverrideFile {
  providers?: Record<
    string,
    {
      /** 显示名（模型管理分组头；快照厂商缺省 = 快照 name ?? id） */
      label?: string;
      baseUrl?: string;
      models?: Record<
        string,
        { contextWindow?: number; maxOutputTokens?: number; baseUrl?: string; label?: string }
      >;
      /** 选择器隐藏清单（模型管理开关关 = 进这里；缺 = 全显） */
      hidden?: string[];
    }
  >;
}

/** 构建时修剪入库的兜底快照（scripts/update-models-dev-snapshot.mjs 再生） */
export const SNAPSHOT: Record<string, DictionaryProvider> = snapshotJson as unknown as Record<
  string,
  DictionaryProvider
>;

/** models.dev reasoning_options 容错修剪（与 scripts/update-models-dev-snapshot.mjs 同规则）：
 * 只保已知形状（toggle / effort+values）；budget 与未知丢弃 */
function trimReasoningOptions(options: unknown): ReasoningOption[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const kept: ReasoningOption[] = [];
  for (const option of options as Array<Record<string, unknown>>) {
    if (option?.type === "toggle") kept.push({ type: "toggle" });
    else if (option?.type === "effort" && Array.isArray(option.values)) {
      kept.push({ type: "effort", values: (option.values as unknown[]).map(String) });
    }
  }
  return kept.length > 0 ? kept : undefined;
}

/** models.dev interleaved 容错修剪：{field} 或 true；其余丢弃 */
function trimInterleaved(interleaved: unknown): InterleavedSpec | undefined {
  if (typeof interleaved === "string") return undefined;
  if (interleaved === true) return true;
  if (interleaved === null || typeof interleaved !== "object") return undefined;
  const field = (interleaved as { field?: unknown }).field;
  return typeof field === "string" ? { field } : true;
}

export class Dictionary {
  #providers: Record<string, DictionaryProvider>;
  readonly #cacheFile: string;
  readonly #legacyCacheFile: string;
  readonly #fetchImpl: typeof fetch | undefined;

  constructor(cacheDir: string | undefined, fetchImpl?: typeof fetch) {
    this.#providers = { ...SNAPSHOT };
    this.#cacheFile = cacheDir === undefined ? "" : path.join(cacheDir, "model-presets.json");
    this.#legacyCacheFile =
      cacheDir === undefined ? "" : path.join(cacheDir, "models-dev-cache.json");
    this.#fetchImpl = fetchImpl;
  }

  /** 启动装载：本地缓存（上次拉取成功的结果）覆盖快照 */
  async loadCache(): Promise<void> {
    if (this.#cacheFile === "") return;
    try {
      const raw = await fs.readFile(this.#cacheFile, "utf8");
      const doc = JSON.parse(raw) as unknown;
      const cached =
        typeof doc === "object" && doc !== null && "providers" in doc
          ? ((doc as DictionaryCache).providers ?? {})
          : ((doc ?? {}) as Record<string, DictionaryProvider>);
      this.#providers = { ...this.#providers, ...cached };
    } catch {
      // 无缓存 = 首次运行，快照兜底（D-040：断网可用）
    }
    // 旧缓存（无 endpoint 的裁剪形状）清理——信息已被快照 + refresh 覆盖
    if (this.#legacyCacheFile !== "") {
      await fs.rm(this.#legacyCacheFile, { force: true }).catch(() => {});
    }
  }

  /** 运行时拉取（成功 → 更新内存 + 写缓存；失败 → 静默保持现状——快照/缓存兜底，不打扰会话） */
  async refresh(): Promise<boolean> {
    if (this.#fetchImpl === undefined) return false;
    try {
      const response = await this.#fetchImpl(MODELS_DEV_URL);
      if (!response.ok) return false;
      const raw = (await response.json()) as Record<
        string,
        {
          name?: string;
          api?: string;
          models?: Record<
            string,
            {
              name?: string;
              reasoning?: boolean;
              reasoning_options?: unknown;
              interleaved?: unknown;
              modalities?: { input?: string[] };
              limit?: { context?: number; output?: number };
            }
          >;
        }
      >;
      const fresh: Record<string, DictionaryProvider> = {};
      for (const [providerId, provider] of Object.entries(raw)) {
        const collected: DictionaryProvider["models"] = {};
        for (const [modelId, model] of Object.entries(provider.models ?? {})) {
          collected[modelId] = {
            name: model.name,
            contextWindow: model.limit?.context,
            maxOutputTokens: model.limit?.output,
            vision: Array.isArray(model.modalities?.input)
              ? model.modalities.input.includes("image")
              : undefined,
            reasoning: model.reasoning === true ? true : undefined,
            reasoningOptions: trimReasoningOptions(model.reasoning_options),
            interleaved: trimInterleaved(model.interleaved),
          };
        }
        if (Object.keys(collected).length > 0) {
          fresh[providerId] = {
            id: providerId,
            name: provider.name,
            endpoint: provider.api,
            models: collected,
          };
        }
      }
      this.#providers = { ...this.#providers, ...fresh };
      if (this.#cacheFile !== "") {
        await fs.mkdir(path.dirname(this.#cacheFile), { recursive: true });
        const doc: DictionaryCache = { fetchedAt: new Date().toISOString(), providers: fresh };
        // 用户目录文件：2 空格缩进落盘（人眼可读；1MB 级体积差异无感）
        await fs.writeFile(this.#cacheFile, JSON.stringify(doc, null, 2));
      }
      await this.#dropLegacyCache();
      return true;
    } catch {
      return false; // 断网 / 限流：静默回落（P2 观测由调用方决定是否记事件）
    }
  }

  async #dropLegacyCache(): Promise<void> {
    if (this.#legacyCacheFile === "") return;
    await fs.rm(this.#legacyCacheFile, { force: true }).catch(() => {});
  }

  /** 查询：<provider> 的模型能力（含手写覆盖前的字典视图） */
  lookup(
    provider: string,
    model: string,
  ): {
    contextWindow?: number;
    maxOutputTokens?: number;
    vision?: boolean;
    reasoning?: boolean;
    reasoningOptions?: ReasoningOption[];
    interleaved?: InterleavedSpec;
  } {
    const entry = this.#providers[provider]?.models[model];
    return {
      contextWindow: entry?.contextWindow,
      maxOutputTokens: entry?.maxOutputTokens,
      vision: entry?.vision,
      reasoning: entry?.reasoning,
      reasoningOptions: entry?.reasoningOptions,
      interleaved: entry?.interleaved,
    };
  }

  /** 全表视图（模型管理·厂商选择页数据源；快照 + 缓存合并后的当前字典） */
  entries(): Record<string, DictionaryProvider> {
    return this.#providers;
  }
}
