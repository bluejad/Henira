// 思考能力表（合同层——BC reasoningCapabilityOf 在其 protocol/dto 同位）：provider id 前缀 →
// 该厂商 OpenAI 兼容端点接受的**参数形状**（参数名叫什么、嵌套在哪——models.dev 不描述，只能表登记）。
// 模型级**档位集合**由 models.dev `reasoning_options` 数据驱动（reasoningLevels）——数据决定
// 「有没有/哪些档」，形状表只决定「怎么写进请求体」。两者都有才放开（数据缺失 → 形状表兜底）。
// none = 无参数族（未收录厂商）——UI 置灰「—」，适配器不透传。

import type { ReasoningEffort } from "./llm.js";

/** 思考参数形态声明（models.dev `reasoning_options` 条目，模型级真源）：
 * toggle = 开/关两态；effort = 档位枚举（values 为厂商原值，如 low/high/max）；
 * budget = 预算 token（未接——先容错保真，UI 端暂不放开） */
export type ReasoningOption =
  | { type: "toggle" }
  | { type: "effort"; values: string[] }
  | { type: "budget"; min?: number; max?: number };

/** 思维链回传声明（models.dev `interleaved`）：{field:"reasoning_content"} 或布尔 */
export type InterleavedSpec = boolean | { field?: string };

/** 参数形状族：effort=reasoning_effort / thinking=thinking:{type} / enable=顶层 enable_thinking /
 * template-enable=chat_template_kwargs.enable_thinking（agnes）/ thinking-effort=开关+effort 组合（deepseek） */
export type ReasoningCapability =
  | "effort"
  | "thinking"
  | "enable"
  | "template-enable"
  | "thinking-effort"
  | "none";

const THINKING_PREFIXES = ["zhipu", "glm", "bigmodel", "chatglm"];
const ENABLE_PREFIXES = ["qwen", "dashscope", "aliyun"];
const EFFORT_PREFIXES = ["openai", "azure"];
const DEEPSEEK_PREFIXES = ["deepseek"]; // 官方：thinking:{type} + reasoning_effort（low/high/max）
const TEMPLATE_ENABLE_PREFIXES = ["agnes"]; // 官方：chat_template_kwargs.enable_thinking（仅开/关）

/** 是否开关语义族（数据缺省时只给「关/开」两档；effort 族给四档） */
function isToggleFamily(capability: ReasoningCapability): boolean {
  return capability === "thinking" || capability === "enable" || capability === "template-enable";
}

export function reasoningCapability(providerId: string): ReasoningCapability {
  const id = providerId.toLowerCase();
  if (DEEPSEEK_PREFIXES.some((p) => id.startsWith(p))) return "thinking-effort";
  if (TEMPLATE_ENABLE_PREFIXES.some((p) => id.startsWith(p))) return "template-enable";
  if (THINKING_PREFIXES.some((p) => id.startsWith(p))) return "thinking";
  if (ENABLE_PREFIXES.some((p) => id.startsWith(p))) return "enable";
  if (EFFORT_PREFIXES.some((p) => id.startsWith(p))) return "effort";
  return "none";
}

/** 厂商档位原值 → 四档（未知值丢弃）：low/minimal→低；medium→中；high/xhigh→高；max/ultra→高（顶档） */
function mapLevelValue(value: string): ReasoningEffort | undefined {
  switch (value.toLowerCase()) {
    case "low":
    case "minimal":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
      return "high";
    case "max":
    case "ultra":
      return "high";
    default:
      return undefined;
  }
}

const ALL_LEVELS: ReasoningEffort[] = ["off", "low", "medium", "high"];

/**
 * 模型实际可选档位（UI 档位集合真源）：`reasoning_options` 数据决定；数据缺失 → 形状表兜底
 * （开关族只给关/开两档——「开」承载值 medium；effort 族四档）。返回空数组 = 不可调（置灰）。
 */
export function reasoningLevels(
  capability: ReasoningCapability,
  options?: readonly ReasoningOption[],
): ReasoningEffort[] {
  if (capability === "none") return [];
  const effortOption = options?.find(
    (o): o is { type: "effort"; values: string[] } => o.type === "effort",
  );
  if (effortOption !== undefined) {
    const levels: ReasoningEffort[] = ["off"];
    for (const raw of effortOption.values) {
      const level = mapLevelValue(raw);
      if (level !== undefined && !levels.includes(level)) levels.push(level);
    }
    return levels;
  }
  const hasToggle = options?.some((o) => o.type === "toggle") === true;
  if (hasToggle || isToggleFamily(capability)) return ["off", "medium"];
  // 数据缺省：形状表兜底（effort 族四档）
  if (options === undefined || options.length === 0) return ALL_LEVELS;
  return []; // 仅 budget 声明（或未知形状）：未接——置灰，不造参数
}

/** capability → OpenAI 兼容请求体附加参数（providerOptions 透传形状）；none / effort+off 无参数 = undefined */
export function reasoningParams(
  capability: ReasoningCapability,
  effort: ReasoningEffort,
): Record<string, unknown> | undefined {
  switch (capability) {
    case "effort":
      // openai 系无 "off" 档——off 不透传（模型侧不收该值）
      return effort === "off" ? undefined : { reasoning_effort: effort };
    case "thinking":
      return { thinking: { type: effort === "off" ? "disabled" : "enabled" } };
    case "enable":
      return { enable_thinking: effort !== "off" };
    case "template-enable":
      return { chat_template_kwargs: { enable_thinking: effort !== "off" } };
    case "thinking-effort":
      // deepseek 官方：thinking 开关 + reasoning_effort（low/high/max；medium 由服务端 clamp 到 high）。
      // 我方四档 → 厂商三档：off=disabled；low→low；medium→high；high→max（顶档对齐用户直觉）
      if (effort === "off") return { thinking: { type: "disabled" } };
      return {
        thinking: { type: "enabled" },
        reasoning_effort: effort === "low" ? "low" : effort === "medium" ? "high" : "max",
      };
    case "none":
      return undefined;
  }
}

/** 该模型是否声明思维链回传字段（models.dev interleaved）；只有 reasoning_content 可自动回传
 *（AI SDK openai-compatible 只认这个字段名），其余未知名返回 undefined = 不回传 */
export function reasoningEchoField(interleaved?: InterleavedSpec): string | undefined {
  if (interleaved === true) return "reasoning_content";
  if (interleaved !== undefined && typeof interleaved === "object") {
    if (typeof interleaved.field === "string") return interleaved.field;
    return "reasoning_content";
  }
  return undefined;
}
