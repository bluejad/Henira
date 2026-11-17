// server 侧 InteractionService 实现①（packages.md 槽位归属：审批卡经 SSE 推给网页、答案经
// HTTP 端点收回——web 页是呈现端不是该槽位的实现者）。挂起状态 = 本实现的内存表；行投影由
// 账本驱动（approval/asked、approval/decided 落账 → 投影器），本处不重复投影。settle 幂等
// 先答者赢（protocol 契约）；abort 竞速 → cancelled；会话销毁全部挂起按 cancelled 收尾
// （不留悬挂 promise）。

import type { InteractionAnswer, InteractionRequest, InteractionService } from "@henira/protocol";

interface Pending {
  request: InteractionRequest;
  resolve: (answer: InteractionAnswer) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class ServerInteraction implements InteractionService {
  readonly #pending = new Map<string, Pending>();

  ask(req: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer> {
    return new Promise<InteractionAnswer>((resolve) => {
      const pending: Pending = { request: req, resolve, signal };
      this.#pending.set(req.requestId, pending);
      if (signal !== undefined) {
        if (signal.aborted) {
          this.#pending.delete(req.requestId);
          resolve({ kind: "approval", requestId: req.requestId, decision: "cancelled" });
          return;
        }
        pending.onAbort = (): void => {
          if (this.#pending.get(req.requestId) === pending) {
            this.#pending.delete(req.requestId);
            resolve({ kind: "approval", requestId: req.requestId, decision: "cancelled" });
          }
        };
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
    });
  }

  settle(requestId: string, answer: InteractionAnswer): boolean {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return false; // 未知 / 已答（幂等，先答者赢）
    this.#pending.delete(requestId);
    if (pending.onAbort !== undefined && pending.signal !== undefined) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    pending.resolve(answer);
    return true;
  }

  listPending(): readonly InteractionRequest[] {
    return [...this.#pending.values()].map((p) => p.request);
  }

  /** 会话销毁：全部挂起按 cancelled 收尾（fail-closed 收口） */
  dispose(): void {
    for (const pending of [...this.#pending.values()]) {
      if (pending.onAbort !== undefined && pending.signal !== undefined) {
        pending.signal.removeEventListener("abort", pending.onAbort);
      }
      pending.resolve({
        kind: "approval",
        requestId: pending.request.requestId,
        decision: "cancelled",
      });
    }
    this.#pending.clear();
  }
}
