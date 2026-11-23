// 模型管理页共享类型/常量（R187 拆分：从 settings/models.tsx 提取，行为零变化）。
import type { ReasoningCapability } from "@henira/protocol";

/** 厂商选择页「热门」置顶集合（其余按名称字母序）。 */
export const HOT_PROVIDERS = new Set([
  "deepseek",
  "zhipuai",
  "moonshotai",
  "alibaba",
  "volcengine",
  "siliconflow",
  "anthropic",
  "google",
  "openai",
  "openrouter",
  "xai",
  "mistral",
  "groq",
  "togetherai",
]);

export interface ProviderGroup {
  id: string;
  name?: string;
  reasoning?: ReasoningCapability;
  connected: boolean;
  models: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    vision?: boolean;
    reasoning?: boolean;
    enabled: boolean;
  }>;
}

export interface ModelPreset {
  name?: string;
  models: Record<string, { name?: string; contextWindow?: number }>;
}

export type ModelsView = "list" | "picker" | "known" | "custom";

export const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** 厂商标记（无品牌图标资产时的身份位）：词首字母 1-2 个；中文取首字。 */
export function providerMark(name: string | undefined, id: string): string {
  const source = (name ?? id).trim();
  const words = source.split(/[\s·|/_-]+/).filter((w) => w !== "");
  if (words.length >= 2) {
    const first = [...(words[0] ?? "")][0] ?? "";
    const second = [...(words[1] ?? "")][0] ?? "";
    const mark = `${first}${second}`.trim();
    if (mark !== "") return mark.toUpperCase();
  }
  const chars = [...source.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, "")];
  return (chars.slice(0, 2).join("") || id.slice(0, 2)).toUpperCase();
}
