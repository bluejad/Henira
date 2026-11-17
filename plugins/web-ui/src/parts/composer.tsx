// 官方件：输入区（槽 composer）。发送 = D-045 单口（闲直跑 / 忙入队）；busy 时显示停止
// 与插话提示——发送即排队条目，step 边界进场（steer 语义经 loop）。
// 审批接管 dock（M4 批 A 视觉二轮，dsh/ZCode 行为层参照）：pending 审批卡渲染在输入卡上方，
// 存在 pending 时 Enter 让位给审批卡（Enter=允许、Esc=拒绝在卡内监听），composer 不发送。
// 卡化输入区：16px 圆角卡 + focus-within 边框变 accent（ZCode 行为层参照）+ 自动增高 textarea
// + 圆形 accent 发送键。

import type { ApprovalRow, Row } from "@henira/protocol";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WebPart, WebPartContext } from "../types.js";
import { ApprovalCard } from "./approval-card.js";
import { SendGlyph, StopGlyph } from "./icons.js";

const TEXTAREA_MAX_HEIGHT = 200;
const EMPTY_ROWS: readonly Row[] = [];

export const Composer: WebPart = (ctx: WebPartContext) => {
  const [draft, setDraft] = useState("");
  // 两个稳定维度分开订阅（busy 布尔 / rows 数组引用）——不取整个快照对象
  // （store 契约只保证行数组引用稳定；getSnapshot 每次新对象会让 useSyncExternalStore 死循环）
  const busy = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.busy,
    () => false,
  );
  const rows = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).rows,
    () => EMPTY_ROWS,
  );
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // 审批接管：pending 卡在 dock 渲染；键盘直选期间 composer 提交让位
  const pendingApprovals = rows.filter(
    (row: Row): row is ApprovalRow => row.kind === "approval" && row.status === "pending",
  );

  useEffect(() => {
    // 草稿清空（发送成功）后复位自动增高
    const el = areaRef.current;
    if (el !== null && draft === "") el.style.height = "";
  }, [draft]);

  const submit = (): void => {
    const text = draft.trim();
    if (text === "" || ctx.sessionId === null) return;
    if (pendingApprovals.length > 0) return; // 审批接管中：Enter 已被审批卡消费
    setDraft("");
    void ctx.client.prompt(ctx.sessionId, text).catch(() => {
      // 发送失败回填草稿（用户不丢输入）
      setDraft(text);
    });
  };

  const stop = (): void => {
    if (ctx.sessionId !== null) void ctx.client.interrupt(ctx.sessionId);
  };

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  };

  return (
    <div className="henira-composer">
      {pendingApprovals.map((row) => (
        <ApprovalCard key={row.rowId} row={row} ctx={ctx} />
      ))}
      <div className="henira-composer-card">
        <textarea
          ref={areaRef}
          value={draft}
          rows={1}
          placeholder={ctx.t("composer.placeholder")}
          onChange={(e) => {
            setDraft(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="henira-composer-bar">
          {busy ? (
            <span style={{ fontSize: "var(--henira-fs-sm)", color: "var(--henira-text-muted)" }}>
              {ctx.t("composer.steerHint")}
            </span>
          ) : (
            <span />
          )}
          {busy ? (
            <button
              type="button"
              className="henira-primary"
              onClick={stop}
              aria-label={ctx.t("composer.stop")}
            >
              <StopGlyph size={14} /> {ctx.t("composer.stop")}
            </button>
          ) : (
            <button
              type="button"
              className="henira-icon-round"
              onClick={submit}
              disabled={draft.trim() === "" || ctx.sessionId === null}
              aria-label={ctx.t("composer.send")}
            >
              <SendGlyph size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
