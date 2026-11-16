// 16ms 增量攒批（loop.md §3：loop 是合并唯一地点；首包不等待——定时器与首事件竞速；
// 结构事件永不攒批，opencode "block starts are not batched" 同规；16ms = 一帧，
// Claude Code Ink fork 的 FRAME_INTERVAL_MS = 16 同值）。

import type { LoopEvent } from "@reins/protocol";

const BATCH_WINDOW_MS = 16;

export class DeltaBatcher {
  #buffer: LoopEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #firstSeen = false;

  constructor(private readonly flush: (events: readonly LoopEvent[]) => void) {}

  /** 增量事件：入缓冲；首包立即透传（不等待窗口），后续按 16ms 窗口攒批 */
  pushDelta(event: LoopEvent): void {
    if (!this.#firstSeen) {
      this.#firstSeen = true;
      this.flush([event]);
      this.#timer = setTimeout(() => this.flushNow(), BATCH_WINDOW_MS);
      this.#timer.unref?.();
      return;
    }
    this.#buffer.push(event);
  }

  /** 结构事件：先冲缓冲（保序），再立即透传自身 */
  pushStructural(event: LoopEvent): void {
    this.flushNow();
    this.flush([event]);
  }

  /** 兜底冲刷（流结束 / 中断兜底补发，P6 纪律 4） */
  flushNow(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (this.#buffer.length > 0) {
      const batch = this.#buffer;
      this.#buffer = [];
      this.flush(batch);
    }
  }
}
