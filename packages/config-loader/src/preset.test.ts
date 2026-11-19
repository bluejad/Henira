import { describe, expect, it } from "vitest";
import { SNAPSHOT } from "./dictionary.js";
import { bundledSkillDirs, defaultPreset } from "./preset.js";

describe("官方默认预设（D-016 / D-041）", () => {
  it("出厂清单 = 引擎 5 + mcp 读者（D-064，C5）id-only（definition 由宿主装配注入）", () => {
    expect(defaultPreset.map((e) => e.id)).toEqual([
      "plugin-session",
      "plugin-llm",
      "plugin-tools",
      "plugin-approval",
      "plugin-loop",
      "plugin-mcp",
    ]);
    expect(defaultPreset.every((e) => !("definition" in e))).toBe(true);
  });

  it("bundledSkillDirs 空表（官方技能随 M6 落地）", () => {
    expect(bundledSkillDirs).toEqual([]);
  });
});

describe("models.dev 快照（D-040 兜底）", () => {
  it("快照在场且非空：常见 provider 可查能力字段", () => {
    const providers = Object.keys(SNAPSHOT);
    expect(providers.length).toBeGreaterThan(100);
    // 任取一个有 contextWindow 的条目验证形状
    const withLimit = Object.values(SNAPSHOT)
      .flatMap((p) => Object.values(p.models))
      .find((m) => typeof m.contextWindow === "number" && m.contextWindow > 0);
    expect(withLimit).toBeDefined();
  });

  it("思考档数据在位（2026-11-19）：deepseek toggle+effort、agnes 仅 toggle、interleaved 回传字段", () => {
    const ds = SNAPSHOT.deepseek?.models["deepseek-flash"];
    expect(ds?.reasoningOptions?.some((o) => o.type === "toggle")).toBe(true);
    expect(ds?.reasoningOptions?.some((o) => o.type === "effort" && o.values.includes("max"))).toBe(
      true,
    );
    expect(ds?.interleaved).toEqual({ field: "reasoning_content" });

    const ag = SNAPSHOT.agnes?.models["agnes-3.0-flash"];
    expect(ag?.reasoningOptions).toEqual([{ type: "toggle" }]);

    const glm = SNAPSHOT["zhipuai-coding-plan"]?.models["glm-5.3-flash"];
    expect(glm?.reasoningOptions?.some((o) => o.type === "effort")).toBe(true);
  });
});
