// 统一门面（D-037 / interfaces.md sdk 段定稿）：进程内 runtime 与远端 client 实现同一接口、
// 吐同一 ServerEvent 词表——"进程内与远程行为一致"由同一测试套件对双形态跑锁。
// 纯 TS 零 React（sdk 不携带界面，D-037）。

import type {
  Decision,
  PromptReceipt,
  ServerFrame,
  SessionSnapshot,
  SessionSummary,
} from "@henira/protocol";

export interface HeniraFacade {
  /** 收尾：runtime 释放会话锁与句柄；client 断开 SSE 连接 */
  stop(): Promise<void>;
  createSession(opts?: { cwd?: string }): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  /** D-045 单口：闲直跑 / 忙入队（id = 排队条目） */
  prompt(sessionId: string, text: string): Promise<PromptReceipt>;
  steer(sessionId: string, entryId: string): Promise<boolean>;
  interrupt(sessionId: string): Promise<void>;
  /** settle 幂等先答者赢；未知 requestId 返回 false */
  settleApproval(sessionId: string, requestId: string, decision: Decision): Promise<boolean>;
  /** 初始渲染 + 断档重拉共用出口（快照永远从账本重建） */
  snapshot(sessionId: string): Promise<SessionSnapshot>;
  /** 全局帧流（connected → 逐会话快照 → 增量）；远端形态内置重连 + 断档不猜（跳号即重拉快照换发） */
  events(): AsyncIterable<ServerFrame>;
}

/** 有界帧队列 → AsyncIterable（进程内形态与 SSE 连接共用；溢出即断——volatile 契约） */
export function frameQueue(cap = 256): {
  push: (frame: ServerFrame) => void;
  stream: () => AsyncGenerator<ServerFrame>;
} {
  const buffer: ServerFrame[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  return {
    push(frame) {
      if (ended) return;
      if (buffer.length >= cap) {
        ended = true; // 溢出断开：消费者 stream 结束，重连/重建职责在调用方
        wake?.();
        return;
      }
      buffer.push(frame);
      wake?.();
    },
    async *stream() {
      try {
        while (true) {
          while (buffer.length > 0) {
            yield buffer.shift() as ServerFrame;
          }
          if (ended) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        ended = true;
      }
    },
  };
}
