// models.dev 快照再生（D-040 兜底快照）：拉原始 api.json → 收敛为引擎所需形状 → 落盘。
// 2026-11-19 模型目录收敛批新增——旧快照裁掉了 endpoint（厂商 api 地址）与模型的
// vision/reasoning 徽章位，逼用户手写 baseUrl；此脚本固化「拉取 → 保真修剪」全链，
// 字段集 = DictionaryProvider 形状（id/name/endpoint/models{name,contextWindow,
// maxOutputTokens,vision,reasoning}）。落盘压缩一行（仓库资产不看，用户侧缓存才缩进）。
// 用法：node scripts/update-models-dev-snapshot.mjs

import { writeFileSync } from "node:fs";

const SOURCE = "https://models.dev/api.json";
const OUT = new URL("../packages/config-loader/src/models-dev-snapshot.json", import.meta.url);

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
