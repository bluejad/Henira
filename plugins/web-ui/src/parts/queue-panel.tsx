// 官方件：排队卡（E1 2026-11-20）。数据源 = store 快照 state.queue（SessionState 投影态，
// server/sdk 经 queue/changed → state.updated 同通道推送；快照携带 → 断线重连自洽）。
// 队列与插话待进场条目同面板呈现、徽章区分（流内 pending 气泡本地回显挂账 50-open）。
// 行操作：立即发送 = promote 抢占式升格（停止当前回合并以该条开新回合；忙/闲/冻结三态
// 都可点——闲时 preempt 变 no-op 直接发这条）；编辑 = 文本回填 composer 草稿 + 条目删除
// （跨窗口冻结锁挂账）；删除 = removeQueueEntry。
// 中断冻结：队列非空时中断不冲刷——queuePaused 态头部切「队列已暂停」+「继续发送」
// （resumeQueue 恢复冲刷）。渲染条件 = 队列非空且（busy 或冻结）：回合末 busy 翻 false
// 与冲刷广播之间有瞬态窗口，两侧都不满足时隐藏（防每对回合间面板闪现）。
// 空队列不渲染（不打扰）；审批接管不受影响（面板位于审批卡之下、输入卡之上）。

import type { QueuedPrompt } from "@henira/protocol";
import { useSyncExternalStore } from "react";
import type { WebPartContext } from "../types.js";
import { PencilGlyph, SendNowGlyph, XGlyph } from "./icons.js";

const EMPTY_QUEUE: QueuedPrompt[] = [];

export function QueuePanel({
  ctx,
  onEdit,
}: {
  ctx: WebPartContext;
  /** 编辑回填：条目文本交给 composer 草稿（本件只负责删条目） */
  onEdit?: (text: string) => void;
}): React.ReactNode {
  const busy = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.busy,
    () => false,
  );
  const paused = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.queuePaused === true,
    () => false,
  );
  const queue = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.queue ?? EMPTY_QUEUE,
    () => EMPTY_QUEUE,
  );
  if (ctx.sessionId === null || queue.length === 0 || !(busy || paused)) return null;
  const canRemove = ctx.client.removeQueueEntry !== undefined;
  const canResume = ctx.client.resumeQueue !== undefined;
  const canPromote = ctx.client.promoteQueueEntry !== undefined;

  const remove = (entryId: string): void => {
    void ctx.client.removeQueueEntry?.(ctx.sessionId as string, entryId).catch(() => {});
  };

  return (
    <div className="henira-queue">
      <div className={paused ? "henira-queue-head henira-queue-paused" : "henira-queue-head"}>
        {paused ? ctx.t("composer.queue.pausedTitle") : ctx.t("composer.queue.title")}
        <span className="henira-queue-count">{queue.length}</span>
        {paused ? (
          <button
            type="button"
            className="henira-queue-resume"
            aria-label={ctx.t("composer.queue.resume")}
            title={ctx.t("composer.queue.resume")}
            disabled={!canResume}
            onClick={() => {
              void ctx.client.resumeQueue?.(ctx.sessionId as string).catch(() => {});
            }}
          >
            {ctx.t("composer.queue.resume")}
          </button>
        ) : null}
      </div>
      <ul className="henira-queue-rows" aria-label={ctx.t("composer.queue.title")}>
        {queue.map((entry) => (
          <li className="henira-queue-row" key={entry.id}>
            {entry.steer ? (
              <span className="henira-queue-badge" title={ctx.t("composer.queue.badgeSteer")}>
                {ctx.t("composer.queue.badgeSteer")}
              </span>
            ) : null}
            <span className="henira-queue-text" title={entry.text}>
              {entry.text}
            </span>
            <span className="henira-queue-actions">
              <button
                type="button"
                className="henira-queue-btn"
                aria-label={ctx.t("composer.queue.sendNow")}
                title={ctx.t("composer.queue.sendNow")}
                disabled={!canPromote}
                onClick={() => {
                  void ctx.client.promoteQueueEntry?.(ctx.sessionId as string, entry.id);
                }}
              >
                <SendNowGlyph size={13} />
              </button>
              <button
                type="button"
                className="henira-queue-btn"
                aria-label={ctx.t("composer.queue.edit")}
                title={ctx.t("composer.queue.edit")}
                onClick={() => {
                  remove(entry.id);
                  onEdit?.(entry.text);
                }}
              >
                <PencilGlyph size={13} />
              </button>
              <button
                type="button"
                className="henira-queue-btn"
                aria-label={ctx.t("composer.queue.delete")}
                title={ctx.t("composer.queue.delete")}
                disabled={!canRemove}
                onClick={() => {
                  remove(entry.id);
                }}
              >
                <XGlyph size={13} />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
