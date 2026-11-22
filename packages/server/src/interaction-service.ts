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

/** 取消收口按请求种类给答案（abort / 会话销毁共用；question 的取消是独立变体） */
function cancelledAnswer(request: InteractionRequest): InteractionAnswer {
  return request.kind === "approval"
    ? { kind: "approval", requestId: request.requestId, decision: "cancelled" }
    : { kind: "question", requestId: request.requestId, cancelled: true };
}

export class ServerInteraction implements InteractionService {
  readonly #pending = new Map<string, Pending>();
  /** 已答过的 requestId（R175：settle false 后区分「已答过」与「从不存在」——REST 对后者 404） */
  readonly #answered = new Set<string>();

  ask(req: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer> {
    return new Promise<InteractionAnswer>((resolve) => {
      const pending: Pending = { request: req, resolve, signal };
      this.#pending.set(req.requestId, pending);
      if (signal !== undefined) {
        if (signal.aborted) {
          this.#pending.delete(req.requestId);
          resolve(cancelledAnswer(req));
          return;
        }
        pending.onAbort = (): void => {
          if (this.#pending.get(req.requestId) === pending) {
            this.#pending.delete(req.requestId);
            resolve(cancelledAnswer(req));
          }
        };
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
    });
  }

  knows(requestId: string): boolean {
    return this.#pending.has(requestId) || this.#answered.has(requestId);
  }

  settle(requestId: string, answer: InteractionAnswer): boolean {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return false; // 未知 / 已答（幂等，先答者赢）
    // 种类必须匹配：审批端点不能替提问作答（反之亦然）——防跨通道误收
    if (pending.request.kind !== answer.kind) return false;
    this.#pending.delete(requestId);
    this.#answered.add(requestId);
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
      pending.resolve(cancelledAnswer(pending.request));
      this.#answered.add(pending.request.requestId);
    }
    this.#pending.clear();
  }
}
