// @vitest-environment node
// plugin-breaker 单测（D-058 / D-065）：双机制——回合内提醒（连续同形 ≥ 阈值 → 追加
// user/message{source:"breaker"} 行）、回合尾否决（bail 缝返回 Veto + resume 续跑提示）、
// 阈值 settings 可配、回合切换重置、不同形不打断、每回合至多一次否决。

import { createHarness, type ServiceDefinition } from "@henira/kernel";
import { asHeniraContext, type SessionEventInput, type SessionService } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { breakerPlugin } from "./index.js";

interface Fixture {
  ctx: ReturnType<typeof asHeniraContext>;
  appended: { type: string; data: Record<string, unknown> }[];
}

async function mount(
  pluginOptions?: Parameters<typeof breakerPlugin>[0],
  settingsOptions?: Record<string, number>,
): Promise<Fixture> {
  const appended: { type: string; data: Record<string, unknown> }[] = [];
  const fakeSession = {
    append: async (input: SessionEventInput) => {
      appended.push({ type: input.type, data: input.data as Record<string, unknown> });
      return { seq: appended.length } as never;
    },
  } as unknown as SessionService;
  const fakeConfig = {
    get: async <T>() => settingsOptions as T,
  };
  const harness = createHarness()
    .use({ name: "session", start: () => fakeSession } as ServiceDefinition)
    .use({ name: "config", start: () => fakeConfig } as ServiceDefinition)
    .use(breakerPlugin(pluginOptions));
  await harness.start();
  return { ctx: asHeniraContext(harness.context), appended };
}

const ALLOW = { verdict: "allow" as const };

async function callSame(
  ctx: Fixture["ctx"],
  times: number,
  args = '{"text":"loop"}',
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await ctx.events.waterfall("tools/pre-execute", {
      tool: "echo",
      args: JSON.parse(args),
      ...ALLOW,
    });
  }
}

describe("plugin-breaker 双机制", () => {
  it("① 回合内提醒：第 3 次连续同形调用追加 user/message{source:breaker} 行，封顶 2 条", async () => {
    const { ctx, appended } = await mount();
    ctx.events.emit("turn/start", { turn: "t1" });
    ctx.events.emit("step/start", { turn: "t1", step: 1 });

    await callSame(ctx, 2);
    expect(appended).toHaveLength(0); // 未到阈值
    await callSame(ctx, 1);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.type).toBe("user/message");
    expect(appended[0]?.data).toMatchObject({ turn: "t1", step: 1, source: "breaker" });
    expect(String(appended[0]?.data.content)).toContain("Circuit breaker");

    await callSame(ctx, 2); // streak 4,5 —— 不在新档位
    expect(appended).toHaveLength(1);
    await callSame(ctx, 1); // streak 6 = 2× 档位 → 第 2 条提醒
    expect(appended).toHaveLength(2);

    await callSame(ctx, 6); // streak 7..12 封顶后不再追加
    expect(appended).toHaveLength(2);
  });

  it("① 不同形调用重置连续计数，不触发提醒", async () => {
    const { ctx, appended } = await mount();
    ctx.events.emit("turn/start", { turn: "t1" });
    ctx.events.emit("step/start", { turn: "t1", step: 1 });
    await callSame(ctx, 2);
    await ctx.events.waterfall("tools/pre-execute", {
      tool: "echo",
      args: { text: "other" },
      ...ALLOW,
    });
    await callSame(ctx, 2);
    expect(appended).toHaveLength(0);
  });

  it("② 回合尾否决：同形超限 → bail 返回 Veto（by/reason/resume），且每回合至多一次", async () => {
    const { ctx } = await mount();
    ctx.events.emit("turn/start", { turn: "t1" });
    ctx.events.emit("step/start", { turn: "t1", step: 1 });
    await callSame(ctx, 3);

    const veto = await ctx.events.bail("loop/turn-stopping", { turn: "t1", reason: "completed" });
    expect(veto).not.toBeUndefined();
    expect(veto?.by).toBe("plugin-breaker");
    expect(veto?.resume?.prompt).toContain("Circuit breaker");
    expect(veto?.resume?.prompt).toContain("repeated");

    const again = await ctx.events.bail("loop/turn-stopping", { turn: "t1", reason: "completed" });
    expect(again).toBeUndefined();
  });

  it("② 步数否决：阈值可由工厂 opts 配置（maxStepsPerTurn=2），turn/end 后重置", async () => {
    const { ctx } = await mount({ maxStepsPerTurn: 2 });
    ctx.events.emit("turn/start", { turn: "t1" });
    ctx.events.emit("step/start", { turn: "t1", step: 1 });
    ctx.events.emit("step/start", { turn: "t1", step: 2 });
    const veto = await ctx.events.bail("loop/turn-stopping", { turn: "t1", reason: "completed" });
    expect(veto?.reason).toContain("step limit");
    ctx.events.emit("turn/end", { turn: "t1", reason: "completed" });

    ctx.events.emit("turn/start", { turn: "t2" });
    ctx.events.emit("step/start", { turn: "t2", step: 1 });
    const clean = await ctx.events.bail("loop/turn-stopping", { turn: "t2", reason: "completed" });
    expect(clean).toBeUndefined();
  });

  it("阈值 settings 可配（config.get('plugin-breaker') 覆盖默认；非法值被剔）", async () => {
    const { ctx } = await mount(undefined, { maxRepeatsPerCall: 2, maxStepsPerTurn: Number.NaN });
    ctx.events.emit("turn/start", { turn: "t1" });
    ctx.events.emit("step/start", { turn: "t1", step: 1 });
    await callSame(ctx, 2); // settings 阈值 2 → 即刻触发
    const veto = await ctx.events.bail("loop/turn-stopping", { turn: "t1", reason: "completed" });
    expect(veto?.reason).toContain("repeated 2 times");
  });

  it("未超限不否决（正常回合零干预）；无 stats 的回合不否决", async () => {
    const { ctx } = await mount();
    const noTurn = await ctx.events.bail("loop/turn-stopping", {
      turn: "ghost",
      reason: "completed",
    });
    expect(noTurn).toBeUndefined();

    ctx.events.emit("turn/start", { turn: "t1" });
    ctx.events.emit("step/start", { turn: "t1", step: 1 });
    await callSame(ctx, 1);
    const clean = await ctx.events.bail("loop/turn-stopping", { turn: "t1", reason: "completed" });
    expect(clean).toBeUndefined();
  });
});
