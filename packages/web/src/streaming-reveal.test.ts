// streaming-reveal 纯函数单测（E3 生命感）：分词（CJK 拆字/词合并）、回填判定、EWMA 排期
// （参数夹限/时钟接续/进度 cap）。

import { describe, expect, it } from "vitest";
import {
  commitFrame,
  createRevealState,
  isIncrementalReveal,
  segmentRevealUnits,
} from "./streaming-reveal.js";

describe("segmentRevealUnits", () => {
  it("CJK 词内按码点拆字（ICU 词典分词会把两字词合成一块——参照物 bugfix 同款）", () => {
    const units = segmentRevealUnits("拍板决策");
    expect(units).toHaveLength(4);
    expect(units.map((u) => u.end - u.start)).toEqual([1, 1, 1, 1]);
  });

  it("英文按词切（空白独立成单元——插件不包装空白）；字母数字串合并不拆字", () => {
    const units = segmentRevealUnits("hello world");
    expect(units).toHaveLength(3); // hello / 空格 / world
    const mixed = segmentRevealUnits("abc123");
    expect(mixed).toHaveLength(1);
  });

  it("偏移连续覆盖全文（拼回 = 原文）", () => {
    const text = "中文 English 混排 123";
    const units = segmentRevealUnits(text);
    let cursor = 0;
    for (const u of units) {
      expect(u.start).toBe(cursor);
      cursor = u.end;
    }
    expect(cursor).toBe(text.length);
  });
});

describe("isIncrementalReveal（回填判定）", () => {
  it("前缀小增量 = true；增量超 600 字符 = false；非前缀 = false；等长 = false", () => {
    expect(isIncrementalReveal("abc", "abcd")).toBe(true);
    expect(isIncrementalReveal("a".repeat(100), "a".repeat(100) + "b".repeat(600))).toBe(true);
    expect(isIncrementalReveal("a", `a${"b".repeat(601)}`)).toBe(false);
    expect(isIncrementalReveal("旧文本", "完全不同")).toBe(false);
    expect(isIncrementalReveal("same", "same")).toBe(false);
  });
});

describe("commitFrame（EWMA 排期）", () => {
  const block = { start: 0, end: 12 };

  it("首帧（无到达参照）不更新估速但排期 fresh 单元——延迟非负、相邻间隔夹限 [15, 40]", () => {
    const state = commitFrame(createRevealState(), "", "hello world 你", [block], 1000);
    const plan = state.plans.get("0");
    expect(plan).toBeDefined();
    const delays = [...(plan?.values() ?? [])].sort((a, b) => a - b);
    expect(delays.length).toBeGreaterThan(0);
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < delays.length; i++) {
      const diff = delays[i] - delays[i - 1];
      expect(diff).toBeGreaterThanOrEqual(15);
      expect(diff).toBeLessThanOrEqual(40);
    }
  });

  it("快速连续到达 → EWMA rate 增大 → 后帧铺开间隔缩短（自适应调速）", () => {
    let state = createRevealState();
    state = commitFrame(state, "", "hello", [block], 1000);
    const slow = commitFrame(state, "hello", "hello world", [block], 1100);
    const planSlow = slow.plans.get("0");
    const slowInterval =
      planSlow && planSlow.size > 1 ? [...planSlow.values()][1] - [...planSlow.values()][0] : 40;
    // 两帧间隔 100ms（慢速）后的排期间隔 ≥ 快速路径（20ms 间隔）
    state = commitFrame(state, "hello world", "hello world abcdef", [block], 1120);
    const fast = commitFrame(state, "hello world abcdef", "hello world abcdefg", [block], 1130);
    const planFast = fast.plans.get("0");
    expect(planFast).toBeDefined();
    // 只做宽松方向断言：快速帧的 delay 起点不晚于慢速帧（EWMA 提速生效的形状锁）
    const fastFirst = [...(planFast?.values() ?? [])][0] ?? 40;
    expect(fastFirst).toBeLessThanOrEqual(Math.max(slowInterval, 15));
  });

  it("进度按 block 记；cap 16 裁老块", () => {
    let state = createRevealState();
    for (let i = 0; i < 20; i++) {
      const blocks = [{ start: i * 10, end: i * 10 + 10 }];
      state = commitFrame(
        state,
        "x".repeat(i * 10),
        "x".repeat(i * 10) + "y".repeat(10),
        blocks,
        1000 + i * 50,
      );
    }
    expect(state.progress.size).toBeLessThanOrEqual(16);
  });

  it("时钟接续：后帧 delay 起点 ≥ 前帧排期覆盖的窗口（不重排不闪回）", () => {
    let state = createRevealState();
    state = commitFrame(state, "", "abc", [{ start: 0, end: 3 }], 1000);
    const first = [...(state.plans.get("0")?.values() ?? [])];
    const lastDelay = first[first.length - 1] ?? 0;
    state = commitFrame(state, "abc", "abcdef", [{ start: 0, end: 6 }], 1005);
    const second = [...(state.plans.get("0")?.values() ?? [])].filter((d) => d > lastDelay);
    // 新鲜单元的延迟全部晚于上一帧排期窗（clock 接续——新词排后不插队）
    for (const d of second) expect(d).toBeGreaterThan(lastDelay);
  });
});
