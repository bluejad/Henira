// models.dev 快照再生（D-040 兜底快照）：拉原始 api.json → 收敛为引擎形状 → 落盘。
// 2026-11-25 R207 修正批：字段按上游 v1 schema 保真，不再按「当前 UI 需要」裁剪。
// status / type / tool_call / 模型级 provider{npm,api,shape} 都是「能不能调」的判据；
// 之前三次「最后一米」丢字段（endpoint → reasoning_options → status）都源于按需裁剪。
// 展示类字段（description/family/release_date/limit.input 之外的元数据/cost/benchmarks）
// 不属于路由与能力判据，未收录——要用时按需补，但别再剪能力字段。
// 用法：node scripts/update-models-dev-snapshot.mjs

import { writeFileSync } from "node:fs";

const SOURCE = "https://models.dev/api.json";
const OUT = new URL("../packages/config-loader/src/models-dev-snapshot.json", import.meta.url);

/** reasoning_options 容错修剪：toggle / effort+values / budget_tokens 三型保真；未知形状丢弃 */
function trimReasoningOptions(options) {
  if (!Array.isArray(options)) return undefined;
  const kept = [];
  for (const option of options) {
    if (option?.type === "toggle") kept.push({ type: "toggle" });
    else if (option?.type === "effort" && Array.isArray(option.values))
      kept.push({ type: "effort", values: option.values.map(String) });
    else if (option?.type === "budget_tokens")
      kept.push({
        type: "budget",
        ...(typeof option.min === "number" ? { min: option.min } : {}),
        ...(typeof option.max === "number" ? { max: option.max } : {}),
      });
  }
  return kept.length > 0 ? kept : undefined;
}

/** interleaved 容错修剪：{field} 或 true；其余丢弃 */
function trimInterleaved(interleaved) {
  if (typeof interleaved === "string") return undefined;
  if (interleaved === true) return true;
  if (interleaved === null || typeof interleaved !== "object") return undefined;
  return typeof interleaved.field === "string" ? { field: interleaved.field } : true;
}

const STATUSES = new Set(["alpha", "beta", "deprecated"]);

const raw = await (await fetch(SOURCE)).json();
const out = {};
for (const [id, provider] of Object.entries(raw)) {
  const models = {};
  for (const [mid, model] of Object.entries(provider.models ?? {})) {
    models[mid] = {
      name: model.name,
      // 缺省 chat；非 chat（image/video/embedding/decision…）不进对话目录
      type: typeof model.type === "string" ? model.type : undefined,
      // 缺省支持工具；false 的模型引擎每轮带工具必废
      toolCall: model.tool_call === false ? false : undefined,
      status: STATUSES.has(model.status) ? model.status : undefined,
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
      // 模型级协议覆盖（v1 的 provider{npm,api,shape}）：非 openai-compatible = 该模型
      // 在网关只开 responses / messages / generate-content 等别族协议
      sdk: typeof model.provider?.npm === "string" ? model.provider.npm : undefined,
      api: typeof model.provider?.api === "string" ? model.provider.api : undefined,
      shape:
        model.provider?.shape === "responses" || model.provider?.shape === "completions"
          ? model.provider.shape
          : undefined,
    };
  }
  if (Object.keys(models).length === 0) continue;
  out[id] = {
    id,
    name: provider.name,
    sdk: typeof provider.npm === "string" ? provider.npm : undefined,
    endpoint: provider.api,
    models,
  };
}
writeFileSync(OUT, JSON.stringify(out));
console.log(`snapshot regenerated: ${Object.keys(out).length} providers -> ${OUT.pathname}`);
