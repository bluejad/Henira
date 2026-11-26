// 阈值与预算单测（compaction.md §4.3、§5 I-14）：四档窗口的算术必须闭合，
// 封顶只在「剩余不足基线」时介入。数字全部从公式手算，防止实现与文档两套常量。

import { describe, expect, it } from "vitest";
import {
  capOutputTokens,
  contextBudget,
  DEFAULT_CONTEXT_WINDOW,
  percentUntilPressure,
  warningThreshold,
} from "./context-budget.js";

describe("contextBudget（compaction.md §4.3）", () => {
  it("缺省 128K：压力线 108.8K / 硬线 127K / 摘要 17.2K / 保留 12%", () => {
    const budget = contextBudget();
    expect(budget.window).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(budget.limit).toBe(128_000);
    expect(budget.reserve).toBe(19_200); // floor(128000 × 0.15)
    expect(budget.pressure).toBe(108_800);
    expect(budget.hardLimit).toBe(127_000);
    expect(budget.outputBase).toBe(32_000);
    expect(budget.summaryOut).toBe(17_200); // min(20000, 19200 − 2000)
    expect(budget.retain).toBe(15_360); // floor(128000 × 0.12)
    expect(budget.headMin).toBe(6_400); // max(4000, floor(128000 × 0.05))
  });

  it("200K：reserve 30K、摘要封顶 20K、保留 24K", () => {
    const budget = contextBudget({ contextWindow: 200_000 });
    expect(budget.reserve).toBe(30_000);
    expect(budget.pressure).toBe(170_000);
    expect(budget.summaryOut).toBe(20_000);
    expect(budget.retain).toBe(24_000);
  });

  it("32K / 16K / 8K：余量走下限、摘要预算不出现负数", () => {
    const w32 = contextBudget({ contextWindow: 32_000 });
    expect(w32.reserve).toBe(8_000); // clamp(4800, min(8000, 8000), 64000)
    expect(w32.pressure).toBe(24_000);
    expect(w32.summaryOut).toBe(6_000);
    expect(w32.retain).toBe(4_000);

    const w16 = contextBudget({ contextWindow: 16_000 });
    expect(w16.reserve).toBe(4_000); // clamp(2400, floor(16000/4), 64000)
    expect(w16.pressure).toBe(12_000);
    expect(w16.summaryOut).toBe(2_000);

    const w8 = contextBudget({ contextWindow: 8_000 });
    expect(w8.reserve).toBe(2_000);
    expect(w8.summaryOut).toBe(0); // 2K 指令预留吃掉全部
    expect(w8.retain).toBe(4_000); // 下限，压缩对小窗口没有意义
    expect(w8.summaryOut).toBeGreaterThanOrEqual(0);
  });

  it("观测上限取小：字典 256K、实际截断在 196608 → 压力线按实际上限算", () => {
    const budget = contextBudget({ contextWindow: 256_000, observedLimit: 196_608 });
    expect(budget.limit).toBe(196_608);
    expect(budget.pressure).toBe(196_608 - Math.floor(196_608 * 0.15));
    expect(budget.hardLimit).toBe(195_608);
  });

  it("输出基线：模型声明优先、观测输出上限再取小", () => {
    expect(contextBudget({ maxOutputTokens: 8_000 }).outputBase).toBe(8_000);
    expect(
      contextBudget({
        contextWindow: 128_000,
        maxOutputTokens: 64_000,
        observedOutputLimit: 39_216,
      }).outputBase,
    ).toBe(39_216);
  });

  it("封顶只在 0 < 剩余 < 基线时带（compaction.md §4.3）；浮点用量取整；窗口未知不封顶", () => {
    const budget = contextBudget({ contextWindow: 128_000 });
    expect(capOutputTokens(budget.pressure, budget)).toBe(127_000 - 108_800); // 18.2K
    expect(capOutputTokens(90_000, budget)).toBeUndefined(); // 剩余 37K ≥ 32K
    expect(capOutputTokens(130_000, budget)).toBeUndefined(); // 剩余非正
    expect(capOutputTokens(0, contextBudget({ contextWindow: 1_000_000 }))).toBeUndefined();
    // 窗口未知（模型未声明）：阈值仍按缺省 128K，但不封顶（§4.3 / §8 第 3 条）
    const unknown = contextBudget();
    expect(unknown.windowKnown).toBe(false);
    expect(unknown.limit).toBe(128_000); // 阈值口径不变
    expect(capOutputTokens(unknown.pressure, unknown)).toBeUndefined();
    // 估算器是浮点：AI SDK 只收整数（真 key 验收抓到 maxOutputTokens 非整数报错）
    expect(capOutputTokens(119_999.7, budget)).toBe(7_000); // floor(127000 − 119999.7)
    const fractional = capOutputTokens(119_999.2, budget);
    expect(fractional).toBeDefined();
    expect(Number.isInteger(fractional)).toBe(true);
  });

  it("预警线 = 压力线下方 10% 窗口；N% 按上限取整", () => {
    const budget = contextBudget();
    expect(warningThreshold(budget)).toBe(96_000); // 108800 − 12800
    expect(percentUntilPressure(100_000, budget)).toBe(6); // floor(8800/128000×100)
    expect(percentUntilPressure(108_800, budget)).toBe(0);
    expect(percentUntilPressure(120_000, budget)).toBe(0); // 不出现负数
  });
});
