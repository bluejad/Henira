// models.dev 快照再生（D-040 兜底快照）：拉原始 api.json → 收敛为引擎所需形状 → 落盘。
// 2026-11-19 模型目录收敛批新增——旧快照裁掉了 endpoint（厂商 api 地址）与模型的
// vision/reasoning 徽章位，逼用户手写 baseUrl；此脚本固化「拉取 → 保真修剪」全链，
// 字段集 = DictionaryProvider 形状（id/name/endpoint/models{name,contextWindow,
// maxOutputTokens,vision,reasoning,reasoningOptions,interleaved}）。落盘压缩一行
//（仓库资产不看，用户侧缓存才缩进）。2026-11-19 思考档批：补保 reasoning_options
//（toggle/effort 档位真源）与 interleaved（思维链回传字段）——上一次这两字段被剪掉，
// 是继 endpoint 之后第二次「最后一米」丢弃。
// 用法：node scripts/update-models-dev-snapshot.mjs

import { writeFileSync } from "node:fs";

const SOURCE = "https://models.dev/api.json";
const OUT = new URL("../packages/config-loader/src/models-dev-snapshot.json", import.meta.url);

/** reasoning_options 容错修剪：只保已知形状（toggle / effort+values）；budget 与未知丢弃 */
function trimReasoningOptions(options) {
  if (!Array.isArray(options)) return undefined;
  const kept = [];
  for (const option of options) {
    if (option?.type === "toggle") kept.push({ type: "toggle" });
    else if (option?.type === "effort" && Array.isArray(option.values))
      kept.push({ type: "effort", values: option.values.map(String) });
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

const raw = await (await fetch(SOURCE)).json();
const out = {};
for (const [id, provider] of Object.entries(raw)) {
  const models = {};
  for (const [mid, model] of Object.entries(provider.models ?? {})) {
    models[mid] = {
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
  if (Object.keys(models).length === 0) continue;
  out[id] = {
    id,
    name: provider.name,
    endpoint: provider.api,
    models,
  };
}
writeFileSync(OUT, JSON.stringify(out));
console.log(`snapshot regenerated: ${Object.keys(out).length} providers -> ${OUT.pathname}`);
