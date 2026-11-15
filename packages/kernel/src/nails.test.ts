import { describe, expect, it } from "vitest";
import type { HarnessContext } from "./index.js";
import { createHarness } from "./index.js";

// D-023 五条语义钉子。出处：[dsh] vendor/README.md 第 6 条
// （"lifecycle hardening: locally closes three reentrant disposal gaps"）
// + vendor/cordis/src/fiber.ts（:265-297 重入卸载、:517-520 setup 先挂归属、
// :310-318 pending inject、:418-422 UNLOADING 拒绝注册）、events.ts:228（waterfall 否决）。
// 我们的内核是静态装配（D-011，不做热加载），钉子③按计划映射为启动期语义。

describe("钉子① 重入卸载：dispose 中再 dispose 合入同一次卸载，不重复收尾", () => {
  it("并发两次 dispose 共享同一次卸载", async () => {
    let stopCount = 0;
    let effectCount = 0;
    const h = createHarness();
    h.use({
      name: "a",
      start(ctx) {
        ctx.effect(() => () => effectCount++);
        return "a";
      },
      stop() {
        stopCount++;
      },
    });
    await h.start();
    await Promise.all([h.dispose(), h.dispose()]);
    expect(stopCount).toBe(1);
    expect(effectCount).toBe(1);
  });

  it("清理动作里再调 dispose()：拿到同一个在途 Promise，卸载照常完成、只收尾一次", async () => {
    const seq: string[] = [];
    const h = createHarness();
    h.use({
      name: "a",
      start(ctx) {
        ctx.effect(() => () => {
          void h.dispose();
        });
        return "a";
      },
      stop() {
        seq.push("stop");
      },
    });
    await h.start();
    await h.dispose();
    expect(seq).toEqual(["stop"]);
  });
});

describe("钉子② setup 内注册：start 体注册即挂本插件生命周期；中途抛错已注册的逆序回滚", () => {
  it("start 体注册的监听/effect 生效，卸载时随插件撤销", async () => {
    const seen: number[] = [];
    let effectUndone = 0;
    const h = createHarness();
    h.use({
      name: "a",
      start(ctx) {
        ctx.events.on("tick", (p) => seen.push(p as number));
        ctx.effect(() => () => {
          effectUndone++;
        });
      },
    });
    await h.start();
    h.context.events.emit("tick", 7);
    expect(seen).toEqual([7]);
    await h.dispose();
    expect(effectUndone).toBe(1);
    h.context.events.emit("tick", 8);
    expect(seen).toEqual([7]); // 卸载后监听器已撤销，不再送达
  });

  it("start 抛错前已注册的 effect 被回滚", async () => {
    let undone = 0;
    const h = createHarness({ report: () => {} });
    h.use({
      name: "a",
      start(ctx) {
        ctx.effect(() => () => {
          undone++;
        });
        throw new Error("setup boom");
      },
    });
    await expect(h.start()).rejects.toThrow("setup boom");
    expect(undone).toBe(1);
  });
});

describe("钉子③ pending 新增 inject 的静态等价（D-011 静态装配下的映射）", () => {
  it("依赖的 start 体先于依赖者执行（拓扑序，先启后用）", async () => {
    const order: string[] = [];
    const h = createHarness();
    h.use({
      name: "dep",
      start() {
        order.push("dep");
        return "dep-svc";
      },
    });
    h.use({
      name: "user",
      inject: ["dep"],
      start(ctx) {
        order.push("user");
        void ctx.get("dep");
      },
    });
    await h.start();
    expect(order).toEqual(["dep", "user"]);
  });

  it("依赖未启动时 get 被拒并引导声明 inject（拒绝而非静默）", async () => {
    const h = createHarness();
    h.use({
      name: "early",
      start(ctx) {
        ctx.get("late");
      },
    });
    h.use({
      name: "late",
      start() {
        return "x";
      },
    });
    await expect(h.start()).rejects.toThrow(/inject/);
  });

  it("start 中途失败 → 已启动者全部逆序回滚，未启动者不启动", async () => {
    const seq: string[] = [];
    const h = createHarness({ report: () => {} });
    h.use({
      name: "a",
      start(ctx) {
        ctx.effect(() => () => seq.push("a-effect"));
        return "a";
      },
      stop() {
        seq.push("a-stop");
      },
    });
    h.use({
      name: "b",
      inject: ["a"],
      start() {
        throw new Error("x");
      },
    });
    h.use({
      name: "c",
      inject: ["a"],
      start() {
        seq.push("c-start");
      },
    });
    try {
      await h.start();
    } catch {
      // 预期失败
    }
    expect(seq).toEqual(["a-effect", "a-stop"]);
    expect(seq).not.toContain("c-start");
  });
});

describe("钉子④ waterfall 否决：不调 next() 即短路（策略监听器拥有决定权）", () => {
  it("判定缝式用法：第一个返回决定的监听器终结链条", async () => {
    const h = createHarness();
    h.use({
      name: "policy",
      start(ctx) {
        ctx.events.onWaterfall<{ action: string }>("gate", () => ({ action: "deny" }));
      },
    });
    h.use({
      name: "downstream",
      start(ctx) {
        ctx.events.onWaterfall<{ action: string }>("gate", (v, next) => next(v));
      },
    });
    await h.start();
    await expect(h.context.events.waterfall("gate", { action: "allow" })).resolves.toEqual({
      action: "deny",
    });
  });
});

describe("钉子⑤ unloading 拒绝注册：卸载开始后 effect/on 一律抛错", () => {
  it("dispose 期间 ctx.effect 与 ctx.events.on 抛 InactiveEffectError，不影响其余清理", async () => {
    const caught: string[] = [];
    const seq: string[] = [];
    const h = createHarness({ report: () => {} });
    h.use({
      name: "a",
      start(ctx) {
        ctx.effect(() => () => {
          try {
            ctx.effect(() => {});
          } catch (e) {
            caught.push(`effect:${(e as Error).name}`);
          }
          try {
            ctx.events.on("x", () => {});
          } catch (e) {
            caught.push(`on:${(e as Error).name}`);
          }
        });
        return "a";
      },
      stop() {
        seq.push("a-stop");
      },
    });
    await h.start();
    await h.dispose();
    expect(caught).toEqual(["effect:InactiveEffectError", "on:InactiveEffectError"]);
    expect(seq).toEqual(["a-stop"]); // 抛错的 disposer 被捕获上报，stop 照常
  });

  it("stop() 里的注册同样被拒", async () => {
    const caught: string[] = [];
    const h = createHarness({ report: () => {} });
    let ctxRef: HarnessContext | undefined;
    h.use({
      name: "a",
      start(ctx) {
        ctxRef = ctx;
        return "a";
      },
      stop() {
        try {
          ctxRef?.effect(() => {});
        } catch (e) {
          caught.push((e as Error).name);
        }
      },
    });
    await h.start();
    await h.dispose();
    expect(caught).toEqual(["InactiveEffectError"]);
  });
});
