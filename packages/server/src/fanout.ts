// SSE 扇出层（interfaces.md server 段）：seq 按会话编发（快照帧携带当前水位、增量帧 +1 单调
// ——断档不猜纪律的服务端半边）；每订阅者有界队列在连接侧（app.ts），push 抛出 = 溢出断开
// （volatile 契约：断线不补发，客户端重连 = connected + 全量快照）。

import type { Delta, ServerFrame, SessionSnapshot } from "@henira/protocol";

/** 订阅者的 push 在其有界队列溢出时抛错——扇出即标记断开（客户端重连重拉快照） */
export type FrameSink = (frame: ServerFrame) => void;

export class Fanout {
  readonly #subscribers = new Map<object, FrameSink>();
  readonly #seq = new Map<string, number>();
  readonly #startedAt = Date.now();
  readonly #version: string;

  constructor(version: string) {
    this.#version = version;
  }

  connectedFrame(): ServerFrame {
    return { kind: "connected", server: { version: this.#version, startedAt: this.#startedAt } };
  }

  /** 该会话当前水位（快照帧携带；此后增量帧 +1 单调） */
  currentSeq(sessionId: string): number {
    return this.#seq.get(sessionId) ?? 0;
  }

  /** 投影增量 → 每增量一帧（seq 单调 +1），推给全部在订者 */
  publish(sessionId: string, deltas: readonly Delta[]): void {
    for (const delta of deltas) {
      const seq = this.currentSeq(sessionId) + 1;
      this.#seq.set(sessionId, seq);
      this.#deliver({ kind: "delta", sessionId, seq, delta });
    }
  }

  /** 快照帧直推（新会话上线 / 重投影后刷新在订者；seq = 当前水位） */
  deliverSnapshot(sessionId: string, snapshot: Omit<SessionSnapshot, "seq">): void {
    this.#deliver({
      kind: "snapshot",
      sessionId,
      snapshot: { ...snapshot, seq: this.currentSeq(sessionId) },
    });
  }

  /** 订阅；返回退订函数。同一 push 的重复订阅以同一 key 去重 */
  subscribe(key: object, sink: FrameSink): () => void {
    this.#subscribers.set(key, sink);
    return () => {
      this.#subscribers.delete(key);
    };
  }

  #deliver(frame: ServerFrame): void {
    for (const [key, sink] of [...this.#subscribers]) {
      try {
        sink(frame);
      } catch {
        this.#subscribers.delete(key); // 溢出 / 失效 = 断开（volatile）
      }
    }
  }
}
