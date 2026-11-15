import { beforeEach, describe, expect, it } from "vitest";
import type { FaultReporter, HarnessContext } from "./index.js";
import { createHarness, DoubleNextError } from "./index.js";

// 事件总线四模式 + 派发纪律（快照派发、异常隔离、double-next 守卫）。
// 语义对齐 cordis（[dsh] vendor/cordis/src/events.ts:165-243）；
// 有意差异：double-next 抛错（上游有、dsh fork 缺失，采上游）、emit 监听器异常隔离上报。

let faults: Array<{ err: unknown; where: string }>;
let report: FaultReporter;

beforeEach(() => {
  faults = [];
  report = (err, where) => faults.push({ err, where });
});

async function startHarness(setup: (ctx: HarnessContext) => void) {
  const h = createHarness({ report });
  h.use({ start: setup });
  await h.start();
  return h;
}

describe("emit —— 发完不管", () => {
  it("按注册顺序同步送达；监听器异常隔离上报，不外抛、不影响后续", async () => {
    const seen: string[] = [];
    const h = await startHarness((ctx) => {
      ctx.events.on("ping", () => {
        seen.push("a");
      });
      ctx.events.on("ping", () => {
        seen.push("b");
        throw new Error("boom");
      });
      ctx.events.on("ping", () => {
        seen.push("c");
      });
    });
    expect(() => h.context.events.emit("ping", 1)).not.toThrow();
    expect(seen).toEqual(["a", "b", "c"]);
    expect(faults).toHaveLength(1);
    expect(faults[0].where).toContain("emit(ping)");
  });

  it("fire-and-forget：emit 同步返回，不等异步监听器", async () => {
    let resolveAsync!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveAsync = resolve;
    });
    let reached = false;
    const h = await startHarness((ctx) => {
      ctx.events.on("x", async () => {
        await new Promise((r) => setTimeout(r, 10));
        reached = true;
        resolveAsync();
      });
    });
    h.context.events.emit("x", null);
    expect(reached).toBe(false); // emit 已返回，异步监听器还没完成
    await finished;
    expect(reached).toBe(true);
  });
});

describe("serial —— 顺序 await，异常上抛", () => {
  it("逐个 await：前一监听器完成才轮到下一个", async () => {
    const order: string[] = [];
    const h = await startHarness((ctx) => {
      ctx.events.onSerial("s", async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("slow-first");
      });
      ctx.events.onSerial("s", () => {
        order.push("fast-second");
      });
    });
    await h.context.events.serial("s", null);
    expect(order).toEqual(["slow-first", "fast-second"]);
  });

  it("异常向上抛，剩余监听器不再执行", async () => {
    let thirdCalled = false;
    const h = await startHarness((ctx) => {
      ctx.events.onSerial("s", async () => {
        throw new Error("serial boom");
      });
      ctx.events.onSerial("s", () => {
        thirdCalled = true;
      });
    });
    await expect(h.context.events.serial("s", null)).rejects.toThrow("serial boom");
    expect(thirdCalled).toBe(false);
  });
});

describe("waterfall —— 链式改写", () => {
  it("next(v) 依次把值传给下游", async () => {
    const h = await startHarness((ctx) => {
      ctx.events.onWaterfall<number>("w", (v, next) => next(v + 1));
      ctx.events.onWaterfall<number>("w", (v, next) => next(v * 10));
    });
    await expect(h.context.events.waterfall("w", 2)).resolves.toBe(30);
  });

  it("不调 next() 直接返回 = 否决下游，返回值成为最终结果（钉子④）", async () => {
    let secondRan = false;
    const h = await startHarness((ctx) => {
      ctx.events.onWaterfall<number>("w", () => 100);
      ctx.events.onWaterfall<number>("w", (v, next) => {
        secondRan = true;
        return next(v);
      });
    });
    await expect(h.context.events.waterfall("w", 1)).resolves.toBe(100);
    expect(secondRan).toBe(false);
  });

  it("无监听器 = 原值透传", async () => {
    const h = await startHarness(() => {});
    await expect(h.context.events.waterfall("w", "keep")).resolves.toBe("keep");
  });

  it("第二次调用 next() 抛 DoubleNextError（上游 cordis 行为，dsh fork 缺失，我们补上）", async () => {
    const h = await startHarness((ctx) => {
      ctx.events.onWaterfall<number>("w", (v, next) => {
        void next(v);
        return next(v);
      });
    });
    await expect(h.context.events.waterfall("w", 1)).rejects.toBeInstanceOf(DoubleNextError);
  });
});

describe("bail —— 顺序执行，第一个 Veto 即停", () => {
  it("undefined 继续，Veto 即停", async () => {
    let thirdRan = false;
    const veto = { by: "p2", reason: "denied" };
    const h = await startHarness((ctx) => {
      ctx.events.onBail("b", () => undefined);
      ctx.events.onBail("b", () => veto);
      ctx.events.onBail("b", () => {
        thirdRan = true;
        return undefined;
      });
    });
    await expect(h.context.events.bail("b", null)).resolves.toBe(veto);
    expect(thirdRan).toBe(false);
  });

  it("全部不反对 → undefined", async () => {
    const h = await startHarness((ctx) => {
      ctx.events.onBail("b", () => undefined);
      ctx.events.onBail("b", () => undefined);
    });
    await expect(h.context.events.bail("b", null)).resolves.toBeUndefined();
  });

  it("异步监听器被 await", async () => {
    const veto = { by: "slow", reason: "later" };
    const h = await startHarness((ctx) => {
      ctx.events.onBail("b", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return veto;
      });
    });
    await expect(h.context.events.bail("b", null)).resolves.toBe(veto);
  });
});

describe("派发纪律（cordis 快照语义，vendor/cordis/src/events.ts:165-175）", () => {
  it("派发中途注册的监听器本轮不触发，下轮生效", async () => {
    const seen: string[] = [];
    const h = await startHarness((ctx) => {
      let registered = false;
      ctx.events.on("x", () => {
        seen.push("A");
        if (!registered) {
          registered = true;
          ctx.events.on("x", () => seen.push("B"));
        }
      });
    });
    h.context.events.emit("x", null);
    expect(seen).toEqual(["A"]);
    h.context.events.emit("x", null);
    expect(seen).toEqual(["A", "A", "B"]);
  });

  it("派发中途移除的监听器本轮仍触发（快照语义）", async () => {
    const seen: string[] = [];
    const h = await startHarness((ctx) => {
      let offB: (() => void) | undefined;
      ctx.events.on("x", () => {
        seen.push("A");
        offB?.();
      });
      const d = ctx.events.on("x", () => seen.push("B"));
      offB = d;
    });
    h.context.events.emit("x", null);
    expect(seen).toEqual(["A", "B"]);
    h.context.events.emit("x", null);
    expect(seen).toEqual(["A", "B", "A"]);
  });
});
