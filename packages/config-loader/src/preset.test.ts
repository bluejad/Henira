import { describe, expect, it } from "vitest";
import { SNAPSHOT } from "./dictionary.js";
import { bundledSkillDirs, defaultPreset } from "./preset.js";

describe("官方默认预设（D-016 / D-041）", () => {
  it("M2 = 引擎 5 条 id-only（definition 由宿主装配注入）", () => {
    expect(defaultPreset.map((e) => e.id)).toEqual([
      "plugin-session",
      "plugin-llm",
      "plugin-tools",
      "plugin-approval",
      "plugin-loop",
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
});
