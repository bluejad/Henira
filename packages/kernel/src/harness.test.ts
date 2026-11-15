import { describe, expect, it } from "vitest";
import {
  AssemblyError,
  createHarness,
  MissingSlotError,
  SlotConflictError,
  SlotNotStartedError,
  UseAfterStartError,
} from "./index.js";

// 装配语义：interfaces.md kernel 段"四种情况必须报清楚" + 依赖图拓扑排序 + 逆序卸载。

describe("四种情况必须报清楚（interfaces.md 表）", () => {
  it('get 不存在的槽位 → MissingSlotError，消息含"谁在要"与可用槽位', async () => {
    const h = createHarness();
    h.use({
      name: "loop",
      start(ctx) {
        ctx.get("llm");
      },
    });
    let err: unknown;
    try {
      await h.start();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MissingSlotError);
    const msg = (err as Error).message;
    expect(msg).toContain('"loop"');
    expect(msg).toContain('"llm"');
  });

  it("两个插件抢同一槽位名 → use() 立刻抛，不等 start()", () => {
    const h = createHarness();
    h.use({ name: "loop", start() {} });
    expect(() => h.use({ name: "loop", start() {} })).toThrow(SlotConflictError);
  });

  it("start() 之后再 use() → 抛错（静态装配，D-011）", async () => {
    const h = createHarness();
    h.use({
      name: "a",
      start() {
        return 1;
      },
    });
    await h.start();
    expect(() => h.use({ name: "b", start() {} })).toThrow(UseAfterStartError);
  });

  it("inject 缺失 → start() 统一静态检查、一次报全", async () => {
    const h = createHarness();
    h.use({ name: "loop", inject: ["llm", "tools"], start() {} });
    h.use({ name: "approval", inject: ["llm"], start() {} });
    let err: unknown;
    try {
      await h.start();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AssemblyError);
    const msg = (err as Error).message;
    expect(msg).toContain('"loop"');
    expect(msg).toContain('"tools"');
    expect(msg).toContain('"approval"'); // 一次报全：两个插件的缺失在同一条消息
  });

  it("inject 缺失时不启动任何插件", async () => {
    const started: string[] = [];
    const h = createHarness();
    h.use({
      name: "ok",
      start() {
        started.push("ok");
      },
    });
    h.use({ name: "bad", inject: ["missing"], start() {} });
    try {
      await h.start();
    } catch {
      // 预期失败
    }
    expect(started).toEqual([]);
  });
});

describe("依赖图启动", () => {
  it("按拓扑序启动：use() 顺序在后不影响依赖先启", async () => {
    const order: string[] = [];
    const h = createHarness();
    h.use({
      name: "loop",
      inject: ["llm"],
      start(ctx) {
        order.push("loop");
        expect(ctx.get<string>("llm")).toBe("llm-svc");
        return "loop-svc";
      },
    });
    h.use({
      name: "llm",
      start() {
        order.push("llm");
        return "llm-svc";
      },
    });
    await h.start();
    expect(order).toEqual(["llm", "loop"]);
    expect(h.context.get("loop")).toBe("loop-svc");
  });

  it("依赖环 → AssemblyError 报出环路径", async () => {
    const h = createHarness();
    h.use({ name: "a", inject: ["b"], start() {} });
    h.use({ name: "b", inject: ["a"], start() {} });
    let err: unknown;
    try {
      await h.start();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AssemblyError);
    const msg = (err as Error).message;
    expect(msg).toContain("cycle");
    expect(msg).toContain("a");
    expect(msg).toContain("b");
  });

  it("启动期 get 已注册未启动的槽位 → SlotNotStartedError，引导声明 inject（钉子③ 静态等价）", async () => {
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
    let err: unknown;
    try {
      await h.start();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SlotNotStartedError);
    expect((err as Error).message).toContain("inject");
  });
});

describe("服务与卸载", () => {
  it("get 返回 start() 返回值；stop 收到同一服务实例", async () => {
    let stoppedWith: unknown;
    const svc = { close: () => {} };
    const h = createHarness();
    h.use({
      name: "a",
      start() {
        return svc;
      },
      stop(s) {
        stoppedWith = s;
      },
    });
    await h.start();
    expect(h.context.get("a")).toBe(svc);
    await h.dispose();
    expect(stoppedWith).toBe(svc);
  });

  it("dispose 逆序 unwind：后启动的先收尾；effect 撤销先于 stop", async () => {
    const seq: string[] = [];
    const h = createHarness();
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
      start(ctx) {
        ctx.effect(() => () => seq.push("b-effect"));
        return "b";
      },
      stop() {
        seq.push("b-stop");
      },
    });
    await h.start();
    await h.dispose();
    expect(seq).toEqual(["b-effect", "b-stop", "a-effect", "a-stop"]);
  });

  it("effect 返回的 Disposable 幂等：调两次只撤销一次，dispose 不再重复", async () => {
    let count = 0;
    const h = createHarness();
    let off: (() => void) | undefined;
    h.use({
      name: "a",
      start(ctx) {
        off = ctx.effect(() => () => {
          count++;
        });
      },
    });
    await h.start();
    off?.();
    off?.();
    expect(count).toBe(1);
    await h.dispose();
    expect(count).toBe(1);
  });

  it("卸载中某个 disposer 抛错不阻塞其他清理（错误上报）", async () => {
    const seq: string[] = [];
    const faults: unknown[] = [];
    const h = createHarness({ report: (err) => faults.push(err) });
    h.use({
      name: "a",
      start(ctx) {
        ctx.effect(() => () => {
          throw new Error("bad disposer");
        });
        ctx.effect(() => () => seq.push("after-bad"));
        return "a";
      },
      stop() {
        seq.push("a-stop");
      },
    });
    await h.start();
    await h.dispose();
    expect(seq).toEqual(["after-bad", "a-stop"]);
    expect(faults).toHaveLength(1);
  });

  it("dispose 后 get 抛 MissingSlotError", async () => {
    const h = createHarness();
    h.use({
      name: "a",
      start() {
        return "a";
      },
    });
    await h.start();
    await h.dispose();
    expect(() => h.context.get("a")).toThrow(MissingSlotError);
  });

  it("启动中途失败：原错误上抛，已启动者逆序回滚，未启动者不启动", async () => {
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
      start(ctx) {
        ctx.effect(() => () => seq.push("b-effect"));
        throw new Error("b failed");
      },
    });
    h.use({
      name: "c",
      inject: ["a"],
      start() {
        seq.push("c-start");
      },
    });
    let err: unknown;
    try {
      await h.start();
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toBe("b failed");
    expect(seq).toEqual(["b-effect", "a-effect", "a-stop"]); // 失败者自身清理 → 逆序回滚已启动
    expect(seq).not.toContain("c-start");
  });

  it("start() 进行中调 dispose()：启动中止、全部回滚、dispose 等到卸载完成", async () => {
    const seq: string[] = [];
    const h = createHarness({ report: () => {} });
    h.use({
      name: "slow",
      async start(ctx) {
        await new Promise((r) => setTimeout(r, 10));
        seq.push("slow-started");
        ctx.effect(() => () => seq.push("slow-effect"));
        return "s";
      },
      stop() {
        seq.push("slow-stop");
      },
    });
    h.use({
      name: "next",
      inject: ["slow"],
      start() {
        seq.push("next-start");
      },
    });
    const startP = h.start();
    const disposeP = h.dispose(); // 启动进行中触发卸载
    await expect(startP).rejects.toThrow("disposed during start");
    await disposeP;
    expect(seq).toEqual(["slow-started", "slow-effect", "slow-stop"]); // slow 完成即回滚，next 不启动
  });
});
