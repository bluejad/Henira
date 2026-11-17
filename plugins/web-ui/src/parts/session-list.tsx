// 官方件：会话列表（槽 sidebar）。哑渲染件——数据经承重缝（client + store）来，件自身只渲染与交互。

import type { SessionSummary } from "@henira/protocol";
import { useCallback, useEffect, useState } from "react";
import type { WebPart, WebPartContext } from "../types.js";

export const SessionList: WebPart = (ctx: WebPartContext) => {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const refresh = useCallback((): void => {
    void ctx.client
      .listSessions()
      .then(setSessions)
      .catch(() => {}); // 拉取失败静默保留上次列表（下次帧再来）
  }, [ctx.client]);

  useEffect(() => {
    refresh();
    const off = ctx.store.subscribe(refresh); // busy 变化等经帧流触发刷新
    return () => {
      off();
    };
  }, [refresh, ctx.store]);

  const createSession = useCallback((): void => {
    void ctx.client
      .createSession()
      .then(() => refresh())
      .catch(() => {});
  }, [ctx.client, refresh]);

  return (
    <nav
      className="henira-sessions"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid var(--henira-border)",
        background: "var(--henira-surface)",
        padding: "12px",
        boxSizing: "border-box",
        width: "var(--henira-sidebar-width)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <strong style={{ color: "var(--henira-text-strong)" }}>{ctx.t("sessions.title")}</strong>
        <button type="button" className="henira-primary" onClick={createSession}>
          + {ctx.t("sessions.new")}
        </button>
      </div>
      {sessions.length === 0 ? (
        <span style={{ color: "var(--henira-text-muted)" }}>{ctx.t("sessions.empty")}</span>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto", flex: 1 }}>
          {sessions.map((s) => {
            const selected = ctx.sessionId === s.id;
            return (
              <li key={s.id} style={{ marginBottom: "2px" }}>
                <button
                  type="button"
                  onClick={() => {
                    ctx.selectSession(s.id);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: selected ? "var(--henira-bg)" : "transparent",
                    border: "none",
                    borderRadius: "var(--henira-radius)",
                    padding: "8px",
                  }}
                >
                  <span
                    role={"img"}
                    aria-label={s.busy ? ctx.t("sessions.busy") : ctx.t("sessions.idle")}
                    style={{
                      display: "inline-block",
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      marginRight: "8px",
                      background: s.busy ? "var(--henira-warn-text)" : "var(--henira-ok-text)",
                    }}
                  />
                  <span className="henira-mono" style={{ fontSize: "12px" }}>
                    {s.cwd.split(/[\\/]/).pop() || s.cwd}
                  </span>
                  <span
                    style={{
                      color: "var(--henira-text-muted)",
                      marginLeft: "8px",
                      fontSize: "12px",
                    }}
                  >
                    {s.busy ? ctx.t("sessions.busy") : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
};
