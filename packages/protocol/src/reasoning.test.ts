// 思考能力表（合同层）：前缀映射 + 参数族形状（BC 按厂商映射行为层参照——值档自家定）。

import { describe, expect, it } from "vitest";
import { reasoningCapability, reasoningParams } from "./reasoning.js";

describe("reasoningCapability（provider id 前缀 → 参数族）", () => {
  it("zhipu/glm 系 → thinking；qwen/dashscope 系 → enable；openai/azure 系 → effort", () => {
    expect(reasoningCapability("zhipuai-coding-plan")).toBe("thinking");
    expect(reasoningCapability("glm")).toBe("thinking");
    expect(reasoningCapability("bigmodel")).toBe("thinking");
    expect(reasoningCapability("qwen")).toBe("enable");
    expect(reasoningCapability("dashscope")).toBe("enable");
    expect(reasoningCapability("openai")).toBe("effort");
    expect(reasoningCapability("azure-openai")).toBe("effort");
  });

  it("deepseek / agnes / 未知厂商 → none（无参数族——原生思考不可控或无映射）", () => {
    expect(reasoningCapability("deepseek")).toBe("none");
    expect(reasoningCapability("agnes")).toBe("none");
    expect(reasoningCapability("totally-unknown")).toBe("none");
    // 大小写归一（provider id 手写来源）
    expect(reasoningCapability("ZhipuAI")).toBe("thinking");
  });
});

describe("reasoningParams（capability+档位 → 请求体附加参数；none/无效 = 不透传）", () => {
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
});
