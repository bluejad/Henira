// onTurnFinished 记账（D-028 / D-085 / D-086）：按会话记「自己直接发起、尚未收口的回合」。
// 四条纪律：
// - 先记后发：prompt 的 HTTP 回执可能晚于终局帧（快回合 race）——发起时就计入；
// - 排队回执不当场出账：登记条目 id，等账本 `user/message.queueId` 回声对回再记信用（D-086）；
// - 每会话 busy→false 消耗一次信用；是否投递由调用方再按「当前会话」判定（只认当前会话）；
// - 快照对账：`connected`（重连）清空断线前的信用；快照 busy 与本地起点冲突（错过终局）
//   时一并出清——否则旧信用会泄漏到下一轮冒领。快照 busy=true 只补起点、不动信用
//   （重连后仍在途的排队回合要靠它结算）。

export interface TurnLedger {
  /** 发起一次 sendPrompt（在 await 之前调用） */
  sent(sessionId: string): void;
  /** 该次发送没有开出直接回合（提交失败）——当场出账 */
  settle(sessionId: string): void;
  /** 排队回执登记（receipt.id !== null）：等行流回声对回 */
  queued(sessionId: string, queueId: string): void;
  /** 行流回声命中 = 移除登记并返回 true（调用方随即记一次信用）；未登记返回 false */
  match(sessionId: string, queueId: string): boolean;
  /** busy 沿：true 只记录，false 沿消耗一次信用并返回「该会话这一轮是否要投终局」
   *  （调用方仍需判当前会话——非当前会话也要消耗，否则信用泄漏到下一轮冒领） */
  onBusy(sessionId: string, busy: boolean): boolean;
  /** 快照对账：busy=true 只补起点；busy=false 且本地还挂着起点 = 错过终局 → 清信用与起点 */
  sync(sessionId: string, busy: boolean): void;
  /** connected（重连）：断线期间的 busy 沿不可知，一律出清信用与起点（排队登记保留） */
  reset(): void;
  /** 待收口回合数（测试 / 排查用） */
  pending(sessionId: string): number;
}

export function createTurnLedger(): TurnLedger {
  const pending = new Map<string, number>();
  const busyFlags = new Map<string, boolean>();
  /** 自己排的队、尚未在账本里回声的条目 id（按会话；死 id 不回收——随机串不会误配） */
  const queued = new Map<string, Set<string>>();

  /** 消耗一次信用；无信用返回 false */
  const consume = (sessionId: string): boolean => {
    const count = pending.get(sessionId) ?? 0;
    if (count <= 0) return false;
    if (count === 1) pending.delete(sessionId);
    else pending.set(sessionId, count - 1);
    return true;
  };

  return {
    sent(sessionId) {
      pending.set(sessionId, (pending.get(sessionId) ?? 0) + 1);
    },
    settle(sessionId) {
      consume(sessionId);
    },
    queued(sessionId, queueId) {
      const set = queued.get(sessionId) ?? new Set<string>();
      set.add(queueId);
      queued.set(sessionId, set);
    },
    match(sessionId, queueId) {
      const set = queued.get(sessionId);
      if (set === undefined || !set.delete(queueId)) return false;
      if (set.size === 0) queued.delete(sessionId);
      return true;
    },
    sync(sessionId, busy) {
      // 快照断言「现在忙」：只补起点（重连后仍在途的排队回合靠它结算，信用不动）
      if (busy) {
        busyFlags.set(sessionId, true);
        return;
      }
      // 快照断言「现在不忙」而本地还挂着起点 = 断线/丢帧期间错过了终局：
      // 这份信用不可信（会冒领到下一轮），连起点一起出清
      if (busyFlags.get(sessionId) === true) {
        busyFlags.delete(sessionId);
        pending.delete(sessionId);
      }
    },
    reset() {
      pending.clear();
      busyFlags.clear();
    },
    onBusy(sessionId, value) {
      const was = busyFlags.get(sessionId) ?? false;
      if (value) {
        busyFlags.set(sessionId, true);
        return false;
      }
      busyFlags.delete(sessionId);
      if (!was) return false; // 未见 busy 起点 = 不是一整轮（断线重连快照等），不消耗
      return consume(sessionId);
    },
    pending(sessionId) {
      return pending.get(sessionId) ?? 0;
    },
  };
}
