// 空闲看门狗单测（R193）：provider 静默 → abort + 类型化错误；有 part 就一直续命。
import { DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS, LLM_STREAM_IDLE_TIMEOUT_CODE } from "@henira/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveIdleTimeoutMs, withIdleTimeout } from "./idle-stream.js";

function hanging(): AsyncIterable<number> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<number>>(() => {}), // 永不 settle（provider 停发）
        return: () => Promise.resolve({ done: true as const, value: undefined }),
      };
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveIdleTimeoutMs", () => {
  it("正数生效；缺失/0/负数/NaN 回落默认（0 不表示关闭）", () => {
    expect(resolveIdleTimeoutMs(2_000)).toBe(2_000);
    expect(resolveIdleTimeoutMs(undefined)).toBe(DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS);
    expect(resolveIdleTimeoutMs(0)).toBe(DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS);
    expect(resolveIdleTimeoutMs(-1)).toBe(DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS);
    expect(resolveIdleTimeoutMs(Number.NaN)).toBe(DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS);
    expect(resolveIdleTimeoutMs("5000")).toBe(DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS);
  });
});

describe("withIdleTimeout", () => {
  it("静默超限：先 abort 再抛 LlmError(LLM_STREAM_IDLE_TIMEOUT)", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const stream = withIdleTimeout(hanging(), {
      idleTimeoutMs: 1_000,
      abort: () => {
        aborted = true;
      },
    });
    const next = stream.next();
    // 先挂期望再推时钟：否则拒绝发生在 advance 内部、尚无处理器 → 假「未处理拒绝」
    const expectation = expect(next).rejects.toMatchObject({
      code: LLM_STREAM_IDLE_TIMEOUT_CODE,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
    expect(aborted).toBe(true);
  });

  it("每个 part 重置计时：间隔小于上限不误杀", async () => {
    vi.useFakeTimers();
    let aborted = false;
    async function* source(): AsyncGenerator<number> {
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        yield i;
      }
    }
    const stream = withIdleTimeout(source(), {
      idleTimeoutMs: 1_000,
      abort: () => {
        aborted = true;
      },
    });
    const seen: number[] = [];
    const consume = (async () => {
      for await (const value of stream) seen.push(value);
    })();
    await vi.advanceTimersByTimeAsync(2_000);
    await consume;
    expect(seen).toEqual([0, 1, 2]);
    expect(aborted).toBe(false);
  });

  it("正常结束（done）不触发 abort / 不抛错", async () => {
    async function* source(): AsyncGenerator<number> {
      yield 1;
    }
    const seen: number[] = [];
    let aborted = false;
    for await (const value of withIdleTimeout(source(), {
      idleTimeoutMs: 1_000,
      abort: () => {
        aborted = true;
      },
    })) {
      seen.push(value);
    }
    expect(seen).toEqual([1]);
    expect(aborted).toBe(false);
  });
});
