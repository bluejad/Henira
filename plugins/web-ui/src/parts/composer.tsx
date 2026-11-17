// 官方件：输入框（槽 composer）。发送 = D-045 单口（闲直跑 / 忙入队）；busy 时显示停止
// 与插话提示——发送即排队条目，step 边界进场（steer 语义经 loop）。

import { useRef, useState, useSyncExternalStore } from "react";
import type { WebPart, WebPartContext } from "../types.js";
import { SendGlyph, StopGlyph } from "./icons.js";

export const Composer: WebPart = (ctx: WebPartContext) => {
  const [draft, setDraft] = useState("");
  const busy = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.busy,
    () => false,
  );
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const submit = (): void => {
    const text = draft.trim();
    if (text === "" || ctx.sessionId === null) return;
    setDraft("");
    void ctx.client.prompt(ctx.sessionId, text).catch(() => {
      // 发送失败回填草稿（用户不丢输入）
      setDraft(text);
    });
  };

  const stop = (): void => {
    if (ctx.sessionId !== null) void ctx.client.interrupt(ctx.sessionId);
  };

  return (
    <div
      className="henira-composer"
      style={{
        borderTop: "1px solid var(--henira-border)",
        background: "var(--henira-surface)",
        padding: "12px",
        display: "flex",
        gap: "8px",
        alignItems: "flex-end",
      }}
    >
      <textarea
        ref={areaRef}
        value={draft}
        rows={2}
        placeholder={ctx.t("composer.placeholder")}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        style={{
          flex: 1,
          resize: "none",
          border: "1px solid var(--henira-border)",
          borderRadius: "var(--henira-radius)",
          background: "var(--henira-bg)",
          color: "var(--henira-text)",
          padding: "8px 10px",
          font: "inherit",
        }}
      />
      {busy ? (
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}
        >
          <button
            type="button"
            className="henira-primary"
            onClick={stop}
            aria-label={ctx.t("composer.stop")}
          >
            <StopGlyph size={14} /> {ctx.t("composer.stop")}
          </button>
          <span style={{ fontSize: "11px", color: "var(--henira-text-muted)" }}>
            {ctx.t("composer.steerHint")}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="henira-primary"
          onClick={submit}
          disabled={draft.trim() === "" || ctx.sessionId === null}
          aria-label={ctx.t("composer.send")}
        >
          <SendGlyph size={14} /> {ctx.t("composer.send")}
        </button>
      )}
    </div>
  );
};
