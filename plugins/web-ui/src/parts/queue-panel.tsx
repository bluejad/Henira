// 官方件：排队卡（E1 2026-11-20）。数据源 = store 快照 state.queue（SessionState 投影态，
// server/sdk 经 queue/changed → state.updated 同通道推送；快照携带 → 断线重连自洽）。
// 队列与插话待进场条目同面板呈现、徽章区分（流内 pending 气泡本地回显挂账 50-open）。
// 行操作：插话发送 = steer 升格（仅 busy 时可点——闲时条目随回合末冲刷，dsh 同语义）；
// 编辑 = 文本回填 composer 草稿 + 条目删除（跨窗口冻结锁挂账）；删除 = removeQueueEntry。
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
  const queue = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.queue ?? EMPTY_QUEUE,
    () => EMPTY_QUEUE,
  );
  if (ctx.sessionId === null || queue.length === 0) return null;
  const canRemove = ctx.client.removeQueueEntry !== undefined;

  const remove = (entryId: string): void => {
    void ctx.client.removeQueueEntry?.(ctx.sessionId as string, entryId).catch(() => {});
  };

  return (
    <div className="henira-queue">
      <div className="henira-queue-head">
        {ctx.t("composer.queue.title")}
        <span className="henira-queue-count">{queue.length}</span>
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
                title={busy ? ctx.t("composer.queue.sendNow") : ctx.t("composer.queue.sendNowIdle")}
                disabled={!busy}
                onClick={() => {
                  void ctx.client.steer(ctx.sessionId as string, entry.id);
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
