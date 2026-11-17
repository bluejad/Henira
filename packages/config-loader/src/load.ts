// henira.config.ts 装载（D-011/D-015/D-016；M2 欠账 M3 落地）：开发者手写、进 git、可选——
// 缺文件 = 空配置（官方出厂清单照走）。jiti 装载 TS（CJS/ESM 通吃，零构建）。
// PluginEntry.definition 是装配物——loadConfig 只读不装配（装配归宿主：server / sdk / cli
// 各自把清单喂给 createHarness；applyConfig 等首个宿主消费者出现再落，不预建机器）。

import { existsSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import type { PluginEntry } from "./preset.js";

export interface HeniraConfig {
  /** 本项目固定模型（缺省听全局 settings.json） */
  model?: string;
  /** 基础插件清单（缺省 = defaultPreset）；额外引擎插件definition 在此追加 */
  plugins?: PluginEntry[];
  /** 本项目插件参数（键 = 插件 id）；项目优先于全局 */
  options?: Record<string, unknown>;
}

const jiti = createJiti(import.meta.url);

/** 读 <root>/henira.config.ts（可选）；返回合成后的项目配置 */
export async function loadConfig(root: string): Promise<HeniraConfig> {
  const file = path.join(root, "henira.config.ts");
  if (!existsSync(file)) return {};
  const mod = (await jiti.import(file)) as { default?: HeniraConfig } | HeniraConfig;
  const cfg = "default" in mod && mod.default !== undefined ? mod.default : (mod as HeniraConfig);
  if (cfg === null || typeof cfg !== "object") {
    throw new Error(`henira.config.ts must default-export a config object: ${file}`);
  }
  return cfg;
}
