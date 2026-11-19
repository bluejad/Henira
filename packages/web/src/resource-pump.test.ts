// @vitest-environment node
// 数据泵单测（D-064 判据⑤核心语义）：共享订阅 / 2s 轮询 / 引用计数退订 / 失败保旧数据 /
// JSON 解析（对象进 data、标量与坏 JSON 走 text）。

import type { ResourceSnapshot } from "@henira/plugin-web-ui";
import type { ResourceReply } from "@henira/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createResourcePump } from "./resource-pump.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeDeps(overrides?: {
  execute?: (sessionId: string, pluginId: string, address: string) => Promise<ResourceReply>;
  sessionId?: string | null;
  pollMs?: number;
}): {
  calls: Array<{ sessionId: string; pluginId: string; address: string }>;
  execute: (sessionId: string, pluginId: string, address: string) => Promise<ResourceReply>;
  pump: ReturnType<typeof createResourcePump>;
} {
  const calls: Array<{ sessionId: string; pluginId: string; address: string }> = [];
  const sessionId = overrides?.sessionId === undefined ? "s-1" : overrides.sessionId;
  const execute =
    overrides?.execute ??
    (async () => ({ ok: true, text: JSON.stringify({ ok: 1 }), updatedAt: Date.now() }));
  const pump = createResourcePump({
    execute: async (sid, pluginId, address) => {
      calls.push({ sessionId: sid, pluginId, address });
      return execute(sid, pluginId, address);
    },
    getSessionId: () => sessionId,
    ...(overrides?.pollMs !== undefined ? { pollMs: overrides.pollMs } : {}),
  });
  return { calls, execute, pump };
}

describe("createResourcePump（useResource 数据泵，D-064）", () => {
  it("订阅即首拉 + 2s 轮询；末订阅者退订关泵", async () => {
    vi.useFakeTimers();
    const { calls, pump } = makeDeps({ pollMs: 2000 });
    const seen: ResourceSnapshot[] = [];
    const unsubscribe = pump.subscribe("henira-data://p/a/tool", "p", (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(0); // 首拉落定
    expect(seen[0]?.status).toBe("live");
    expect(calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.length).toBe(2);
    // 第二订阅者共享同一泵（不新增首拉，只挂进现订阅集）
    pump.subscribe("henira-data://p/a/tool", "p", () => {});
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.length).toBe(3); // 一个地址一个轮询
    unsubscribe();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.length).toBe(4); // 还有一个订阅者在
    pump.clearAll();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.length).toBe(4); // 全退订 → 轮询停
  });

  it("失败保留上次数据（status:'failed' 但 data/text/updatedAt 还在）；恢复后回 live", async () => {
    vi.useFakeTimers();
    let fail = false;
    const { pump } = makeDeps({
      pollMs: 2000,
      execute: async () =>
        fail
          ? { ok: false, error: "server down", updatedAt: Date.now() }
          : { ok: true, text: JSON.stringify({ n: 42 }), updatedAt: 111 },
    });
    const seen: ResourceSnapshot[] = [];
    pump.subscribe("henira-data://p/a/tool", "p", (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen[0]).toMatchObject({ status: "live", data: { n: 42 }, updatedAt: 111 });
    fail = true;
    await vi.advanceTimersByTimeAsync(2000);
    const failed = seen[seen.length - 1] ?? {};
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("server down");
    expect(failed.data).toEqual({ n: 42 }); // 失败保旧数据
    expect(failed.updatedAt).toBe(111); // updatedAt 也保旧（最后一次成功时刻）
    fail = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen[seen.length - 1]?.status).toBe("live");
  });

  it("JSON 解析语义：对象/数组进 data；标量与坏 JSON 只进 text；执行异常 → failed", async () => {
    vi.useFakeTimers();
    const replies: ResourceReply[] = [
      { ok: true, text: JSON.stringify([1, 2]), updatedAt: 1 },
      { ok: true, text: JSON.stringify("scalar"), updatedAt: 2 },
      { ok: true, text: "{{{", updatedAt: 3 },
      { ok: true, text: undefined, updatedAt: 4 },
    ];
    let i = 0;
    const { pump } = makeDeps({
      pollMs: 100,
      execute: async () => replies[i++] ?? { ok: false, error: "x", updatedAt: 9 },
    });
    const seen: ResourceSnapshot[] = [];
    pump.subscribe("henira-data://p/a/tool", "p", (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen[0]?.data).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(100);
    expect(seen[1]?.data).toBeUndefined(); // 标量不进 data
    expect(seen[1]?.text).toBe(JSON.stringify("scalar"));
    await vi.advanceTimersByTimeAsync(100);
    expect(seen[2]?.data).toBeUndefined(); // 坏 JSON 不进 data
    expect(seen[2]?.text).toBe("{{{");
    await vi.advanceTimersByTimeAsync(100);
    expect(seen[3]?.text).toBeUndefined(); // 空 text 无字段
    // 执行抛错（端点不可达）→ failed
    vi.useRealTimers();
    const { pump: pump2 } = makeDeps({
      execute: async () => {
        throw new Error("fetch failed");
      },
    });
    const seen2: ResourceSnapshot[] = [];
    pump2.subscribe("henira-data://p/a/tool", "p", (s) => seen2.push(s));
    await new Promise((r) => setTimeout(r, 10));
    expect(seen2[0]?.status).toBe("failed");
    expect(seen2[0]?.error).toBe("fetch failed");
  });

  it("上一跳未完成时跳过该 tick（慢工具不堆叠请求）", async () => {
    vi.useFakeTimers();
    let release: ((reply: ResourceReply) => void) | undefined;
    let calls = 0;
    const pump = createResourcePump({
      execute: () =>
        new Promise<ResourceReply>((resolve) => {
          calls += 1;
          release = resolve;
        }),
      getSessionId: () => "s-1",
      pollMs: 2000,
    });
    pump.subscribe("henira-data://p/a/tool", "p", () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(6000); // 三个 tick 都在飞，全部跳过
    expect(calls).toBe(1);
    release?.({ ok: true, text: "{}", updatedAt: 1 });
    await vi.advanceTimersByTimeAsync(0); // 落定后放行
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(2);
    pump.clearAll();
  });

  it("无会话：首拉即 failed（不打端点）；snapshotOf 读现值", async () => {
    const { calls, pump } = makeDeps({ sessionId: null });
    const seen: ResourceSnapshot[] = [];
    pump.subscribe("henira-data://p/a/tool", "p", (s) => seen.push(s));
    expect(seen[0]?.status).toBe("failed");
    expect(seen[0]?.error).toBe("no active session");
    expect(calls.length).toBe(0);
    expect(pump.snapshotOf("henira-data://p/a/tool")?.status).toBe("failed");
    expect(pump.snapshotOf("henira-data://other/x/y")).toBeUndefined();
  });
});
