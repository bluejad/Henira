import { describe, expect, it, vi } from "vitest";
import { DeltaBatcher } from "./batcher.js";

// 16ms 攒批（loop.md §3）：首包不等待、后续窗口攒批、结构事件冲缓冲后立即透传、flushNow 兜底。

function makeBatcher() {
  const flush = vi.fn();
  const batches = () =>
    flush.mock.calls.map((c) => (c[0] as unknown[]).map((e) => (e as { text?: string }).text ?? e));
  return { flush, batches, batcher: new DeltaBatcher(flush) };
}

describe("DeltaBatcher（16ms 合并）", () => {
  it("首包不等待：第一个 delta 立即透传", () => {
    vi.useFakeTimers();
    const { flush, batches, batcher } = makeBatcher();
    batcher.pushDelta({ type: "text-delta", text: "首包" });
    expect(batches()).toEqual([["首包"]]);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("窗口内后续 delta 攒批，定时器到点一次冲出", () => {
    vi.useFakeTimers();
    const { flush, batches, batcher } = makeBatcher();
    batcher.pushDelta({ type: "text-delta", text: "首包" });
    batcher.pushDelta({ type: "text-delta", text: "二" });
    batcher.pushDelta({ type: "reasoning-delta", text: "思" });
    expect(flush).toHaveBeenCalledTimes(1); // 还在窗口里
    vi.advanceTimersByTime(17);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(batches()[1]).toEqual(["二", "思"]);
    vi.useRealTimers();
  });

  it("结构事件先冲缓冲再透传（保序：增量先于结构）", () => {
    vi.useFakeTimers();
    const { batches, batcher } = makeBatcher();
    batcher.pushDelta({ type: "text-delta", text: "首包" });
    batcher.pushDelta({ type: "text-delta", text: "缓冲中" });
    batcher.pushStructural({ type: "tool-started", callId: "c1", name: "read" });
    const batchesOut = batches();
    expect(batchesOut[1]).toEqual(["缓冲中"]); // 先冲缓冲
    expect(batchesOut[2]).toEqual([{ type: "tool-started", callId: "c1", name: "read" }]); // 结构紧随
    vi.useRealTimers();
  });

  it("flushNow 兜底：取消定时器并冲出全部（中断兜底补发）", () => {
    vi.useFakeTimers();
    const { flush, batches, batcher } = makeBatcher();
    batcher.pushDelta({ type: "text-delta", text: "首包" });
    batcher.pushDelta({ type: "text-delta", text: "兜底" });
    batcher.flushNow();
    expect(batches()[1]).toEqual(["兜底"]);
    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledTimes(2); // 定时器已取消，不重复冲
    vi.useRealTimers();
  });
});
