// 思考能力表（合同层）：前缀 → 参数形状族；档位集合数据驱动（reasoning_options）；
// 形状 × 档位 → 请求体参数；思维链回传字段判定。

import { describe, expect, it } from "vitest";
import {
  reasoningCapability,
  reasoningEchoField,
  reasoningLevels,
  reasoningParams,
} from "./reasoning.js";

describe("reasoningCapability（provider id 前缀 → 参数形状族）", () => {
  it("zhipu/glm 系 → thinking；qwen/dashscope 系 → enable；openai/azure 系 → effort", () => {
    expect(reasoningCapability("zhipuai-coding-plan")).toBe("thinking");
    expect(reasoningCapability("glm")).toBe("thinking");
    expect(reasoningCapability("bigmodel")).toBe("thinking");
    expect(reasoningCapability("qwen")).toBe("enable");
    expect(reasoningCapability("dashscope")).toBe("enable");
    expect(reasoningCapability("openai")).toBe("effort");
    expect(reasoningCapability("azure-openai")).toBe("effort");
  });

  it("deepseek → thinking-effort（开关+effort）；agnes → template-enable（chat_template_kwargs）", () => {
    expect(reasoningCapability("deepseek")).toBe("thinking-effort");
    expect(reasoningCapability("agnes")).toBe("template-enable");
    // 未知厂商仍 none（不造假参数）
    expect(reasoningCapability("totally-unknown")).toBe("none");
    // 大小写归一（provider id 手写来源）
    expect(reasoningCapability("ZhipuAI")).toBe("thinking");
    expect(reasoningCapability("DeepSeek")).toBe("thinking-effort");
  });
});

describe("reasoningLevels（档位集合数据驱动；缺省形状表兜底）", () => {
  it("deepseek 数据（toggle + effort low/high/max）→ 关/低/高（max 归顶档、无中档）", () => {
    expect(
      reasoningLevels("thinking-effort", [
        { type: "toggle" },
        { type: "effort", values: ["low", "high", "max"] },
      ]),
    ).toEqual(["off", "low", "high"]);
  });

  it("agnes 数据（仅 toggle）→ 两档 关/开（开承载 medium）", () => {
    expect(reasoningLevels("template-enable", [{ type: "toggle" }])).toEqual(["off", "medium"]);
  });

  it("zhipu 数据（effort low/high/max）→ 三档；openai 系 effort medium 在册 → 四档", () => {
    expect(
      reasoningLevels("thinking", [{ type: "effort", values: ["low", "high", "max"] }]),
    ).toEqual(["off", "low", "high"]);
    expect(
      reasoningLevels("effort", [{ type: "effort", values: ["minimal", "low", "medium", "high"] }]),
    ).toEqual(["off", "low", "medium", "high"]);
  });

  it("数据缺省 → 形状表兜底：开关族两档、effort 族四档；none 恒空（置灰）", () => {
    expect(reasoningLevels("thinking")).toEqual(["off", "medium"]);
    expect(reasoningLevels("enable")).toEqual(["off", "medium"]);
    expect(reasoningLevels("template-enable")).toEqual(["off", "medium"]);
    expect(reasoningLevels("effort")).toEqual(["off", "low", "medium", "high"]);
    expect(reasoningLevels("thinking-effort")).toEqual(["off", "low", "medium", "high"]);
    expect(reasoningLevels("none", [{ type: "toggle" }])).toEqual([]);
  });

  it("仅 budget 声明（未接）→ 空集合（置灰，不造参数）", () => {
    expect(reasoningLevels("effort", [{ type: "budget", min: 1024, max: 20480 }])).toEqual([]);
  });
});

describe("reasoningParams（形状 × 档位 → 请求体附加参数；none/无效 = 不透传）", () => {
  it("effort 族：非 off 直映 reasoning_effort；off 不透传（openai 系无该档）", () => {
    expect(reasoningParams("effort", "high")).toEqual({ reasoning_effort: "high" });
    expect(reasoningParams("effort", "off")).toBeUndefined();
  });

  it("thinking 族：关=disabled、其余=enabled（档位级别 glm 侧不细分）", () => {
    expect(reasoningParams("thinking", "off")).toEqual({ thinking: { type: "disabled" } });
    expect(reasoningParams("thinking", "low")).toEqual({ thinking: { type: "enabled" } });
    expect(reasoningParams("thinking", "high")).toEqual({ thinking: { type: "enabled" } });
  });

  it("enable 族：布尔开关；none 族恒不透传", () => {
    expect(reasoningParams("enable", "off")).toEqual({ enable_thinking: false });
    expect(reasoningParams("enable", "medium")).toEqual({ enable_thinking: true });
    expect(reasoningParams("none", "high")).toBeUndefined();
    expect(reasoningParams("none", "off")).toBeUndefined();
  });

  it("template-enable 族（agnes）：chat_template_kwargs.enable_thinking 布尔（官方文档形状）", () => {
    expect(reasoningParams("template-enable", "off")).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(reasoningParams("template-enable", "medium")).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    });
  });

  it("thinking-effort 族（deepseek）：off=disabled；低→low、中→high、高→max（官方三档映射）", () => {
    expect(reasoningParams("thinking-effort", "off")).toEqual({ thinking: { type: "disabled" } });
    expect(reasoningParams("thinking-effort", "low")).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    });
    expect(reasoningParams("thinking-effort", "medium")).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
    expect(reasoningParams("thinking-effort", "high")).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    });
  });
});

describe("reasoningEchoField（思维链回传字段；AI SDK 只认 reasoning_content）", () => {
  it("interleaved 声明 field → 该字段；布尔 → reasoning_content 缺省；缺省 → undefined", () => {
    expect(reasoningEchoField({ field: "reasoning_content" })).toBe("reasoning_content");
    expect(reasoningEchoField(true)).toBe("reasoning_content");
    expect(reasoningEchoField(undefined)).toBeUndefined();
    expect(reasoningEchoField({ field: "other_field" })).toBe("other_field");
  });
});
