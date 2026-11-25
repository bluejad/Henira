// 模型参数字典（D-040）：models.dev 快照兜底（构建时修剪入库）+ 运行时拉取 + 本地缓存 +
// 手写覆盖字典（config 目录 models.json）。引擎零网络零厂商表（P9-4）——同步只住本层。
// 2026-11-19 模型目录收敛批：厂商层补 endpoint（models.dev 原始 api 字段——旧管线裁掉它
// 逼用户手写 baseUrl）+ 模型层补 vision/reasoning 徽章位；缓存改自有形状 model-presets.json
//（{fetchedAt, providers} 信封 + 2 空格缩进——用户目录文件必须人眼可读）；旧 models-dev-cache
// .json 无 endpoint，读到即删不迁移（refresh 会带回全量）。
// 2026-11-19 思考档批：模型层再补 reasoningOptions（models.dev reasoning_options——档位集合
// 真源）与 interleaved（思维链回传字段）——上次这两字段被剪掉是继 endpoint 之后第二次「最后一米」。
// 2026-11-25 R207 修正批：快照按 models.dev v1 schema 保真（不再按 UI 需要裁）——type /
// toolCall / status / 模型级 provider{npm,api,shape} 全部入库；目录可见性改为数据驱动判据，
// 删掉手写模型名单（上一版 15 个 id 实为「模型级 npm 覆盖」的投影）。第三次丢字段（status）
// 让 13 个已下架模型混进目录、选了必被网关拒——病根是同一条：裁剪发生在快照层而非投影层。

import { promises as fs } from "node:fs";
import path from "node:path";
import type { InterleavedSpec, ReasoningOption } from "@henira/protocol";
import snapshotJson from "./models-dev-snapshot.json" with { type: "json" };

const MODELS_DEV_URL = "https://models.dev/api.json";

/** 模型生命周期（models.dev status）：alpha/beta 可用；deprecated 语义按 provider 类型
 * 分流——网关 = 已下线，厂商 = 不再推荐但 API 仍兼容（见 GATEWAY_DEPRECATED_OFFLINE） */
export type ModelStatus = "alpha" | "beta" | "deprecated";

/** 修剪后的快照条目（快照即形状；运行时拉取按同形收录） */
export interface DictionaryModel {
  name?: string;
  /** 模型类型（缺省 chat；image/video/embedding/decision… 不进对话目录） */
  type?: string;
  /** 不支持工具调用（缺省 = 支持；false 的模型引擎每轮带工具必废） */
  toolCall?: boolean;
  status?: ModelStatus;
  contextWindow?: number;
  maxOutputTokens?: number;
  maxInputTokens?: number;
  /** 图片输入（输入框徽章「视觉」；派生自原始 modalities.input） */
  vision?: boolean;
  /** 原始输入模态（text/image/audio/video/pdf——vision 的同源全量，展示扩展用） */
  inputModalities?: string[];
  /** 原生思考（思考图标；显示用——思考档置灰判据仍走 protocol 厂商前缀表） */
  reasoning?: boolean;
  /** 思考参数形态（models.dev reasoning_options：toggle / effort+values / budget——档位集合真源） */
  reasoningOptions?: ReasoningOption[];
  /** 思维链回传声明（models.dev interleaved：{field:"reasoning_content"} 或布尔） */
  interleaved?: InterleavedSpec;
  /** 模型级协议覆盖（models.dev model.provider.npm）：非 openai-compatible = 该模型在网关
   * 只开 responses / messages / generate-content 等别族协议，本仓适配器调不了 */
  sdk?: string;
  /** 模型级 baseUrl 覆盖（models.dev model.provider.api） */
  api?: string;
  /** 模型级协议形状（responses = OpenAI Responses API，不是 chat completions） */
  shape?: "responses" | "completions";
}

export interface DictionaryProvider {
  id: string;
  name?: string;
  /** 厂商级 SDK（models.dev provider.npm；openai-compatible 才与本仓适配器同族） */
  sdk?: string;
  /** 厂商 API 地址（models.dev 原始 api 字段）：连接已知厂商时种子进 models.json baseUrl */
  endpoint?: string;
  models: Record<string, DictionaryModel>;
}

/** 缓存信封（model-presets.json）：元数据与数据顶层分家——文件自我说明新鲜度。
 * `version` 是目录形状版本：字段集变化后旧缓存不可用——缺 status/type/sdk 的缓存会让
 * 投影判据失效（下架模型复活），读到即丢弃、快照兜底、refresh 成功后重写（R207 修正批）。 */
export interface DictionaryCache {
  version: 2;
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

/** 网关的 deprecated = 已下线：models.dev 仍留档，但网关 /models 不再返回（2026-11-25
 * opencode-go 实核：13 个 deprecated 与网关拒收清单严格相等）。厂商的 deprecated =
 * 不再推荐但 API 仍兼容（deepseek-v4-flash、claude-sonnet-4-5 仍在服务）——全局过滤会
 * 误伤，只对已实证的网关生效。 */
const GATEWAY_DEPRECATED_OFFLINE = new Set(["opencode", "opencode-go"]);

/** 目录可见性：本仓适配器能不能调（判据全部来自 models.dev v1 字段，零模型名单）：
 * ① type 非 chat —— 对话目录不收
 * ② toolCall === false —— 引擎每轮带工具，收了必废
 * ③ 模型级 sdk 覆盖且非 openai-compatible —— 该模型只开别族协议
 * ④ shape === "responses" —— Responses API，不是 chat completions
 * ⑤ 网关的 deprecated —— 已下线（厂商的 deprecated 保留，见上） */
export function modelUsableByAdapter(providerId: string, model: DictionaryModel): boolean {
  if ((model.type ?? "chat") !== "chat") return false;
  if (model.toolCall === false) return false;
  if (model.sdk !== undefined && model.sdk !== "@ai-sdk/openai-compatible") return false;
  if (model.shape === "responses") return false;
  if (model.status === "deprecated" && GATEWAY_DEPRECATED_OFFLINE.has(providerId)) return false;
  return true;
}

/** 目录投影：剥掉适配器调不了的模型（快照 / 缓存 / 运行时刷新三处共用，防旧缓存把它们带回来） */
function stripUnusableModels(
  providers: Record<string, DictionaryProvider>,
): Record<string, DictionaryProvider> {
  const out: Record<string, DictionaryProvider> = {};
  for (const [id, provider] of Object.entries(providers)) {
    const models: DictionaryProvider["models"] = {};
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (modelUsableByAdapter(id, model)) models[modelId] = model;
    }
    out[id] = { ...provider, models };
  }
  return out;
}

/** 构建时修剪入库的兜底快照（scripts/update-models-dev-snapshot.mjs 再生） */
export const SNAPSHOT: Record<string, DictionaryProvider> = stripUnusableModels(
  snapshotJson as unknown as Record<string, DictionaryProvider>,
);

/** models.dev reasoning_options 容错修剪（与 scripts/update-models-dev-snapshot.mjs 同规则）：
 * toggle / effort+values / budget_tokens 三型保真；未知丢弃 */
function trimReasoningOptions(options: unknown): ReasoningOption[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const kept: ReasoningOption[] = [];
  for (const option of options as Array<Record<string, unknown>>) {
    if (option?.type === "toggle") kept.push({ type: "toggle" });
    else if (option?.type === "effort" && Array.isArray(option.values)) {
      kept.push({ type: "effort", values: (option.values as unknown[]).map(String) });
    } else if (option?.type === "budget_tokens") {
      kept.push({
        type: "budget",
        ...(typeof option.min === "number" ? { min: option.min } : {}),
        ...(typeof option.max === "number" ? { max: option.max } : {}),
      });
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

  /** 启动装载：本地缓存（上次拉取成功的结果）覆盖快照；形状过期的缓存丢弃 */
  async loadCache(): Promise<void> {
    if (this.#cacheFile === "") return;
    try {
      const raw = await fs.readFile(this.#cacheFile, "utf8");
      const doc = JSON.parse(raw) as unknown;
      // 形状门：只有第 2 代缓存（带 status/type/sdk 等判据字段）可合并。旧缓存缺字段，
      // 合并后投影判据失效（已下架模型复活）——丢弃，快照兜底，等 refresh 重写。
      const current =
        typeof doc === "object" &&
        doc !== null &&
        (doc as { version?: unknown }).version === 2 &&
        "providers" in doc;
      if (!current) {
        await fs.rm(this.#cacheFile, { force: true }).catch(() => {});
      } else {
        const cached = (doc as DictionaryCache).providers ?? {};
        // 缓存与快照同投影：旧缓存里的不可调模型不因合并复活
        this.#providers = stripUnusableModels({ ...this.#providers, ...cached });
      }
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
          npm?: string;
          api?: string;
          models?: Record<
            string,
            {
              name?: string;
              type?: string;
              tool_call?: boolean;
              status?: string;
              reasoning?: boolean;
              reasoning_options?: unknown;
              interleaved?: unknown;
              modalities?: { input?: string[] };
              limit?: { context?: number; input?: number; output?: number };
              provider?: { npm?: string; api?: string; shape?: string };
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
            type: model.type,
            toolCall: model.tool_call === false ? false : undefined,
            status:
              model.status === "alpha" || model.status === "beta" || model.status === "deprecated"
                ? model.status
                : undefined,
            contextWindow: model.limit?.context,
            maxOutputTokens: model.limit?.output,
            maxInputTokens: model.limit?.input,
            vision: Array.isArray(model.modalities?.input)
              ? model.modalities.input.includes("image")
              : undefined,
            inputModalities: Array.isArray(model.modalities?.input)
              ? model.modalities.input.map(String)
              : undefined,
            reasoning: model.reasoning === true ? true : undefined,
            reasoningOptions: trimReasoningOptions(model.reasoning_options),
            interleaved: trimInterleaved(model.interleaved),
            sdk: model.provider?.npm,
            api: model.provider?.api,
            shape:
              model.provider?.shape === "responses" || model.provider?.shape === "completions"
                ? model.provider.shape
                : undefined,
          };
        }
        if (Object.keys(collected).length > 0) {
          fresh[providerId] = {
            id: providerId,
            name: provider.name,
            sdk: provider.npm,
            endpoint: provider.api,
            models: collected,
          };
        }
      }
      this.#providers = { ...this.#providers, ...stripUnusableModels(fresh) };
      if (this.#cacheFile !== "") {
        await fs.mkdir(path.dirname(this.#cacheFile), { recursive: true });
        // 缓存同样只存可调模型：目录投影在写盘前完成（影子数据不进用户文件）
        const doc: DictionaryCache = {
          version: 2,
          fetchedAt: new Date().toISOString(),
          providers: stripUnusableModels(fresh),
        };
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
